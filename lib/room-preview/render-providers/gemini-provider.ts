import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import { getRoomPreviewPublicAssetPath } from "@/lib/room-preview/local-assets";
import {
  buildRenderPrompt,
  PROMPT_VERSION,
  SENTINEL_FLOOR_NOT_VISIBLE,
  SENTINEL_MATERIAL_UNCLEAR,
} from "@/lib/room-preview/prompt-template-v2";
import type {
  RoomPreviewRenderProvider,
  RoomPreviewRenderProviderRequest,
  RoomPreviewRenderProviderResult,
} from "@/lib/room-preview/render-providers/types";
import { storageUpload } from "@/lib/storage";
import { trackSessionEvent } from "@/lib/room-preview/session-diagnostics";
import { getLogger } from "@/lib/logger";

const log = getLogger("gemini-provider");

// ─── Config ───────────────────────────────────────────────────────────────────

const GEMINI_IMAGE_MODELS: readonly string[] =
  process.env.GEMINI_IMAGE_MODELS
    ? process.env.GEMINI_IMAGE_MODELS.split(",").map((m) => m.trim()).filter(Boolean)
    : ["gemini-3.1-flash-image-preview"];

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 3_000;

const GEMINI_CALL_TIMEOUT_MS = 100_000;

const MIN_OUTPUT_BYTES = 10_000;
const MIN_OUTPUT_DIMENSION_PX = 400;
const MAX_ASPECT_RATIO_DRIFT = 0.02;
const REJECT_ASPECT_RATIO_DRIFT = 0.05;

/**
 * Maximum pixel length on either dimension before resizing.
 * Keeps base64 payload small and Gemini latency predictable.
 * 1280 px keeps Gemini payloads smaller and noticeably reduces latency while
 * preserving enough detail for the mobile room-preview flow. The output is
 * still strictly validated against the prepared input aspect ratio.
 */
const MAX_IMAGE_DIMENSION_PX = 1280;
const MAX_PRODUCT_IMAGE_DIMENSION_PX = 768;

/** When true, raw buffers are saved under debug/render-jobs/{sessionId}/{jobId}/. */
const DEBUG_ARTIFACTS_ENABLED = process.env.ROOM_PREVIEW_DEBUG_RENDER_ARTIFACTS === "true";

// ─── Storage key builder ──────────────────────────────────────────────────────

const RENDER_OUTPUT_KEY_PREFIX = "uploads/room-preview/renders";

function buildRenderStorageKey(options: { jobId: string; sessionId: string }) {
  const fileName = `${options.sessionId}-${options.jobId}.png`;
  return `${RENDER_OUTPUT_KEY_PREFIX}/${fileName}`;
}

function buildDebugArtifactKey(sessionId: string, jobId: string, filename: string): string {
  return `debug/render-jobs/${sessionId}/${jobId}/${filename}`;
}

async function saveDebugArtifacts(params: {
  sessionId: string;
  jobId: string;
  geminiInputBuffer: Buffer;
  rawOutputBuffer: Buffer;
  mimeType: string;
  prompt: string;
  snapshotMeta: Record<string, unknown>;
}): Promise<Record<string, string>> {
  const { sessionId, jobId, mimeType } = params;
  const ext = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
  const urls: Record<string, string> = {};

  const tasks: Array<{ key: string; filename: string; data: Buffer; ct: string }> = [
    { key: "02-gemini-input",      filename: `02-gemini-input.${ext}`,       data: params.geminiInputBuffer, ct: mimeType },
    { key: "03-gemini-raw-output", filename: "03-gemini-raw-output.png",     data: params.rawOutputBuffer,   ct: "image/png" },
    { key: "04-final-saved-output",filename: "04-final-saved-output.png",    data: params.rawOutputBuffer,   ct: "image/png" },
    { key: "prompt",               filename: "prompt.txt",                   data: Buffer.from(params.prompt, "utf-8"),                           ct: "text/plain" },
    { key: "metadata",             filename: "metadata.json",                data: Buffer.from(JSON.stringify(params.snapshotMeta, null, 2), "utf-8"), ct: "application/json" },
  ];

  await Promise.allSettled(
    tasks.map(async ({ key, filename, data, ct }) => {
      const result = await storageUpload(buildDebugArtifactKey(sessionId, jobId, filename), data, ct);
      urls[key] = result.publicUrl;
    }),
  );

  return urls;
}

