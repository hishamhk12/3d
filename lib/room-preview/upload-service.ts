import "server-only";

import type { RoomPreviewSessionRoom } from "@/lib/room-preview/types";
import { storageUpload } from "@/lib/storage";

const ROOM_PREVIEW_UPLOAD_KEY_PREFIX = "uploads/room-preview";

const ROOM_PREVIEW_SUPPORTED_UPLOAD_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export const ROOM_PREVIEW_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// ─── Image dimension constraints ──────────────────────────────────────────────

const MIN_DIMENSION_PX = 400;
const MAX_DIMENSION_PX = 20_000;
const MIN_ASPECT_RATIO = 0.25; // 1:4 portrait limit
const MAX_ASPECT_RATIO = 4.0;  // 4:1 landscape limit

// ─── Magic-byte signatures ────────────────────────────────────────────────────

const MAGIC_BYTES: Record<string, number[]> = {
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png":  [0x89, 0x50, 0x4e, 0x47],
  "image/webp": [0x52, 0x49, 0x46, 0x46], // "RIFF"
};

// ─── Error class ──────────────────────────────────────────────────────────────

export class RoomPreviewUploadError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "RoomPreviewUploadError";
    this.code = code;
    this.status = status;
  }
}

// ─── Type guards ──────────────────────────────────────────────────────────────

function isSupportedUploadMimeType(
  mimeType: string,
): mimeType is keyof typeof ROOM_PREVIEW_SUPPORTED_UPLOAD_TYPES {
  return mimeType in ROOM_PREVIEW_SUPPORTED_UPLOAD_TYPES;
}

// ─── Validators ───────────────────────────────────────────────────────────────

/**
 * Verify the first bytes of the buffer match the declared MIME type.
 * Rejects files whose Content-Type header has been spoofed by the client.
 */
function validateMagicBytes(buffer: Buffer, mimeType: string): void {
  const signature = MAGIC_BYTES[mimeType];
  if (!signature) return; // unknown type already blocked by allowlist

  const matches = signature.every((byte, i) => buffer[i] === byte);
  if (!matches) {
    throw new RoomPreviewUploadError(
      "ROOM_UPLOAD_INVALID_MIME_TYPE",
      "The uploaded file does not appear to be a valid image.",
      415,
    );
  }
}

/**
 * Decode the image with sharp and enforce minimum/maximum dimension and
 * aspect-ratio constraints.  Rejects corrupt, too-small, too-large, and
 * oddly-shaped files before they ever reach the AI.
 */
async function validateImageDimensions(buffer: Buffer): Promise<void> {
  const { default: sharp } = await import("sharp");

  let width: number;
  let height: number;

  try {
    const meta = await sharp(buffer).metadata();
    width  = meta.width  ?? 0;
    height = meta.height ?? 0;
  } catch {
    throw new RoomPreviewUploadError(
      "ROOM_UPLOAD_INVALID_IMAGE",
      "The uploaded file could not be decoded as an image.",
      422,
    );
  }

  if (width < MIN_DIMENSION_PX || height < MIN_DIMENSION_PX) {
    throw new RoomPreviewUploadError(
      "ROOM_UPLOAD_INVALID_IMAGE",
      `Image is too small. Minimum size is ${MIN_DIMENSION_PX}×${MIN_DIMENSION_PX} pixels.`,
      422,
    );
  }

  if (width > MAX_DIMENSION_PX || height > MAX_DIMENSION_PX) {
    throw new RoomPreviewUploadError(
      "ROOM_UPLOAD_INVALID_IMAGE",
      `Image dimensions exceed the maximum allowed (${MAX_DIMENSION_PX}px per side).`,
      422,
    );
  }

  const ratio = width / height;
  if (ratio < MIN_ASPECT_RATIO || ratio > MAX_ASPECT_RATIO) {
    throw new RoomPreviewUploadError(
      "ROOM_UPLOAD_INVALID_IMAGE",
      "Image has an unusual aspect ratio. Please upload a standard room photo.",
      422,
    );
  }
}

