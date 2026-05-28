import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { getRoomPreviewPublicAssetPath } from "@/lib/room-preview/local-assets";
import { getLogger } from "@/lib/logger";
import {
  MAX_ASPECT_RATIO_DRIFT,
  MAX_IMAGE_DIMENSION_PX,
  MAX_PRODUCT_IMAGE_DIMENSION_PX,
  MIN_OUTPUT_BYTES,
  MIN_OUTPUT_DIMENSION_PX,
  REJECT_ASPECT_RATIO_DRIFT,
} from "@/lib/room-preview/render-providers/gemini-config";
import { AspectRatioMismatchError } from "@/lib/room-preview/render-providers/gemini-errors";

// Use the same logger name as the provider so log events are indistinguishable
// from the caller's perspective — moving this code must not change log output.
const log = getLogger("gemini-provider");

// ─── MIME helpers ─────────────────────────────────────────────────────────────

export function extensionToMimeType(ext: string): string {
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

// ─── Prepared image type ──────────────────────────────────────────────────────

export type PreparedImage = {
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

// ─── Image loader + preparer ──────────────────────────────────────────────────

export const IMAGE_FETCH_TIMEOUT_MS = 15_000;

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
export async function loadAndPrepareImage(
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

// ─── Output image validation + normalization ──────────────────────────────────

export async function validateAndNormalizeOutputImage(
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