// ─── Gemini client ────────────────────────────────────────────────────────────

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");
  return new GoogleGenAI({ apiKey });
}

// ─── Image loader + preparer ──────────────────────────────────────────────────

function extensionToMimeType(ext: string): string {
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

const IMAGE_FETCH_TIMEOUT_MS = 15_000;

type PreparedImage = {
  base64: string;
  mimeType: string;
  /** Final dimensions sent to Gemini (after EXIF rotation + possible resize). */
  width: number;
  height: number;
  /** Dimensions after EXIF rotation but before any pixel resize — the "original upload" size. */
  originalWidth: number;
  originalHeight: number;
};

/**
 * Load an image from a local path or remote URL, resize it if it exceeds
 * MAX_IMAGE_DIMENSION_PX on either axis, and return the base64-encoded result
 * together with final dimensions.
 *
 * Single sharp decode — avoids the old pattern of loading to base64 then
 * re-decoding to Buffer just to read metadata, which held two copies of the
 * image in memory simultaneously.
 */
async function loadAndPrepareImage(
  url: string,
  context: { imageRole: "room" | "product"; sessionId: string },
): Promise<PreparedImage> {
  const { default: sharp } = await import("sharp");

  let rawBuffer: Buffer;
  let mimeType: string;

  if (url.startsWith("/")) {
    const absolutePath = getRoomPreviewPublicAssetPath(url);
    mimeType = extensionToMimeType(path.extname(absolutePath).toLowerCase());
    rawBuffer = await fs.readFile(absolutePath);
  } else {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`Image fetch failed for "${url}": HTTP ${res.status}`);
      }
      const raw = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
      const ALLOWED = ["image/jpeg", "image/png", "image/webp"] as const;
      if (!(ALLOWED as readonly string[]).includes(raw)) {
        throw new Error(`Unsupported image content-type "${raw}" for URL "${url}".`);
      }
      mimeType = raw;
      rawBuffer = Buffer.from(await res.arrayBuffer());
    } finally {
      clearTimeout(timer);
    }
  }

  // Single sharp pipeline: read metadata → resize if needed → encode.
  // This replaces the old pattern of toString("base64") then
  // Buffer.from(base64, "base64") just to call sharp again for metadata.
  const image = sharp(rawBuffer).rotate(); // auto-orient from EXIF
  const meta = await image.metadata();
  const originalWidth  = meta.width  ?? 0;
  const originalHeight = meta.height ?? 0;

  const maxDimension = context.imageRole === "product" ? MAX_PRODUCT_IMAGE_DIMENSION_PX : MAX_IMAGE_DIMENSION_PX;

  const needsResize =
    originalWidth  > maxDimension ||
    originalHeight > maxDimension;

  log.info(
    {
      event: "render_input_image_dimensions_before_resize",
      imageRole: context.imageRole,
      resizeFit: "inside",
      sessionId: context.sessionId,
      url: url.slice(0, 120),
      width: originalWidth,
      height: originalHeight,
    },
    "Render input image dimensions before resize",
  );

  let finalBuffer: Buffer;
  let width: number;
  let height: number;

  if (needsResize) {
    finalBuffer = await image
      .resize(maxDimension, maxDimension, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .toBuffer();

    const resizedMeta = await sharp(finalBuffer).metadata();
    width  = resizedMeta.width  ?? originalWidth;
    height = resizedMeta.height ?? originalHeight;

    log.info(
      {
        event: "render_input_image_dimensions_after_resize",
        imageRole: context.imageRole,
        originalWidth,
        originalHeight,
        resizeFit: "inside",
        sessionId: context.sessionId,
        url: url.slice(0, 120),
        width,
        height,
      },
      "Image resized before Gemini upload",
    );
  } else {
    finalBuffer = rawBuffer;
    width  = originalWidth;
    height = originalHeight;
  }

  log.info(
    {
      event: "render_input_image_dimensions_after_resize",
      imageRole: context.imageRole,
      resized: needsResize,
      resizeFit: "inside",
      sessionId: context.sessionId,
      width,
      height,
    },
    "Render input image dimensions after resize",
  );

  if (context.imageRole === "product") {
    log.info(
      {
        event: "product_image_resized_for_gemini",
        sessionId: context.sessionId,
        originalWidth,
        originalHeight,
        finalWidth: width,
        finalHeight: height,
        resized: needsResize,
      },
      "Product image prepared for Gemini",
    );
  }

  return { base64: finalBuffer.toString("base64"), mimeType, width, height, originalWidth, originalHeight };
}

