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
import { getLogger } from "@/lib/logger";

const log = getLogger("gemini-provider");

// ─── Config ───────────────────────────────────────────────────────────────────

const GEMINI_IMAGE_MODELS: readonly string[] =
  process.env.GEMINI_IMAGE_MODELS
    ? process.env.GEMINI_IMAGE_MODELS.split(",").map((m) => m.trim()).filter(Boolean)
    : ["gemini-2.5-flash-image", "gemini-3.1-flash-image-preview"];

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 3_000;

const GEMINI_CALL_TIMEOUT_MS = 100_000;

const MIN_OUTPUT_BYTES = 10_000;
const MIN_OUTPUT_DIMENSION_PX = 400;
const MAX_ASPECT_RATIO_DRIFT = 0.02;

/**
 * Maximum pixel length on either dimension before resizing.
 * Keeps base64 payload small and Gemini latency predictable.
 * 1280 px keeps Gemini payloads smaller and noticeably reduces latency while
 * preserving enough detail for the mobile room-preview flow. The output is
 * still strictly validated against the prepared input aspect ratio.
 */
const MAX_IMAGE_DIMENSION_PX = 1280;

// ─── Storage key builder ──────────────────────────────────────────────────────

const RENDER_OUTPUT_KEY_PREFIX = "uploads/room-preview/renders";

function buildRenderStorageKey(options: { jobId: string; sessionId: string }) {
  const fileName = `${options.sessionId}-${options.jobId}.png`;
  return `${RENDER_OUTPUT_KEY_PREFIX}/${fileName}`;
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
  width: number;
  height: number;
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
async function loadAndPrepareImage(url: string): Promise<PreparedImage> {
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

  const needsResize =
    originalWidth  > MAX_IMAGE_DIMENSION_PX ||
    originalHeight > MAX_IMAGE_DIMENSION_PX;

  let finalBuffer: Buffer;
  let width: number;
  let height: number;

  if (needsResize) {
    finalBuffer = await image
      .resize(MAX_IMAGE_DIMENSION_PX, MAX_IMAGE_DIMENSION_PX, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .toBuffer();

    const resizedMeta = await sharp(finalBuffer).metadata();
    width  = resizedMeta.width  ?? originalWidth;
    height = resizedMeta.height ?? originalHeight;

    log.info(
      { url: url.slice(0, 80), originalWidth, originalHeight, width, height },
      "Image resized before Gemini upload",
    );
  } else {
    finalBuffer = rawBuffer;
    width  = originalWidth;
    height = originalHeight;
  }

  // rawBuffer is no longer referenced after this point — eligible for GC.
  return { base64: finalBuffer.toString("base64"), mimeType, width, height };
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

// ─── Output validation + normalization ───────────────────────────────────────

const MAX_ASPECT_DRIFT = MAX_ASPECT_RATIO_DRIFT;

async function normalizeOutputToInputDimensions(
  buffer: Buffer<ArrayBuffer>,
  targetWidth: number,
  targetHeight: number,
): Promise<Buffer<ArrayBuffer>> {
  const { default: sharp } = await import("sharp");
  return (await sharp(buffer)
    .resize(targetWidth, targetHeight, { fit: "cover", position: "center" })
    .png()
    .toBuffer()) as Buffer<ArrayBuffer>;
}

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

  if (inputDimensions.width > 0 && inputDimensions.height > 0) {
    const inputAspect  = inputDimensions.width  / inputDimensions.height;
    const outputAspect = width / height;
    const drift = Math.abs(outputAspect - inputAspect) / inputAspect;

    if (drift > MAX_ASPECT_DRIFT) {
      log.warn(
        {
          event: "output_aspect_ratio_normalized",
          sessionId: context.sessionId,
          modelName: context.modelName,
          inputWidth: inputDimensions.width,
          inputHeight: inputDimensions.height,
          outputWidth: width,
          outputHeight: height,
          driftPercent: parseFloat((drift * 100).toFixed(2)),
        },
        "Output aspect ratio drifted — normalizing to input dimensions",
      );

      buffer = await normalizeOutputToInputDimensions(
        buffer,
        inputDimensions.width,
        inputDimensions.height,
      );
      width  = inputDimensions.width;
      height = inputDimensions.height;
    }
  }

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

export const geminiRoomPreviewRenderProvider = {
  name: "gemini-nano-banana-renderer",

  async render(
    request: RoomPreviewRenderProviderRequest,
  ): Promise<RoomPreviewRenderProviderResult> {
    const { product, room, sessionId } = request.renderJobInput;

    if (!room.imageUrl)    throw new Error("A room image is required for Gemini rendering.");
    if (!product.imageUrl) throw new Error("A product image is required for Gemini rendering.");

    const ai = getGeminiClient();

    const prompt = buildRenderPrompt(
      product.productType ?? null,
      product.name ?? null,
      room.floorQuad ?? null,
    );

    // Load, decode, and resize (if needed) in a single sharp pipeline each.
    // Dimensions are returned directly — no second decode needed for metadata.
    const [roomImage, productImage] = await Promise.all([
      loadAndPrepareImage(room.imageUrl),
      loadAndPrepareImage(product.imageUrl),
    ]);

    const inputDimensions = { width: roomImage.width, height: roomImage.height };

    const contentRequest: Record<string, unknown> = {
      contents: [
        {
          role: "user" as const,
          parts: [
            { inlineData: { mimeType: roomImage.mimeType,    data: roomImage.base64    } },
            { inlineData: { mimeType: productImage.mimeType, data: productImage.base64 } },
            { text: prompt },
          ],
        },
      ],
      config: {
        responseModalities: ["TEXT", "IMAGE"] as ("TEXT" | "IMAGE")[],
      },
    };

    let lastError: unknown = null;

    for (const modelName of GEMINI_IMAGE_MODELS) {
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          log.info(
            { modelName, attempt, sessionId, promptVersion: PROMPT_VERSION },
            "Starting render attempt",
          );

          const response = await generateContentWithTimeout(ai, modelName, contentRequest);

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
          const uploadResult = await storageUpload(storageKey, imageBuffer, "image/png");

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

          return {
            generatedAt: new Date().toISOString(),
            imageUrl: uploadResult.publicUrl,
            kind: "composited_preview",
            modelName,
          };
        } catch (err) {
          lastError = err;

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
