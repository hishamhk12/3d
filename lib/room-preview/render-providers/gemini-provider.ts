import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import { getRoomPreviewPublicAssetPath } from "@/lib/room-preview/local-assets";
import {
  buildRenderPrompt,
  PROMPT_VERSION_FAST,
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
import {
  ACTIVE_PROMPT_VERSION,
  BASE_DELAY_MS,
  DEBUG_ARTIFACTS_ENABLED,
  ENABLE_PARALLEL_GEMINI_ATTEMPTS,
  GEMINI_CALL_TIMEOUT_MS,
  GEMINI_FIRST_ATTEMPT_TIMEOUT_MS,
  GEMINI_IMAGE_MODELS,
  GEMINI_RETRY_ATTEMPT_TIMEOUT_MS,
  LONG_EDGE_OVERRIDE,
  MAX_ASPECT_RATIO_DRIFT,
  MAX_IMAGE_DIMENSION_PX,
  MAX_PRODUCT_IMAGE_DIMENSION_PX,
  MAX_RETRIES,
  MIN_OUTPUT_BYTES,
  MIN_OUTPUT_DIMENSION_PX,
  PARALLEL_GEMINI_ATTEMPTS,
  PROMPT_VARIANT,
  REJECT_ASPECT_RATIO_DRIFT,
  RENDER_QUALITY,
  TIMEOUT_RETRY_PRODUCT_MAX_PX,
  TIMEOUT_RETRY_ROOM_MAX_PX,
} from "@/lib/room-preview/render-providers/gemini-config";
export {
  AspectRatioMismatchError,
  GeminiAbortedError,
  GeminiTimeoutError,
  ParallelGeminiAllFailedError,
} from "@/lib/room-preview/render-providers/gemini-errors";
import type { ParallelAttemptTiming } from "@/lib/room-preview/render-providers/gemini-errors";
import {
  AspectRatioMismatchError,
  GeminiAbortedError,
  GeminiTimeoutError,
  ParallelGeminiAllFailedError,
} from "@/lib/room-preview/render-providers/gemini-errors";

const log = getLogger("gemini-provider");


// ─── Resolved config snapshot (safe to log — no secrets) ─────────────────────
//
// Captured once at module load so every cold start emits a single structured
// log entry that shows exactly what the Lambda resolved from its env vars.
// Read raw values again here (outside the IIFEs) so we can compare them to
// the resolved constants and detect whitespace/case issues.

const RESOLVED_CONFIG = {
  raw_ROOM_PREVIEW_RENDER_QUALITY:                            process.env.ROOM_PREVIEW_RENDER_QUALITY ?? null,
  raw_ROOM_PREVIEW_RENDER_LONG_EDGE:                          process.env.ROOM_PREVIEW_RENDER_LONG_EDGE ?? null,
  raw_GEMINI_CALL_TIMEOUT_MS:                                 process.env.GEMINI_CALL_TIMEOUT_MS ?? null,
  raw_ROOM_PREVIEW_GEMINI_FIRST_ATTEMPT_TIMEOUT_MS:           process.env.ROOM_PREVIEW_GEMINI_FIRST_ATTEMPT_TIMEOUT_MS ?? null,
  raw_ROOM_PREVIEW_GEMINI_RETRY_ATTEMPT_TIMEOUT_MS:           process.env.ROOM_PREVIEW_GEMINI_RETRY_ATTEMPT_TIMEOUT_MS ?? null,
  raw_ROOM_PREVIEW_ENABLE_PARALLEL_GEMINI_ATTEMPTS:           process.env.ROOM_PREVIEW_ENABLE_PARALLEL_GEMINI_ATTEMPTS ?? null,
  raw_ROOM_PREVIEW_PARALLEL_GEMINI_ATTEMPTS:                  process.env.ROOM_PREVIEW_PARALLEL_GEMINI_ATTEMPTS ?? null,
  resolvedRenderQuality:                                      RENDER_QUALITY,
  resolvedLongEdgeOverride:                                   LONG_EDGE_OVERRIDE,
  resolvedMaxImageDimensionPx:                                MAX_IMAGE_DIMENSION_PX,
  resolvedMaxProductImageDimensionPx:                         MAX_PRODUCT_IMAGE_DIMENSION_PX,
  resolvedPromptVariant:                                      PROMPT_VARIANT,
  resolvedActivePromptVersion:                                ACTIVE_PROMPT_VERSION,
  resolvedGeminiCallTimeoutMs:                                GEMINI_CALL_TIMEOUT_MS,
  resolvedFirstAttemptTimeoutMs:                              GEMINI_FIRST_ATTEMPT_TIMEOUT_MS,
  resolvedRetryAttemptTimeoutMs:                              GEMINI_RETRY_ATTEMPT_TIMEOUT_MS,
  resolvedEnableParallelGeminiAttempts:                       ENABLE_PARALLEL_GEMINI_ATTEMPTS,
  resolvedParallelGeminiAttempts:                             PARALLEL_GEMINI_ATTEMPTS,
  resolvedGeminiModels:                                       GEMINI_IMAGE_MODELS,
  nodeEnv:                                                    process.env.NODE_ENV ?? null,
  vercelEnv:                                                  process.env.VERCEL_ENV ?? null,
  vercelRegion:                                               process.env.VERCEL_REGION ?? null,
} as const;

log.info(
  { event: "render_config_resolved", ...RESOLVED_CONFIG },
  "Gemini provider config resolved at module load (cold start)",
);

// Safety check: if the env var says "fast" but the resolved prompt is not fast-v1,
// something is wrong (whitespace, stale cache, env mismatch).
if (
  process.env.ROOM_PREVIEW_RENDER_QUALITY === "fast" &&
  ACTIVE_PROMPT_VERSION !== PROMPT_VERSION_FAST
) {
  log.warn(
    {
      event: "render_config_mismatch",
      ...RESOLVED_CONFIG,
      expectedPromptVersion: PROMPT_VERSION_FAST,
    },
    "render_config_mismatch: ROOM_PREVIEW_RENDER_QUALITY=fast but ACTIVE_PROMPT_VERSION is not fast-v1",
  );
}

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
    { key: "02-gemini-input",       filename: `02-gemini-input.${ext}`,    data: params.geminiInputBuffer, ct: mimeType },
    { key: "03-gemini-raw-output",  filename: "03-gemini-raw-output.png",  data: params.rawOutputBuffer,   ct: "image/png" },
    { key: "04-final-saved-output", filename: "04-final-saved-output.png", data: params.rawOutputBuffer,   ct: "image/png" },
    { key: "prompt",                filename: "prompt.txt",                data: Buffer.from(params.prompt, "utf-8"),                               ct: "text/plain" },
    { key: "metadata",              filename: "metadata.json",             data: Buffer.from(JSON.stringify(params.snapshotMeta, null, 2), "utf-8"), ct: "application/json" },
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
  /** Raw byte size before sharp processing — used for diagnostics only. */
  originalBytes: number;
  /** Byte size of the final JPEG sent to Gemini — used for diagnostics only. */
  finalBytes: number;
};

/**
 * Load an image from a local path or remote URL, apply EXIF rotation, resize
 * if it exceeds the dimension limit, re-encode as JPEG, and return the
 * base64-encoded result together with final dimensions.
 *
 * Always outputs image/jpeg regardless of input format (PNG, WebP, JPEG) so
 * Gemini receives a compact payload. EXIF rotation is applied even when no
 * pixel resize is needed (fixes the prior bug where rawBuffer was returned
 * unmodified for small images).
 *
 * @param context.maxDimensionOverride  Override the role-based max dimension —
 *   used on timeout retry to send a smaller payload.
 */