// ─── Per-call timeout wrapper ─────────────────────────────────────────────────

async function generateContentWithTimeout(
  ai: GoogleGenAI,
  modelName: string,
  contentRequest: Record<string, unknown>,
) {
  const timeoutError = new Error(
    `Gemini call timed out after ${GEMINI_CALL_TIMEOUT_MS / 1000}s (model: ${modelName})`,
  );

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(timeoutError), GEMINI_CALL_TIMEOUT_MS),
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params = { model: modelName, ...contentRequest } as any;

  return Promise.race([ai.models.generateContent(params), timeout]);
}

// ─── Typed render errors ──────────────────────────────────────────────────────

class AspectRatioMismatchError extends Error {
  readonly failureReason = "output_aspect_ratio_mismatch" as const;
  constructor(
    public readonly driftPercent: number,
    public readonly inputWidth: number,
    public readonly inputHeight: number,
    public readonly outputWidth: number,
    public readonly outputHeight: number,
  ) {
    super(
      `Aspect ratio mismatch: output ${outputWidth}×${outputHeight} vs input ${inputWidth}×${inputHeight} (drift ${driftPercent.toFixed(1)}%)`,
    );
    this.name = "AspectRatioMismatchError";
  }
}

// ─── Output validation + normalization ───────────────────────────────────────

const MAX_ASPECT_DRIFT = MAX_ASPECT_RATIO_DRIFT;


async function validateAndNormalizeOutputImage(
  outputBase64: string,
  inputBase64: string,
  inputDimensions: { width: number; height: number },
  context: { sessionId: string; modelName: string },
): Promise<{ width: number; height: number; buffer: Buffer<ArrayBuffer> }> {
  let buffer = Buffer.from(outputBase64, "base64") as Buffer<ArrayBuffer>;

  if (buffer.length < MIN_OUTPUT_BYTES) {
    throw new Error(
      `Output image is too small (${buffer.length} bytes) — likely blank or corrupt.`,
    );
  }

  if (outputBase64 === inputBase64) {
    throw new Error(
      "Output image is identical to the input room image — Gemini applied no changes.",
    );
  }

  const { default: sharp } = await import("sharp");

  let width: number;
  let height: number;

  try {
    const meta = await sharp(buffer).metadata();
    width  = meta.width  ?? 0;
    height = meta.height ?? 0;
  } catch {
    throw new Error("Output image could not be decoded — Gemini returned an invalid image.");
  }

  if (width < MIN_OUTPUT_DIMENSION_PX || height < MIN_OUTPUT_DIMENSION_PX) {
    throw new Error(
      `Output dimensions ${width}×${height} are too small — expected at least ${MIN_OUTPUT_DIMENSION_PX}px.`,
    );
  }

  log.info(
    {
      event: "render_output_dimensions_raw",
      sessionId: context.sessionId,
      modelName: context.modelName,
      outputWidth: width,
      outputHeight: height,
      inputWidth: inputDimensions.width,
      inputHeight: inputDimensions.height,
    },
    "Raw Gemini output dimensions before any normalization",
  );

  if (inputDimensions.width > 0 && inputDimensions.height > 0) {
    const inputAspect  = inputDimensions.width  / inputDimensions.height;
    const outputAspect = width / height;
    const drift = Math.abs(outputAspect - inputAspect) / inputAspect;
    const driftPct = parseFloat((drift * 100).toFixed(2));

    if (drift > MAX_ASPECT_DRIFT) {
      const shouldReject = drift > REJECT_ASPECT_RATIO_DRIFT;
      log.warn(
        {
          event: "output_aspect_ratio_mismatch",
          sessionId: context.sessionId,
          modelName: context.modelName,
          inputWidth: inputDimensions.width,
          inputHeight: inputDimensions.height,
          outputWidth: width,
          outputHeight: height,
          driftPercent: driftPct,
          action: shouldReject ? "rejected" : "saved_raw",
        },
        shouldReject
          ? "Gemini output aspect ratio mismatch exceeds 5% — rejecting"
          : "Gemini output aspect ratio drifted from input — saving raw output without any transform",
      );

      if (shouldReject) {
        throw new AspectRatioMismatchError(driftPct, inputDimensions.width, inputDimensions.height, width, height);
      }
    }
  }

  log.info(
    {
      event: "render_output_dimensions_final",
      sessionId: context.sessionId,
      modelName: context.modelName,
      finalWidth: width,
      finalHeight: height,
      normalizedApplied: false,
      paddingApplied: false,
    },
    "Final render output dimensions (raw Gemini output, no transform applied)",
  );

  return { width, height, buffer };
}