// ─── File name / key builders ─────────────────────────────────────────────────

function buildUploadFileName(sessionId: string, source: "camera" | "gallery", extension: string) {
  return `${sessionId}-${source}-${crypto.randomUUID()}.${extension}`;
}

// ─── Log context helper ───────────────────────────────────────────────────────

export function getRoomPreviewUploadLogContext(context: {
  error?: unknown;
  fileName?: string | null;
  fileSize?: number | null;
  fileType?: string | null;
  sessionId: string;
  source?: string | null;
}) {
  const error =
    context.error instanceof Error
      ? {
          message: context.error.message,
          name: context.error.name,
          stack: context.error.stack ?? null,
        }
      : context.error
        ? {
            message: String(context.error),
            name: typeof context.error,
            stack: null,
          }
        : null;

  return JSON.stringify({
    error,
    fileName: context.fileName ?? null,
    fileSize: context.fileSize ?? null,
    fileType: context.fileType ?? null,
    sessionId: context.sessionId,
    source: context.source ?? null,
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function validateRoomPreviewUploadedFile(file: File) {
  if (file.size === 0) {
    throw new RoomPreviewUploadError(
      "ROOM_UPLOAD_MISSING_FILE",
      "Please choose an image file to upload.",
      400,
    );
  }

  if (!isSupportedUploadMimeType(file.type)) {
    throw new RoomPreviewUploadError(
      "ROOM_UPLOAD_INVALID_MIME_TYPE",
      "Unsupported image type. Please upload a JPEG, PNG, or WebP image.",
      415,
    );
  }

  if (file.size > ROOM_PREVIEW_MAX_UPLOAD_BYTES) {
    throw new RoomPreviewUploadError(
      "ROOM_UPLOAD_FILE_TOO_LARGE",
      `Image is too large. Maximum size is ${Math.round(
        ROOM_PREVIEW_MAX_UPLOAD_BYTES / (1024 * 1024),
      )}MB.`,
      413,
    );
  }

  return {
    extension: ROOM_PREVIEW_SUPPORTED_UPLOAD_TYPES[file.type],
  };
}

export async function saveRoomPreviewUploadedFile(options: {
  file: File;
  sessionId: string;
  source: "camera" | "gallery";
}) {
  const { file, sessionId, source } = options;
  const validation = validateRoomPreviewUploadedFile(file);

  let buffer: Buffer;

  try {
    buffer = Buffer.from(await file.arrayBuffer());
  } catch (err) {
    const isAbort = err instanceof DOMException && err.name === "AbortError";
    throw new RoomPreviewUploadError(
      isAbort ? "ROOM_UPLOAD_ABORTED" : "ROOM_UPLOAD_SAVE_FAILED",
      isAbort
        ? "Upload was interrupted. Please try again."
        : "Could not read the uploaded file.",
      isAbort ? 408 : 500,
    );
  }

  // ── P0-2: Verify file magic bytes match the declared MIME type ────────────
  validateMagicBytes(buffer, file.type);

  // ── P1-3: Reject images that are too small, too large, or oddly shaped ────
  await validateImageDimensions(buffer);

  const fileName = buildUploadFileName(sessionId, source, validation.extension);
  const storageKey = `${ROOM_PREVIEW_UPLOAD_KEY_PREFIX}/${fileName}`;

  try {
    const result = await storageUpload(storageKey, buffer, file.type);

    return {
      room: {
        source,
        imageUrl: result.publicUrl,
        demoRoomId: null,
        floorQuad: null,
        previewRegion: null,
      } satisfies RoomPreviewSessionRoom,
    };
  } catch {
    throw new RoomPreviewUploadError(
      "ROOM_UPLOAD_SAVE_FAILED",
      "Failed to save the uploaded image.",
      500,
    );
  }
}