async function loadAndPrepareImage(
  url: string,
  context: {
    imageRole: "room" | "product";
    sessionId: string;
    maxDimensionOverride?: number;
  },
): Promise<PreparedImage> {
  const { default: sharp } = await import("sharp");

  let rawBuffer: Buffer;
  let sourceMimeType: string;

  if (url.startsWith("/")) {
    const absolutePath = getRoomPreviewPublicAssetPath(url);
    sourceMimeType = extensionToMimeType(path.extname(absolutePath).toLowerCase());
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
      sourceMimeType = raw;
      rawBuffer = Buffer.from(await res.arrayBuffer());
    } finally {
      clearTimeout(timer);
    }
  }

  // Phase 1: log raw bytes and source MIME before any processing.
  log.info(
    {
      event: "render_input_image_loaded",
      imageRole: context.imageRole,
      sessionId: context.sessionId,
      originalBytes: rawBuffer.length,
      sourceMimeType,
    },
    "Render input image loaded from source",
  );

  // Read physical dimensions before the output pipeline runs.
  const meta = await sharp(rawBuffer).metadata();
  const originalWidth  = meta.width  ?? 0;
  const originalHeight = meta.height ?? 0;

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

  const roleMax    = context.imageRole === "product" ? MAX_PRODUCT_IMAGE_DIMENSION_PX : MAX_IMAGE_DIMENSION_PX;
  const maxDimension = context.maxDimensionOverride ?? roleMax;

  const needsResize =
    originalWidth  > maxDimension ||
    originalHeight > maxDimension;

  let finalBuffer: Buffer;
  let width: number;
  let height: number;

  if (needsResize) {
    // Phase 2: apply EXIF rotation, resize to fit within maxDimension, re-encode as JPEG.
    const { data, info } = await sharp(rawBuffer)
      .rotate()
      .resize(maxDimension, maxDimension, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
    finalBuffer = data;
    width  = info.width;
    height = info.height;

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
    // Phase 2: no resize needed, but still apply EXIF rotation and re-encode as JPEG.
    // (Previously this path returned rawBuffer directly, skipping both rotation and
    // format conversion — that sent PNG or an un-rotated image to Gemini.)
    const { data: rotated, info: rotInfo } = await sharp(rawBuffer)
      .rotate()
      .jpeg({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
    finalBuffer = rotated;
    width  = rotInfo.width;
    height = rotInfo.height;
  }

  // Phase 1: log final bytes and confirmed MIME after processing.
  log.info(
    {
      event: "render_input_image_prepared",
      imageRole: context.imageRole,
      sessionId: context.sessionId,
      originalBytes: rawBuffer.length,
      finalBytes: finalBuffer.length,
      width,
      height,
      mimeType: "image/jpeg",
      resized: needsResize,
      maxDimension,
    },
    "Render input image prepared for Gemini",
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

  return {
    base64: finalBuffer.toString("base64"),
    mimeType: "image/jpeg",
    width,
    height,
    originalWidth,
    originalHeight,
    originalBytes: rawBuffer.length,
    finalBytes: finalBuffer.length,
  };
}

// ─── Per-call timeout wrapper ─────────────────────────────────────────────────

// Promise.race() is the authoritative timeout gate — it fires after timeoutMs
// regardless of whether the SDK honours the AbortSignal. AbortController is
// still passed so the SDK can clean up its HTTP connection on a best-effort
// basis, but the caller is never blocked beyond timeoutMs.
async function generateContentWithTimeout(
  ai: GoogleGenAI,
  modelName: string,
  contentRequest: Record<string, unknown>,
  timeoutMs: number,
  externalAbortSignal?: AbortSignal,
) {
  const controller = new AbortController();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new GeminiTimeoutError(modelName, timeoutMs));
    }, timeoutMs);
  });

  // Propagate external abort (e.g., from the parallel-attempt winner cancelling the loser).
  const externalAbortPromise = externalAbortSignal
    ? new Promise<never>((_, reject) => {
        if (externalAbortSignal.aborted) {
          controller.abort();
          reject(new GeminiAbortedError());
          return;
        }
        externalAbortSignal.addEventListener(
          "abort",
          () => {
            controller.abort();
            reject(new GeminiAbortedError());
          },
          { once: true },
        );
      })
    : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params = { model: modelName, ...contentRequest, abortSignal: controller.signal } as any;
  const geminiPromise = ai.models.generateContent(params);

  const racers: Promise<unknown>[] = [geminiPromise, timeoutPromise];
  if (externalAbortPromise) racers.push(externalAbortPromise);

  try {
    return await Promise.race(racers) as Awaited<typeof geminiPromise>;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Output validation + normalization ───────────────────────────────────────

async function validateAndNormalizeOutputImage(
  outputBase64: string,
  inputBase64: string,
  inputDimensions: { width: number; height: number },
  context: { sessionId: string; modelName: string },
): Promise<{ width: number; height: number; buffer: Buffer<ArrayBuffer> }> {
  const buffer = Buffer.from(outputBase64, "base64") as Buffer<ArrayBuffer>;

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

    if (drift > MAX_ASPECT_RATIO_DRIFT) {
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

/**
 * Short, low-complexity prompt used when attempt 1 times out.
 * Intentionally omits floor-polygon coordinates and quality constraints so Gemini
 * has the best chance of returning quickly within the longer retry budget.
 */
function buildFallbackPrompt(productName: string | null): string {
  const productRef = productName ? `"${productName}"` : "the provided flooring product";
  return [
    `Replace only the visible floor with ${productRef}.`,
    "Keep walls, furniture, ceiling, lighting, shadows, and perspective unchanged.",
    "Do not modify anything except the floor surface.",
    "Return a realistic photo result.",
  ].join("\n");
}

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

// ─── Parallel attempt helpers ─────────────────────────────────────────────────

/** Resolves with the first fulfilled promise; rejects only when ALL reject. */
function raceToFirstSuccess<T>(promises: Promise<T>[]): Promise<T> {
  return new Promise((resolve, reject) => {
    let remaining = promises.length;
    const errors: unknown[] = [];
    for (const p of promises) {
      p.then(resolve, (err) => {
        errors.push(err);
        remaining--;
        if (remaining === 0) reject(errors[errors.length - 1]);
      });
    }
  });
}

type ParallelAttemptRawOutput = {
  imageBuffer: Buffer<ArrayBuffer>;
  geminiOutputMimeType: string;
  width: number;
  height: number;
  geminiMs: number;
};

/**
 * Runs one Gemini call for the parallel-attempt path.
 * Returns the raw image buffer — does NOT upload. Upload is the winner's job.
 */
async function executeGeminiCallForParallelAttempt(params: {
  ai: GoogleGenAI;
  modelName: string;
  roomImage: PreparedImage;
  productImage: PreparedImage;
  prompt: string;
  inputDimensions: { width: number; height: number };
  timeoutMs: number;
  externalAbortSignal: AbortSignal;
  sessionId: string;
  jobId: string;
  attemptId: string;
}): Promise<ParallelAttemptRawOutput> {
  const {
    ai, modelName, roomImage, productImage, prompt, inputDimensions,
    timeoutMs, externalAbortSignal, sessionId, jobId, attemptId,
  } = params;

  const imageParts = [
    { inlineData: { mimeType: roomImage.mimeType,    data: roomImage.base64    } },
    { inlineData: { mimeType: productImage.mimeType, data: productImage.base64 } },
  ];

  const contentRequest: Record<string, unknown> = {
    contents: [{ role: "user" as const, parts: [...imageParts, { text: prompt }] }],
    config: { responseModalities: ["TEXT", "IMAGE"] as ("TEXT" | "IMAGE")[] },
  };

  log.info(
    { event: "gemini_attempt_started", sessionId, jobId, modelName, attemptId, timeoutMs },
    "gemini_attempt_started",
  );

  const tStart = Date.now();
  const response = await generateContentWithTimeout(
    ai, modelName, contentRequest, timeoutMs, externalAbortSignal,
  );
  const geminiMs = Date.now() - tStart;

  log.info(
    { event: "gemini_attempt_completed", sessionId, jobId, modelName, attemptId, timeoutMs, actualDurationMs: geminiMs },
    "gemini_attempt_completed",
  );

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
    throw new Error(`Gemini reported the floor is not visible — render rejected (model: ${modelName}, attempt: ${attemptId}).`);
  }
  if (textResponse.includes(SENTINEL_MATERIAL_UNCLEAR)) {
    throw new Error(`Gemini reported flooring material unclear — render rejected (model: ${modelName}, attempt: ${attemptId}).`);
  }

  const { width, height, buffer: imageBuffer } = await validateAndNormalizeOutputImage(
    imagePart.inlineData.data,
    roomImage.base64,
    inputDimensions,
    { sessionId, modelName },
  );

  return {
    imageBuffer,
    geminiOutputMimeType: imagePart.inlineData.mimeType ?? "image/png",
    width,
    height,
    geminiMs,
  };
}

/**
 * Fires two Gemini attempts simultaneously under the same jobId.
 * The first to succeed uploads its result and returns; the other is aborted.
 * If both fail, throws the last error.
 */
async function runParallelGeminiAttempts(params: {
  ai: GoogleGenAI;
  modelName: string;
  roomImage: PreparedImage;
  productImage: PreparedImage;
  prompt: string;
  inputDimensions: { width: number; height: number };
  numAttempts: number;
  sessionId: string;
  jobId: string;
  tProviderStart: number;
}): Promise<{
  imageUrl: string;
  modelName: string;
  generatedAt: string;
  kind: "composited_preview";
  winnerAttemptId: string;
  attemptTimings: ParallelAttemptTiming[];
  lateResultIgnored: boolean;
}> {
  const { ai, modelName, roomImage, productImage, prompt, inputDimensions, numAttempts, sessionId, jobId } = params;
  const timeoutMs = GEMINI_FIRST_ATTEMPT_TIMEOUT_MS;

  // In-memory winner guard — safe because JS is single-threaded.
  // The first attempt that sets this past the null check has won.
  let winnerAttemptId: string | null = null;
  let lateResultIgnored = false;

  const abortControllers = Array.from({ length: numAttempts }, () => new AbortController());
  const attemptTimings: ParallelAttemptTiming[] = [];

  trackSessionEvent({
    sessionId, source: "renderer",
    eventType: "gemini_parallel_attempts_started", level: "info",
    metadata: { numAttempts, jobId, modelName, timeoutMs },
  }).catch(() => {});

  log.info(
    { event: "gemini_parallel_attempts_started", sessionId, jobId, modelName, numAttempts, timeoutMs },
    "gemini_parallel_attempts_started",
  );

  async function runAttempt(attemptIndex: number): Promise<{
    imageUrl: string; modelName: string; generatedAt: string;
    kind: "composited_preview"; winnerAttemptId: string;
  }> {
    const attemptId = `parallel-${attemptIndex + 1}`;
    const abortController = abortControllers[attemptIndex];
    const tAttemptStart = Date.now();

    try {
      const raw = await executeGeminiCallForParallelAttempt({
        ai, modelName, roomImage, productImage, prompt, inputDimensions,
        timeoutMs, externalAbortSignal: abortController.signal,
        sessionId, jobId, attemptId,
      });
      const durationMs = Date.now() - tAttemptStart;

      // ── Atomic winner guard (JS single-threaded) ──────────────────────────
      if (winnerAttemptId !== null) {
        // Another attempt already won — discard this result entirely.
        lateResultIgnored = true;
        log.info(
          { event: "gemini_late_result_ignored", sessionId, jobId, attemptId, winnerAttemptId, durationMs },
          "gemini_late_result_ignored",
        );
        trackSessionEvent({
          sessionId, source: "renderer",
          eventType: "gemini_late_result_ignored", level: "info",
          metadata: { attemptId, winnerAttemptId, durationMs, jobId },
        }).catch(() => {});
        attemptTimings.push({ attemptId, durationMs, status: "lost", timeoutMs });
        throw new Error(`render_result_save_skipped_stale_attempt:${attemptId}`);
      }

      // Claim the win — this is synchronous so no other attempt can interleave.
      winnerAttemptId = attemptId;

      // Abort all other running attempts.
      for (let i = 0; i < abortControllers.length; i++) {
        if (i !== attemptIndex) abortControllers[i].abort();
      }

      log.info(
        { event: "gemini_attempt_won", sessionId, jobId, attemptId, durationMs, modelName },
        "gemini_attempt_won",
      );
      trackSessionEvent({
        sessionId, source: "renderer",
        eventType: "gemini_attempt_won", level: "info",
        metadata: { attemptId, durationMs, jobId, modelName },
      }).catch(() => {});

      // Upload only the winner's output.
      const storageKey = buildRenderStorageKey({ jobId, sessionId });
      const uploadBuffer = raw.geminiOutputMimeType === "image/png"
        ? raw.imageBuffer
        : await (await import("sharp")).default(raw.imageBuffer).png().toBuffer();
      const uploadResult = await storageUpload(storageKey, uploadBuffer, "image/png");

      log.info(
        { event: "render_timing", sessionId, jobId, stage: "parallel_upload", durationMs: Date.now() - tAttemptStart - raw.geminiMs },
        "render_timing",
      );

      attemptTimings.push({ attemptId, durationMs: Date.now() - tAttemptStart, status: "won", timeoutMs });

      return {
        imageUrl: uploadResult.publicUrl,
        modelName,
        generatedAt: new Date().toISOString(),
        kind: "composited_preview",
        winnerAttemptId: attemptId,
      };
    } catch (err) {
      const durationMs = Date.now() - tAttemptStart;
      const isLateResultError =
        err instanceof Error && err.message.startsWith("render_result_save_skipped_stale_attempt:");

      if (!isLateResultError) {
        if (abortController.signal.aborted && err instanceof GeminiAbortedError) {
          log.info(
            { event: "gemini_attempt_lost", sessionId, jobId, attemptId, durationMs },
            "gemini_attempt_lost: aborted because another attempt won",
          );
          trackSessionEvent({
            sessionId, source: "renderer",
            eventType: "gemini_attempt_lost", level: "info",
            metadata: { attemptId, durationMs, jobId, reason: "aborted_by_winner" },
          }).catch(() => {});
          attemptTimings.push({ attemptId, durationMs, status: "aborted", timeoutMs });
        } else if (err instanceof GeminiTimeoutError) {
          log.warn(
            { event: "gemini_attempt_timeout", sessionId, jobId, attemptId, durationMs, timeoutMs },
            "gemini_attempt_timeout",
          );
          trackSessionEvent({
            sessionId, source: "renderer",
            eventType: "gemini_attempt_timeout", level: "warning",
            metadata: { attemptId, durationMs, timeoutMs, jobId },
          }).catch(() => {});
          attemptTimings.push({ attemptId, durationMs, status: "timeout", timeoutMs });
        } else {
          log.warn(
            { event: "gemini_attempt_failed", sessionId, jobId, attemptId, durationMs, err },
            "gemini_attempt_failed",
          );
          trackSessionEvent({
            sessionId, source: "renderer",
            eventType: "gemini_attempt_failed", level: "warning",
            metadata: { attemptId, durationMs, jobId, error: err instanceof Error ? err.message : String(err) },
          }).catch(() => {});
          attemptTimings.push({ attemptId, durationMs, status: "failed", timeoutMs });
        }
      }
      throw err;
    }
  }

  const attemptPromises = Array.from({ length: numAttempts }, (_, i) => runAttempt(i));
  try {
    const winner = await raceToFirstSuccess(attemptPromises);
    return { ...winner, attemptTimings, lateResultIgnored };
  } catch (err) {
    const allTimedOut = attemptTimings.length > 0 && attemptTimings.every((t) => t.status === "timeout");
    const timeoutMs = attemptTimings[0]?.timeoutMs ?? GEMINI_FIRST_ATTEMPT_TIMEOUT_MS;
    throw new ParallelGeminiAllFailedError(err, attemptTimings, numAttempts, allTimedOut, timeoutMs);
  }
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

    // Load, EXIF-rotate, resize (if needed), and re-encode both images as JPEG
    // in parallel. Dimensions are returned directly — no second decode needed.
    const [roomImage, productImage] = await Promise.all([
      loadAndPrepareImage(room.imageUrl, { imageRole: "room", sessionId }),
      loadAndPrepareImage(product.imageUrl, { imageRole: "product", sessionId }),
    ]);
    const tImagesLoaded = Date.now();
    log.info(
      {
        event: "render_timing",
        sessionId,
        renderJobId: request.jobId,
        stage: "image_load_and_preprocess",
        durationMs: tImagesLoaded - tProviderStart,
        roomFinalBytes: roomImage.finalBytes,
        productFinalBytes: productImage.finalBytes,
        roomDimensions: `${roomImage.width}x${roomImage.height}`,
        productDimensions: `${productImage.width}x${productImage.height}`,
      },
      "render_timing",
    );

    const inputDimensions = { width: roomImage.width, height: roomImage.height };

    const prompt = buildRenderPrompt(
      product.productType ?? null,
      product.name ?? null,
      room.floorQuad ?? null,
      inputDimensions,
      PROMPT_VARIANT,
    );

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

    // ── Per-render config reads ───────────────────────────────────────────────
    // Re-read ALL env vars that drive render behavior at request time (not just at
    // cold-start module load). This prevents stale values from:
    //   • Next.js webpack bundler inlining process.env.* at build time
    //   • Env vars set in Vercel after the last deployment (before a new cold start)
    //   • Warm-Lambda scenarios where module constants are frozen from a prior eval
    const perRenderRawQuality  = process.env.ROOM_PREVIEW_RENDER_QUALITY ?? null;
    const perRenderRawLongEdge = process.env.ROOM_PREVIEW_RENDER_LONG_EDGE ?? null;

    const perRenderEnableParallel =
      process.env.ROOM_PREVIEW_ENABLE_PARALLEL_GEMINI_ATTEMPTS === "true";

    const perRenderParallelAttempts = (() => {
      const raw = Number(process.env.ROOM_PREVIEW_PARALLEL_GEMINI_ATTEMPTS);
      if (!Number.isFinite(raw) || raw < 1) return 2;
      return Math.min(Math.max(Math.round(raw), 1), 2);
    })();

    const resolvedBranch: "parallel" | "serial" =
      perRenderEnableParallel && perRenderParallelAttempts >= 2 ? "parallel" : "serial";

    // Warn when the per-render read disagrees with the module-level constant —
    // this is a strong signal that the bundle has a stale inlined value and a
    // redeploy is needed.
    if (
      perRenderEnableParallel !== ENABLE_PARALLEL_GEMINI_ATTEMPTS ||
      perRenderParallelAttempts !== PARALLEL_GEMINI_ATTEMPTS
    ) {
      log.warn(
        {
          event: "render_config_stale_module_constant",
          sessionId,
          moduleEnableParallel:    ENABLE_PARALLEL_GEMINI_ATTEMPTS,
          moduleParallelAttempts:  PARALLEL_GEMINI_ATTEMPTS,
          perRenderEnableParallel,
          perRenderParallelAttempts,
        },
        "render_config_stale_module_constant: per-render env read differs from module-level constant — possible build-time inlining or missing redeploy",
      );
    }

    // This session event is the authoritative record of which branch was chosen.
    // It is written to the session events table (not just server logs) so it
    // appears in the admin diagnostics view next to render timing events.
    trackSessionEvent({
      sessionId,
      source: "renderer",
      eventType: "render_branch_resolved",
      level: "info",
      metadata: {
        branch:                  resolvedBranch,
        parallelGeminiEnabled:   perRenderEnableParallel,
        parallelGeminiAttempts:  perRenderParallelAttempts,
        // Include module-level constants so diagnostics can detect staleness.
        moduleEnableParallel:    ENABLE_PARALLEL_GEMINI_ATTEMPTS,
        moduleParallelAttempts:  PARALLEL_GEMINI_ATTEMPTS,
        raw_ROOM_PREVIEW_ENABLE_PARALLEL_GEMINI_ATTEMPTS: process.env.ROOM_PREVIEW_ENABLE_PARALLEL_GEMINI_ATTEMPTS ?? null,
        raw_ROOM_PREVIEW_PARALLEL_GEMINI_ATTEMPTS:        process.env.ROOM_PREVIEW_PARALLEL_GEMINI_ATTEMPTS ?? null,
        raw_ROOM_PREVIEW_GEMINI_FIRST_ATTEMPT_TIMEOUT_MS: process.env.ROOM_PREVIEW_GEMINI_FIRST_ATTEMPT_TIMEOUT_MS ?? null,
        renderJobId: request.jobId,
        vercelEnv:   process.env.VERCEL_ENV ?? null,
        vercelRegion: process.env.VERCEL_REGION ?? null,
      },
    }).catch(() => {});

    log.info(
      {
        event:                   "render_branch_resolved",
        sessionId,
        renderJobId:             request.jobId,
        branch:                  resolvedBranch,
        parallelGeminiEnabled:   perRenderEnableParallel,
        parallelGeminiAttempts:  perRenderParallelAttempts,
        moduleEnableParallel:    ENABLE_PARALLEL_GEMINI_ATTEMPTS,
        moduleParallelAttempts:  PARALLEL_GEMINI_ATTEMPTS,
        firstAttemptTimeoutMs:   GEMINI_FIRST_ATTEMPT_TIMEOUT_MS,
        raw_ROOM_PREVIEW_ENABLE_PARALLEL_GEMINI_ATTEMPTS: process.env.ROOM_PREVIEW_ENABLE_PARALLEL_GEMINI_ATTEMPTS ?? null,
      },
      "render_branch_resolved",
    );

    if (perRenderRawQuality === "fast" && ACTIVE_PROMPT_VERSION !== PROMPT_VERSION_FAST) {
      log.warn(
        {
          event: "render_config_mismatch",
          sessionId,
          perRenderRawQuality,
          resolvedRenderQuality: RENDER_QUALITY,
          resolvedPromptVariant: PROMPT_VARIANT,
          resolvedActivePromptVersion: ACTIVE_PROMPT_VERSION,
          expectedPromptVersion: PROMPT_VERSION_FAST,
          note: "env var says fast but module resolved balanced — likely set without redeployment or whitespace issue",
        },
        "render_config_mismatch",
      );
      trackSessionEvent({
        sessionId,
        source: "renderer",
        eventType: "render_config_mismatch",
        level: "warning",
        message: "ROOM_PREVIEW_RENDER_QUALITY=fast but prompt version is not gemini-floor-fast-v1 — config mismatch detected",
        metadata: {
          perRenderRawQuality,
          perRenderRawLongEdge,
          resolvedRenderQuality: RENDER_QUALITY,
          resolvedPromptVariant: PROMPT_VARIANT,
          resolvedActivePromptVersion: ACTIVE_PROMPT_VERSION,
          expectedPromptVersion: PROMPT_VERSION_FAST,
        },
      }).catch((evtErr) => {
        log.warn({ evtErr, sessionId }, "render_config_mismatch event failed (non-fatal)");
      });
    }

    // ── Parallel-attempt path ─────────────────────────────────────────────────
    if (perRenderEnableParallel && perRenderParallelAttempts >= 2) {
      const modelName = GEMINI_IMAGE_MODELS[0];
      log.info(
        {
          event: "render_config_resolved",
          sessionId,
          renderJobId: request.jobId,
          mode: "parallel",
          numAttempts: perRenderParallelAttempts,
          modelName,
          timeoutMs: GEMINI_FIRST_ATTEMPT_TIMEOUT_MS,
        },
        "Parallel Gemini attempt mode active",
      );

      const parallelResult = await runParallelGeminiAttempts({
        ai,
        modelName,
        roomImage,
        productImage,
        prompt,
        inputDimensions,
        numAttempts: perRenderParallelAttempts,
        sessionId,
        jobId: request.jobId,
        tProviderStart,
      }).catch((parallelError: unknown) => {
        // ── Failure diagnostics ──────────────────────────────────────────────
        // Emit render_timing_summary + render_diagnostics_snapshot even on
        // failure so the diagnostics view shows per-attempt detail rather than
        // only the top-level "gemini_timeout" from render_failed.
        const totalFailedMs = Date.now() - tProviderStart;
        if (parallelError instanceof ParallelGeminiAllFailedError) {
          const normalizedTimings = parallelError.attemptTimings.map((t, i) => ({
            attempt: i + 1,
            modelName,
            durationMs: t.durationMs,
            status: t.status === "timeout" ? "timed_out" : t.status,
            attemptTimeoutMs: t.timeoutMs,
            abortedByTimeout: t.status === "timeout",
          }));
          trackSessionEvent({
            sessionId,
            source: "renderer",
            eventType: "render_timing_summary",
            level: "warning",
            metadata: {
              renderJobId: request.jobId,
              mode: "parallel",
              totalProviderMs: totalFailedMs,
              imageLoadMs: tImagesLoaded - tProviderStart,
              geminiMs: totalFailedMs - (tImagesLoaded - tProviderStart),
              attemptCount: parallelError.numAttempts,
              winnerAttemptId: null,
              allFailed: true,
              allTimedOut: parallelError.allTimedOut,
              lateResultIgnored: false,
              modelName,
              timeoutBudgetMs: GEMINI_FIRST_ATTEMPT_TIMEOUT_MS,
              attemptTimings: normalizedTimings,
              firstAttemptTimeoutMs: GEMINI_FIRST_ATTEMPT_TIMEOUT_MS,
              retryAttemptTimeoutMs: GEMINI_RETRY_ATTEMPT_TIMEOUT_MS,
              qualityMode: RENDER_QUALITY,
              promptVersion: ACTIVE_PROMPT_VERSION,
              inputDimensions,
              envConfig: {
                raw_ROOM_PREVIEW_ENABLE_PARALLEL_GEMINI_ATTEMPTS: process.env.ROOM_PREVIEW_ENABLE_PARALLEL_GEMINI_ATTEMPTS ?? null,
                raw_ROOM_PREVIEW_PARALLEL_GEMINI_ATTEMPTS: process.env.ROOM_PREVIEW_PARALLEL_GEMINI_ATTEMPTS ?? null,
                resolvedEnableParallelGeminiAttempts: perRenderEnableParallel,
                resolvedParallelGeminiAttempts: perRenderParallelAttempts,
                resolvedFirstAttemptTimeoutMs: GEMINI_FIRST_ATTEMPT_TIMEOUT_MS,
              },
            },
          }).catch(() => {});
          trackSessionEvent({
            sessionId,
            source: "renderer",
            eventType: "render_diagnostics_snapshot",
            level: "warning",
            metadata: {
              renderJobId: request.jobId,
              originalDimensions: { width: roomImage.originalWidth, height: roomImage.originalHeight },
              geminiInputDimensions: { width: roomImage.width, height: roomImage.height },
              resizedApplied:
                roomImage.width !== roomImage.originalWidth ||
                roomImage.height !== roomImage.originalHeight,
              exifOrientationApplied: true,
              savedRaw: false,
              qualityMode: RENDER_QUALITY,
              promptVersion: ACTIVE_PROMPT_VERSION,
              promptLength: prompt.length,
              inputPixelCount: inputDimensions.width * inputDimensions.height,
              modelName,
              productName: product.name ?? null,
              floorPolygon: room.floorQuad ?? null,
              promptText: prompt,
              outputImageUrl: null,
              artifactUrls: {},
            },
          }).catch(() => {});
        }
        throw parallelError;
      });

      const totalProviderMs = Date.now() - tProviderStart;

      // ── Diagnostics summary ─────────────────────────────────────────────
      const winnerTiming = parallelResult.attemptTimings.find((t) => t.status === "won");
      const loserTimings = parallelResult.attemptTimings.filter((t) => t.status !== "won");

      // Normalize parallel timings to serial-compatible format for the UI attempt table.
      const normalizedAttemptTimings = parallelResult.attemptTimings.map((t, i) => ({
        attempt: i + 1,
        modelName,
        durationMs: t.durationMs,
        status: t.status === "won" ? "succeeded" : t.status === "timeout" ? "timed_out" : t.status,
        attemptTimeoutMs: t.timeoutMs,
        abortedByTimeout: t.status === "timeout",
      }));

      trackSessionEvent({
        sessionId,
        source: "renderer",
        eventType: "render_timing_summary",
        level: "info",
        metadata: {
          renderJobId: request.jobId,
          mode: "parallel",
          totalProviderMs,
          imageLoadMs: tImagesLoaded - tProviderStart,
          attemptCount: parallelResult.attemptTimings.length,
          winnerAttemptId: parallelResult.winnerAttemptId,
          winnerDurationMs: winnerTiming?.durationMs ?? null,
          loserStatuses: loserTimings.map((t) => ({ attemptId: t.attemptId, status: t.status, durationMs: t.durationMs })),
          lateResultIgnored: parallelResult.lateResultIgnored,
          modelName,
          timeoutBudgetMs: GEMINI_FIRST_ATTEMPT_TIMEOUT_MS,
          attemptTimings: normalizedAttemptTimings,
          firstAttemptTimeoutMs: GEMINI_FIRST_ATTEMPT_TIMEOUT_MS,
          retryAttemptTimeoutMs: GEMINI_RETRY_ATTEMPT_TIMEOUT_MS,
          qualityMode: RENDER_QUALITY,
          promptVersion: ACTIVE_PROMPT_VERSION,
          inputDimensions,
          envConfig: {
            raw_ROOM_PREVIEW_ENABLE_PARALLEL_GEMINI_ATTEMPTS: process.env.ROOM_PREVIEW_ENABLE_PARALLEL_GEMINI_ATTEMPTS ?? null,
            raw_ROOM_PREVIEW_PARALLEL_GEMINI_ATTEMPTS: process.env.ROOM_PREVIEW_PARALLEL_GEMINI_ATTEMPTS ?? null,
            resolvedEnableParallelGeminiAttempts: ENABLE_PARALLEL_GEMINI_ATTEMPTS,
            resolvedParallelGeminiAttempts: PARALLEL_GEMINI_ATTEMPTS,
            resolvedFirstAttemptTimeoutMs: GEMINI_FIRST_ATTEMPT_TIMEOUT_MS,
          },
        },
      }).catch(() => {});

      return {
        generatedAt: parallelResult.generatedAt,
        imageUrl: parallelResult.imageUrl,
        kind: parallelResult.kind,
        modelName: parallelResult.modelName,
      };
    }

    // ── Serial retry path (original behavior, unchanged) ─────────────────────
    log.info(
      { event: "render_config_resolved", sessionId, renderJobId: request.jobId, mode: "serial" },
      "Serial (single-attempt + retry) mode active — parallel attempts disabled",
    );

    let lastError: unknown = null;
    let aspectRatioRetried = false;
    let timeoutRetried = false;
    let activePrompt = prompt;
    let currentPromptVariant: "normal" | "fallback" = "normal";
    // Phase 4: may be replaced with smaller-dimension versions on timeout retry.
    let currentRoomImage    = roomImage;
    let currentProductImage = productImage;

    const attemptTimings: Array<{
      attempt: number;
      modelName: string;
      durationMs: number;
      status: string;
      retryReason?: string;
      attemptTimeoutMs: number;
      abortedByTimeout: boolean;
      promptVariant?: "normal" | "fallback";
    }> = [];
    let lastRetryReason: string | undefined;

    for (const modelName of GEMINI_IMAGE_MODELS) {
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        // First attempt uses a tight timeout so a stuck Gemini call fails fast.
        // All subsequent attempts use the longer retry budget.
        const attemptTimeoutMs = attempt === 1
          ? GEMINI_FIRST_ATTEMPT_TIMEOUT_MS
          : GEMINI_RETRY_ATTEMPT_TIMEOUT_MS;

        // imageParts is rebuilt each attempt so timeout retry uses updated images.
        const imageParts = [
          { inlineData: { mimeType: currentRoomImage.mimeType,    data: currentRoomImage.base64    } },
          { inlineData: { mimeType: currentProductImage.mimeType, data: currentProductImage.base64 } },
        ];

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

        let tGeminiStart = 0;
        try {
          log.info(
            {
              event: "gemini_call_starting",
              sessionId,
              modelName,
              attempt,
              qualityMode: RENDER_QUALITY,
              promptVersion: ACTIVE_PROMPT_VERSION,
              promptLength: activePrompt.length,
              inputPixelCount: currentRoomImage.width * currentRoomImage.height,
              payloadPartCount: imageParts.length + 1,
              timeoutMs: attemptTimeoutMs,
              roomBytes: currentRoomImage.finalBytes,
              productBytes: currentProductImage.finalBytes,
              roomDimensions: `${currentRoomImage.width}x${currentRoomImage.height}`,
              productDimensions: `${currentProductImage.width}x${currentProductImage.height}`,
              // Raw env values read per-request — compare to resolved constants to detect
              // warm-Lambda caching or env vars set without redeployment.
              raw_ROOM_PREVIEW_RENDER_QUALITY:   perRenderRawQuality,
              raw_ROOM_PREVIEW_RENDER_LONG_EDGE: perRenderRawLongEdge,
              resolvedRenderQuality:             RENDER_QUALITY,
              resolvedLongEdgeOverride:          LONG_EDGE_OVERRIDE,
              resolvedMaxImageDimensionPx:       MAX_IMAGE_DIMENSION_PX,
              resolvedPromptVariant:             PROMPT_VARIANT,
              nodeEnv:                           process.env.NODE_ENV ?? null,
              vercelEnv:                         process.env.VERCEL_ENV ?? null,
              vercelRegion:                      process.env.VERCEL_REGION ?? null,
            },
            "Starting Gemini render attempt",
          );

          tGeminiStart = Date.now();
          log.info(
            { event: "gemini_attempt_started", sessionId, modelName, attempt, timeoutMs: attemptTimeoutMs },
            "gemini_attempt_started",
          );
          const response = await generateContentWithTimeout(ai, modelName, contentRequest, attemptTimeoutMs);
          const tGeminiDone = Date.now();
          const geminiMs = tGeminiDone - tGeminiStart;
          log.info(
            { event: "gemini_attempt_completed", sessionId, modelName, attempt, timeoutMs: attemptTimeoutMs, actualDurationMs: geminiMs },
            "gemini_attempt_completed",
          );
          log.info(
            {
              event: "render_timing",
              sessionId,
              renderJobId: request.jobId,
              stage: `gemini_attempt_${attempt}`,
              durationMs: geminiMs,
              modelName,
              attempt,
            },
            "render_timing",
          );

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
            currentRoomImage.base64,
            inputDimensions,
            { sessionId, modelName },
          );
          const tValidationDone = Date.now();
          log.info(
            {
              event: "render_timing",
              sessionId,
              renderJobId: request.jobId,
              stage: "output_validation",
              durationMs: tValidationDone - tGeminiDone,
            },
            "render_timing",
          );

          const storageKey = buildRenderStorageKey({ jobId: request.jobId, sessionId });
          const tUploadStart = Date.now();
          const geminiOutputMimeType = imagePart.inlineData.mimeType ?? "";
          const uploadBuffer = geminiOutputMimeType === "image/png"
            ? imageBuffer
            : await (await import("sharp")).default(imageBuffer).png().toBuffer();
          const uploadResult = await storageUpload(storageKey, uploadBuffer, "image/png");
          const tUploadDone = Date.now();
          log.info(
            {
              event: "render_timing",
              sessionId,
              renderJobId: request.jobId,
              stage: "final_upload",
              durationMs: tUploadDone - tUploadStart,
              outputBytes: uploadBuffer.length,
            },
            "render_timing",
          );
          attemptTimings.push({ attempt, modelName, durationMs: geminiMs, status: "succeeded", attemptTimeoutMs, abortedByTimeout: false, promptVariant: currentPromptVariant });

          if (timeoutRetried) {
            log.info(
              {
                event: "gemini_retry_succeeded",
                sessionId,
                modelName,
                attempt,
                geminiMs,
                roomDimensions: `${currentRoomImage.width}x${currentRoomImage.height}`,
              },
              "Gemini render succeeded on timeout retry",
            );
          }

          log.info(
            {
              modelName,
              attempt,
              sessionId,
              qualityMode: RENDER_QUALITY,
              promptVersion: ACTIVE_PROMPT_VERSION,
              outputDimensions: `${width}x${height}`,
              outputBytes: uploadBuffer.length,
              geminiMs,
            },
            "Render succeeded",
          );

          // ── Diagnostics snapshot ───────────────────────────────────────────
          const resizedApplied =
            currentRoomImage.width !== currentRoomImage.originalWidth ||
            currentRoomImage.height !== currentRoomImage.originalHeight;

          const snapshotMeta: Record<string, unknown> = {
            renderJobId:           request.jobId,
            originalDimensions:    { width: currentRoomImage.originalWidth, height: currentRoomImage.originalHeight },
            geminiInputDimensions: { width: currentRoomImage.width,         height: currentRoomImage.height },
            rawOutputDimensions:   { width, height },
            finalOutputDimensions: { width, height },
            resizedApplied,
            cropApplied:           false,
            paddingApplied:        false,
            normalizedApplied:     false,
            fillApplied:           false,
            containApplied:        false,
            coverApplied:          false,
            exifOrientationApplied: true,
            savedRaw:              true,
            qualityMode:           RENDER_QUALITY,
            promptVersion:         ACTIVE_PROMPT_VERSION,
            promptLength:          prompt.length,
            inputPixelCount:       inputDimensions.width * inputDimensions.height,
            modelName,
            productName:           product.name ?? null,
            floorPolygon:          room.floorQuad ?? null,
            promptText:            prompt,
            outputImageUrl:        uploadResult.publicUrl,
            artifactUrls:          {} as Record<string, string>,
            timings: {
              imageLoadMs:             tImagesLoaded - tProviderStart,
              geminiMs,
              uploadMs:                tUploadDone - tUploadStart,
              totalProviderMs:         tUploadDone - tProviderStart,
              attempt,
              modelName,
              timeoutMs:               GEMINI_CALL_TIMEOUT_MS,
              firstAttemptTimeoutMs:   GEMINI_FIRST_ATTEMPT_TIMEOUT_MS,
              retryAttemptTimeoutMs:   GEMINI_RETRY_ATTEMPT_TIMEOUT_MS,
            },
            // Raw + resolved config — visible in admin diagnostics snapshot.
            envConfig: {
              raw_ROOM_PREVIEW_RENDER_QUALITY:                    perRenderRawQuality,
              raw_ROOM_PREVIEW_RENDER_LONG_EDGE:                  perRenderRawLongEdge,
              raw_ROOM_PREVIEW_GEMINI_FIRST_ATTEMPT_TIMEOUT_MS:   process.env.ROOM_PREVIEW_GEMINI_FIRST_ATTEMPT_TIMEOUT_MS ?? null,
              raw_ROOM_PREVIEW_GEMINI_RETRY_ATTEMPT_TIMEOUT_MS:   process.env.ROOM_PREVIEW_GEMINI_RETRY_ATTEMPT_TIMEOUT_MS ?? null,
              resolvedRenderQuality:                              RENDER_QUALITY,
              resolvedLongEdgeOverride:                           LONG_EDGE_OVERRIDE,
              resolvedMaxImageDimensionPx:                        MAX_IMAGE_DIMENSION_PX,
              resolvedMaxProductImageDimensionPx:                 MAX_PRODUCT_IMAGE_DIMENSION_PX,
              resolvedPromptVariant:                              PROMPT_VARIANT,
              resolvedActivePromptVersion:                        ACTIVE_PROMPT_VERSION,
              resolvedGeminiCallTimeoutMs:                        GEMINI_CALL_TIMEOUT_MS,
              resolvedFirstAttemptTimeoutMs:                      GEMINI_FIRST_ATTEMPT_TIMEOUT_MS,
              resolvedRetryAttemptTimeoutMs:                      GEMINI_RETRY_ATTEMPT_TIMEOUT_MS,
              nodeEnv:                                            process.env.NODE_ENV ?? null,
              vercelEnv:                                          process.env.VERCEL_ENV ?? null,
              vercelRegion:                                       process.env.VERCEL_REGION ?? null,
            },
          };

          if (DEBUG_ARTIFACTS_ENABLED) {
            const geminiInputBuffer = Buffer.from(currentRoomImage.base64, "base64");
            const tDebugFired = Date.now();
            log.info(
              {
                event: "render_timing",
                sessionId,
                renderJobId: request.jobId,
                stage: "debug_artifact_upload",
                async: true,
                note: "fire-and-forget — not on critical path",
              },
              "render_timing",
            );
            saveDebugArtifacts({
              sessionId,
              jobId: request.jobId,
              geminiInputBuffer,
              rawOutputBuffer: imageBuffer,
              mimeType: currentRoomImage.mimeType,
              prompt,
              snapshotMeta: { ...snapshotMeta, artifactUrls: undefined },
            }).then(() => {
              log.info(
                {
                  event: "render_timing",
                  sessionId,
                  renderJobId: request.jobId,
                  stage: "debug_artifact_upload_done",
                  durationMs: Date.now() - tDebugFired,
                },
                "render_timing",
              );
            }).catch((debugErr) => {
              log.warn(
                { debugErr, sessionId, jobId: request.jobId },
                "Debug artifact saving failed (non-fatal)",
              );
            });
          }

          trackSessionEvent({
            sessionId,
            source: "renderer",
            eventType: "render_timing_summary",
            level: "info",
            metadata: {
              renderJobId: request.jobId,
              mode: timeoutRetried ? "serial_adaptive" : "serial",
              totalProviderMs: tUploadDone - tProviderStart,
              imageLoadMs: tImagesLoaded - tProviderStart,
              geminiMs,
              uploadMs: tUploadDone - tUploadStart,
              validationMs: tValidationDone - tGeminiDone,
              attemptCount: attemptTimings.length,
              retried: attemptTimings.length > 1,
              retryReason: lastRetryReason,
              winnerPromptVariant: currentPromptVariant,
              debugArtifactsEnabled: DEBUG_ARTIFACTS_ENABLED,
              qualityMode: RENDER_QUALITY,
              promptVersion: ACTIVE_PROMPT_VERSION,
              promptLength: prompt.length,
              inputDimensions,
              inputPixelCount: inputDimensions.width * inputDimensions.height,
              outputDimensions: { width, height },
              modelName,
              attemptTimings,
              firstAttemptTimeoutMs:   GEMINI_FIRST_ATTEMPT_TIMEOUT_MS,
              retryAttemptTimeoutMs:   GEMINI_RETRY_ATTEMPT_TIMEOUT_MS,
              // Raw + resolved config — key for diagnosing env var propagation issues.
              envConfig: {
                raw_ROOM_PREVIEW_RENDER_QUALITY:                    perRenderRawQuality,
                raw_ROOM_PREVIEW_RENDER_LONG_EDGE:                  perRenderRawLongEdge,
                raw_ROOM_PREVIEW_GEMINI_FIRST_ATTEMPT_TIMEOUT_MS:   process.env.ROOM_PREVIEW_GEMINI_FIRST_ATTEMPT_TIMEOUT_MS ?? null,
                raw_ROOM_PREVIEW_GEMINI_RETRY_ATTEMPT_TIMEOUT_MS:   process.env.ROOM_PREVIEW_GEMINI_RETRY_ATTEMPT_TIMEOUT_MS ?? null,
                resolvedRenderQuality:                              RENDER_QUALITY,
                resolvedLongEdgeOverride:                           LONG_EDGE_OVERRIDE,
                resolvedMaxImageDimensionPx:                        MAX_IMAGE_DIMENSION_PX,
                resolvedMaxProductImageDimensionPx:                 MAX_PRODUCT_IMAGE_DIMENSION_PX,
                resolvedPromptVariant:                              PROMPT_VARIANT,
                resolvedActivePromptVersion:                        ACTIVE_PROMPT_VERSION,
                resolvedGeminiCallTimeoutMs:                        GEMINI_CALL_TIMEOUT_MS,
                resolvedFirstAttemptTimeoutMs:                      GEMINI_FIRST_ATTEMPT_TIMEOUT_MS,
                resolvedRetryAttemptTimeoutMs:                      GEMINI_RETRY_ATTEMPT_TIMEOUT_MS,
                nodeEnv:                                            process.env.NODE_ENV ?? null,
                vercelEnv:                                          process.env.VERCEL_ENV ?? null,
                vercelRegion:                                       process.env.VERCEL_REGION ?? null,
              },
            },
          }).catch((evtErr) => {
            log.warn({ evtErr, sessionId }, "render_timing_summary event failed (non-fatal)");
          });

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
            lastRetryReason = "aspect_ratio_mismatch";
            attemptTimings.push({
              attempt,
              modelName,
              durationMs: tGeminiStart > 0 ? Date.now() - tGeminiStart : 0,
              status: "aspect_ratio_mismatch",
              retryReason: "aspect_ratio_mismatch",
              attemptTimeoutMs,
              abortedByTimeout: false,
            });
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
            attemptTimings.push({
              attempt,
              modelName,
              durationMs: tGeminiStart > 0 ? Date.now() - tGeminiStart : 0,
              status: "aspect_ratio_mismatch_fatal",
              attemptTimeoutMs,
              abortedByTimeout: false,
            });
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

          // Attempt 1 timed out — retry once with a shorter fallback prompt and
          // reduced image dimensions. The fallback prompt is intentionally simpler
          // (no floor-polygon coordinates, no quality constraints) so Gemini can
          // return within the longer GEMINI_RETRY_ATTEMPT_TIMEOUT_MS budget.
          if (err instanceof GeminiTimeoutError && !timeoutRetried) {
            timeoutRetried = true;
            lastRetryReason = "gemini_timeout";
            attemptTimings.push({
              attempt,
              modelName,
              durationMs: attemptTimeoutMs,
              status: "timeout",
              retryReason: "gemini_timeout",
              attemptTimeoutMs,
              abortedByTimeout: true,
              promptVariant: "normal",
            });

            log.warn(
              {
                event: "gemini_attempt_timeout",
                sessionId,
                modelName,
                attempt,
                timeoutMs: attemptTimeoutMs,
                action: "retrying_with_fallback_prompt",
                nextTimeoutMs: GEMINI_RETRY_ATTEMPT_TIMEOUT_MS,
              },
              "gemini_attempt_timeout: starting fallback retry",
            );

            // Emit session event so the diagnostics timeline shows the timeout.
            trackSessionEvent({
              sessionId,
              source: "renderer",
              eventType: "gemini_attempt_timeout",
              level: "warning",
              metadata: {
                renderJobId: request.jobId,
                attempt,
                modelName,
                timeoutMs: attemptTimeoutMs,
                promptVariant: "normal",
                action: "retry_with_fallback_prompt",
              },
            }).catch(() => {});

            // Reload both images at smaller dimensions to reduce payload size.
            [currentRoomImage, currentProductImage] = await Promise.all([
              loadAndPrepareImage(room.imageUrl, {
                imageRole: "room",
                sessionId,
                maxDimensionOverride: TIMEOUT_RETRY_ROOM_MAX_PX,
              }),
              loadAndPrepareImage(product.imageUrl, {
                imageRole: "product",
                sessionId,
                maxDimensionOverride: TIMEOUT_RETRY_PRODUCT_MAX_PX,
              }),
            ]);

            // Switch to the short fallback prompt — omits polygon coords and
            // quality constraints that may have caused the model to over-think.
            currentPromptVariant = "fallback";
            activePrompt = buildFallbackPrompt(product.name ?? null);

            log.info(
              {
                event: "gemini_retry_started",
                sessionId,
                modelName,
                promptVariant: "fallback",
                fallbackPromptLength: activePrompt.length,
                roomMaxPx: TIMEOUT_RETRY_ROOM_MAX_PX,
                productMaxPx: TIMEOUT_RETRY_PRODUCT_MAX_PX,
                timeoutMs: GEMINI_RETRY_ATTEMPT_TIMEOUT_MS,
              },
              "Gemini retry started with fallback prompt and reduced image dimensions",
            );
            trackSessionEvent({
              sessionId,
              source: "renderer",
              eventType: "gemini_retry_started",
              level: "info",
              metadata: {
                renderJobId: request.jobId,
                attempt: attempt + 1,
                modelName,
                retryReason: "gemini_timeout",
                promptVariant: "fallback",
                fallbackPromptLength: activePrompt.length,
                roomMaxPx: TIMEOUT_RETRY_ROOM_MAX_PX,
                productMaxPx: TIMEOUT_RETRY_PRODUCT_MAX_PX,
                timeoutMs: GEMINI_RETRY_ATTEMPT_TIMEOUT_MS,
              },
            }).catch(() => {});

            continue;
          }

          if (err instanceof GeminiTimeoutError) {
            attemptTimings.push({
              attempt,
              modelName,
              durationMs: attemptTimeoutMs,
              status: "timeout_fatal",
              attemptTimeoutMs,
              abortedByTimeout: true,
            });
            log.warn(
              {
                event: "gemini_attempt_timeout",
                sessionId,
                modelName,
                attempt,
                timeoutMs: attemptTimeoutMs,
                actualDurationMs: attemptTimeoutMs,
                action: "giving_up",
              },
              "gemini_attempt_timeout",
            );
            log.error(
              {
                event: "gemini_retry_failed",
                sessionId,
                modelName,
                attempt,
                timeoutMs: attemptTimeoutMs,
              },
              "Gemini timeout retry also timed out — failing render",
            );
            break;
          }

          if (isRetryableError(err) && attempt < MAX_RETRIES) {
            const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
            attemptTimings.push({
              attempt,
              modelName,
              durationMs: tGeminiStart > 0 ? Date.now() - tGeminiStart : 0,
              status: "retryable_error",
              retryReason: "api_error",
              attemptTimeoutMs,
              abortedByTimeout: false,
            });
            if (!lastRetryReason) lastRetryReason = "api_error";
            log.warn({ err, modelName, attempt, delayMs: delay }, "Retryable error — retrying");
            await sleep(delay);
            continue;
          }

          if (!isRetryableError(err)) {
            attemptTimings.push({
              attempt,
              modelName,
              durationMs: tGeminiStart > 0 ? Date.now() - tGeminiStart : 0,
              status: "non_retryable_error",
              attemptTimeoutMs,
              abortedByTimeout: false,
            });
            log.warn({ err, modelName, attempt }, "Non-retryable error — moving to next model");
            break;
          }

          attemptTimings.push({
            attempt,
            modelName,
            durationMs: tGeminiStart > 0 ? Date.now() - tGeminiStart : 0,
            status: "exhausted_retries",
            attemptTimeoutMs,
            abortedByTimeout: false,
          });
          log.warn({ modelName, maxRetries: MAX_RETRIES }, "Exhausted retries for model — trying next");
          break;
        }
      }
    }

    throw lastError ?? new Error("All Gemini image models failed.");
  },
} satisfies RoomPreviewRenderProvider;