// ─── Retry helpers ────────────────────────────────────────────────────────────

function isRetryableError(error: unknown): boolean {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status: number }).status;
    return status === 503 || status === 429;
  }
  return false;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Provider ─────────────────────────────────────────────────────────────────
//
// IMPORTANT — generation mode, not editing mode:
// This uses Gemini's multimodal generateContent API with responseModalities:["IMAGE"].
// The room and product images are sent as reference content, but Gemini generates a
// NEW image rather than editing the input pixel-by-pixel (no inpainting/masking).
// Consequences:
//   - Output dimensions are not guaranteed to match input → the 5% aspect-ratio guard
//     is the only defence against severely wrong-sized output.
//   - Without a floorPolygon the model guesses the floor region, which can cause the
//     scene composition (perspective, doors, walls) to shift.
//   - For true in-place editing, consider switching to an inpainting API such as
//     Imagen 3 edit mode, which accepts a mask and preserves the rest of the image.

export const geminiRoomPreviewRenderProvider = {
  name: "gemini-nano-banana-renderer",

  async render(
    request: RoomPreviewRenderProviderRequest,
  ): Promise<RoomPreviewRenderProviderResult> {
    const { product, room, sessionId } = request.renderJobInput;

    if (!room.imageUrl)    throw new Error("A room image is required for Gemini rendering.");
    if (!product.imageUrl) throw new Error("A product image is required for Gemini rendering.");

    const ai = getGeminiClient();
    const tProviderStart = Date.now();

    // Load, decode, and resize (if needed) in a single sharp pipeline each.
    // Dimensions are returned directly — no second decode needed for metadata.
    // Prompt is built after loading so we can include exact pixel dimensions.
    const [roomImage, productImage] = await Promise.all([
      loadAndPrepareImage(room.imageUrl, { imageRole: "room", sessionId }),
      loadAndPrepareImage(product.imageUrl, { imageRole: "product", sessionId }),
    ]);
    const tImagesLoaded = Date.now();

    const inputDimensions = { width: roomImage.width, height: roomImage.height };

    const prompt = buildRenderPrompt(
      product.productType ?? null,
      product.name ?? null,
      room.floorQuad ?? null,
      inputDimensions,
    );

    const imageParts = [
      { inlineData: { mimeType: roomImage.mimeType,    data: roomImage.base64    } },
      { inlineData: { mimeType: productImage.mimeType, data: productImage.base64 } },
    ];

    // Warn when rendering without a floor polygon — the model will estimate the floor
    // region from the image content alone, which increases the risk of wrong-aspect
    // output and scene composition drift.
    if (!room.floorQuad) {
      log.warn(
        { event: "floor_polygon_missing_prompt_only_mode", sessionId },
        "floor_polygon_missing_prompt_only_mode: no floorPolygon — Gemini will estimate the floor region from the image",
      );
      trackSessionEvent({
        sessionId,
        source: "renderer",
        eventType: "floor_polygon_missing_prompt_only_mode",
        level: "warning",
        message: "Rendering in prompt-only mode — no floorPolygon available. Gemini will estimate the floor region.",
      }).catch((evtErr) => {
        log.warn({ evtErr, sessionId }, "floor_polygon_missing_prompt_only_mode event failed (non-fatal)");
      });
    }

    let lastError: unknown = null;
    let aspectRatioRetried = false;
    let activePrompt = prompt;

    for (const modelName of GEMINI_IMAGE_MODELS) {
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const contentRequest: Record<string, unknown> = {
          contents: [
            {
              role: "user" as const,
              parts: [...imageParts, { text: activePrompt }],
            },
          ],
          config: {
            responseModalities: ["TEXT", "IMAGE"] as ("TEXT" | "IMAGE")[],
          },
        };

        try {
          log.info(
            { modelName, attempt, sessionId, promptVersion: PROMPT_VERSION },
            "Starting render attempt",
          );

          const tGeminiStart = Date.now();
          const response = await generateContentWithTimeout(ai, modelName, contentRequest);
          const tGeminiDone = Date.now();

          const parts = response.candidates?.[0]?.content?.parts ?? [];
          const imagePart = parts.find(
            (p: { inlineData?: { mimeType?: string; data?: string } }) =>
              p.inlineData?.mimeType?.startsWith("image/"),
          );

          if (!imagePart?.inlineData?.data) {
            const textParts = parts
              .filter((p: { text?: string }) => p.text)
              .map((p: { text?: string }) => p.text)
              .join("\n");
            throw new Error(
              `Gemini did not return an image.${textParts ? ` Model response: ${textParts}` : ""}`,
            );
          }

          const textResponse = parts
            .filter((p: { text?: string }) => p.text)
            .map((p: { text?: string }) => p.text)
            .join("\n");

          if (textResponse.includes(SENTINEL_FLOOR_NOT_VISIBLE)) {
            throw new Error(
              `Gemini reported the floor is not sufficiently visible — render rejected (model: ${modelName}, attempt: ${attempt}).`,
            );
          }

          if (textResponse.includes(SENTINEL_MATERIAL_UNCLEAR)) {
            throw new Error(
              `Gemini reported the flooring material could not be inferred from the product image — render rejected (model: ${modelName}, attempt: ${attempt}).`,
            );
          }

          const { width, height, buffer: imageBuffer } = await validateAndNormalizeOutputImage(
            imagePart.inlineData.data,
            roomImage.base64,
            inputDimensions,
            { sessionId, modelName },
          );

          const storageKey = buildRenderStorageKey({ jobId: request.jobId, sessionId });
          const tUploadStart = Date.now();
          const uploadResult = await storageUpload(storageKey, imageBuffer, "image/png");
          const tUploadDone = Date.now();

          log.info(
            {
              modelName,
              attempt,
              sessionId,
              promptVersion: PROMPT_VERSION,
              outputDimensions: `${width}x${height}`,
              outputBytes: imageBuffer.length,
            },
            "Render succeeded",
          );

          // ── Diagnostics snapshot ───────────────────────────────────────────
          const resizedApplied =
            roomImage.width !== roomImage.originalWidth ||
            roomImage.height !== roomImage.originalHeight;

          const snapshotMeta: Record<string, unknown> = {
            renderJobId: request.jobId,
            originalDimensions:      { width: roomImage.originalWidth, height: roomImage.originalHeight },
            geminiInputDimensions:   { width: roomImage.width,         height: roomImage.height },
            rawOutputDimensions:     { width, height },
            finalOutputDimensions:   { width, height },
            resizedApplied,
            cropApplied:             false,
            paddingApplied:          false,
            normalizedApplied:       false,
            fillApplied:             false,
            containApplied:          false,
            coverApplied:            false,
            exifOrientationApplied:  true,
            savedRaw:                true,
            promptVersion:           PROMPT_VERSION,
            modelName,
            productName:             product.name ?? null,
            floorPolygon:            room.floorQuad ?? null,
            promptText:              prompt,
            outputImageUrl:          uploadResult.publicUrl,
            artifactUrls:            {} as Record<string, string>,
            timings: {
              imageLoadMs:     tImagesLoaded - tProviderStart,
              geminiMs:        tGeminiDone - tGeminiStart,
              uploadMs:        tUploadDone - tUploadStart,
              totalProviderMs: tUploadDone - tProviderStart,
              attempt,
              modelName,
            },
          };

          if (DEBUG_ARTIFACTS_ENABLED) {
            try {
              const geminiInputBuffer = Buffer.from(roomImage.base64, "base64");
              const artifactUrls = await saveDebugArtifacts({
                sessionId,
                jobId: request.jobId,
                geminiInputBuffer,
                rawOutputBuffer: imageBuffer,
                mimeType: roomImage.mimeType,
                prompt,
                snapshotMeta: { ...snapshotMeta, artifactUrls: undefined },
              });
              artifactUrls["01-original-upload"] = room.imageUrl ?? "";
              snapshotMeta["artifactUrls"] = artifactUrls;
            } catch (debugErr) {
              log.warn(
                { debugErr, sessionId, jobId: request.jobId },
                "Debug artifact saving failed (non-fatal)",
              );
            }
          }

          trackSessionEvent({
            sessionId,
            source: "renderer",
            eventType: "render_diagnostics_snapshot",
            level: "info",
            metadata: snapshotMeta,
          }).catch((evtErr) => {
            log.warn({ evtErr, sessionId }, "render_diagnostics_snapshot event failed (non-fatal)");
          });

          return {
            generatedAt: new Date().toISOString(),
            imageUrl: uploadResult.publicUrl,
            kind: "composited_preview",
            modelName,
          };
        } catch (err) {
          lastError = err;

          if (err instanceof AspectRatioMismatchError && !aspectRatioRetried) {
            aspectRatioRetried = true;
            activePrompt =
              `${prompt}\n\nCRITICAL CORRECTION: Your previous output had the wrong aspect ratio ` +
              `(${err.outputWidth}×${err.outputHeight} instead of ${err.inputWidth}×${err.inputHeight}). ` +
              `The output image MUST be exactly ${inputDimensions.width} pixels wide and ${inputDimensions.height} pixels tall. ` +
              `Match the input image dimensions exactly — do NOT change the aspect ratio.`;
            log.warn(
              {
                event: "output_aspect_ratio_mismatch_rejected",
                sessionId,
                modelName,
                attempt,
                driftPercent: err.driftPercent,
                inputDimensions,
                outputDimensions: { width: err.outputWidth, height: err.outputHeight },
                action: "retrying_with_strict_prompt",
              },
              "Aspect ratio mismatch — retrying once with stricter dimension constraint",
            );
            continue;
          }

          if (err instanceof AspectRatioMismatchError) {
            log.error(
              {
                event: "output_aspect_ratio_mismatch_rejected",
                sessionId,
                modelName,
                attempt,
                driftPercent: err.driftPercent,
                action: "giving_up",
              },
              "Aspect ratio mismatch persists after strict-prompt retry — failing render",
            );
            break;
          }

          if (isRetryableError(err) && attempt < MAX_RETRIES) {
            const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
            log.warn({ err, modelName, attempt, delayMs: delay }, "Retryable error — retrying");
            await sleep(delay);
            continue;
          }

          if (!isRetryableError(err)) {
            log.warn({ err, modelName, attempt }, "Non-retryable error — moving to next model");
            break;
          }

          log.warn({ modelName, maxRetries: MAX_RETRIES }, "Exhausted retries for model — trying next");
          break;
        }
      }
    }

    throw lastError ?? new Error("All Gemini image models failed.");
  },
} satisfies RoomPreviewRenderProvider;
