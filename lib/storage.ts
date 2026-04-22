import "server-only";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getLogger } from "@/lib/logger";

const log = getLogger("storage");

// ─── Types ────────────────────────────────────────────────────────────────────

export type StorageUploadResult = {
  /** Public URL to access the file */
  publicUrl: string;
  /** Storage key (for deletion) */
  key: string;
};

// ─── Configuration ────────────────────────────────────────────────────────────

const STORAGE_PROVIDER = process.env.STORAGE_PROVIDER ?? "local"; // "local" | "r2" | "s3"

function isCloudStorage() {
  return STORAGE_PROVIDER === "r2" || STORAGE_PROVIDER === "s3";
}

// Warn loudly at startup when local storage is used in production.
//
// Local storage writes to public/uploads/ on the server's own filesystem.
// On any serverless or multi-instance platform this means:
//   - Files are lost on every deployment or instance restart.
//   - Renders produced on instance A are not visible on instance B.
//   - All image traffic is served by the Node.js process itself (no CDN).
//
// Set STORAGE_PROVIDER=r2 (or s3) and configure the matching env vars
// before deploying to a production environment.
// NEXT_PHASE=phase-production-build during `next build` — skip the guard then
// because storage is never called at build time, only at request time.
if (
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PHASE !== "phase-production-build" &&
  !isCloudStorage()
) {
  throw new Error(
    "STORAGE_PROVIDER must be 'r2' or 's3' in production. " +
    "Local filesystem storage loses all uploads on every deployment or instance restart. " +
    "Set STORAGE_PROVIDER=r2 and configure R2_* env vars before deploying.",
  );
}

// ─── S3-compatible client (for R2 and S3) ─────────────────────────────────────

let _s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (_s3Client) return _s3Client;

  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Cloud storage is enabled but R2_ENDPOINT, R2_ACCESS_KEY_ID, or R2_SECRET_ACCESS_KEY is missing.",
    );
  }

  _s3Client = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });

  return _s3Client;
}

function getBucketName(): string {
  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) throw new Error("R2_BUCKET_NAME is not configured.");
  return bucket;
}

function getPublicBaseUrl(): string {
  const url = process.env.R2_PUBLIC_URL;
  if (!url) throw new Error("R2_PUBLIC_URL is not configured.");
  return url.replace(/\/+$/, ""); // remove trailing slash
}

// ─── Local storage helpers ────────────────────────────────────────────────────

const LOCAL_PUBLIC_DIR = path.join(process.cwd(), "public");

function localKeyToFilePath(key: string): string {
  return path.join(LOCAL_PUBLIC_DIR, ...key.split("/"));
}

function localKeyToPublicUrl(key: string): string {
  return `/${key}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Upload a file to storage.
 *
 * @param key    — The storage key / path, e.g. "uploads/room-preview/abc.jpg"
 * @param data   — The file contents as a Buffer
 * @param contentType — MIME type, e.g. "image/jpeg"
 */
export async function storageUpload(
  key: string,
  data: Buffer,
  contentType: string,
): Promise<StorageUploadResult> {
  if (isCloudStorage()) {
    // ─── Cloud (R2 / S3) ─────────────────────────────────────────────
    const s3 = getS3Client();

    await s3.send(
      new PutObjectCommand({
        Bucket: getBucketName(),
        Key: key,
        Body: data,
        ContentType: contentType,
      }),
    );

    return {
      publicUrl: `${getPublicBaseUrl()}/${key}`,
      key,
    };
  }

  // ─── Local filesystem ────────────────────────────────────────────────
  const filePath = localKeyToFilePath(key);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, data);

  return {
    publicUrl: localKeyToPublicUrl(key),
    key,
  };
}

/**
 * Delete a file from storage.
 */
export async function storageDelete(key: string): Promise<void> {
  if (isCloudStorage()) {
    const s3 = getS3Client();

    await s3.send(
      new DeleteObjectCommand({
        Bucket: getBucketName(),
        Key: key,
      }),
    );
    return;
  }

  // ─── Local: best-effort delete ────────────────────────────────────
  const { unlink } = await import("node:fs/promises");
  const filePath = localKeyToFilePath(key);

  try {
    await unlink(filePath);
  } catch {
    // ignore — file may already be gone
  }
}

/**
 * Get the public URL for a storage key.
 */
export function storagePublicUrl(key: string): string {
  if (isCloudStorage()) {
    return `${getPublicBaseUrl()}/${key}`;
  }

  return localKeyToPublicUrl(key);
}
