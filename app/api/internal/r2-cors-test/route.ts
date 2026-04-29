/**
 * TEMPORARY DEBUG ENDPOINT — DELETE AFTER R2 CORS DEBUGGING IS COMPLETE
 *
 * GET /api/debug/r2-cors-test?secret=<DEBUG_SECRET>
 *
 * Returns a presigned R2 PUT URL so you can test direct browser → R2 uploads
 * from DevTools without involving the QR/session/mobile flow.
 *
 * To remove: delete the entire app/api/debug/ directory.
 */

import { NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const SIGNED_URL_EXPIRY_SECONDS = 300; // 5 minutes

export async function GET(request: Request) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const debugSecret = process.env.DEBUG_SECRET;
  if (!debugSecret) {
    // Env var not configured — behave as if the route doesn't exist.
    return new NextResponse(null, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  if (searchParams.get("secret") !== debugSecret) {
    return new NextResponse(null, { status: 404 });
  }

  // ── R2 config validation ────────────────────────────────────────────────────
  const endpoint        = process.env.R2_ENDPOINT;
  const accessKeyId     = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket          = process.env.R2_BUCKET_NAME;
  const publicBaseUrl   = process.env.R2_PUBLIC_URL?.replace(/\/+$/, "");

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) {
    return NextResponse.json(
      { error: "One or more R2 env vars are missing.", missing: {
        R2_ENDPOINT:         !endpoint,
        R2_ACCESS_KEY_ID:    !accessKeyId,
        R2_SECRET_ACCESS_KEY: !secretAccessKey,
        R2_BUCKET_NAME:      !bucket,
        R2_PUBLIC_URL:       !publicBaseUrl,
      }},
      { status: 500 },
    );
  }

  // ── Generate presigned URL ──────────────────────────────────────────────────
  const objectKey = `debug/r2-cors-test-${crypto.randomUUID()}.txt`;

  const s3 = new S3Client({
    region: "auto",
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });

  // No ContentType, ContentLength, ACL, or metadata — only host is signed.
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: objectKey,
  });

  let uploadUrl: string;
  try {
    uploadUrl = await getSignedUrl(s3, command, { expiresIn: SIGNED_URL_EXPIRY_SECONDS });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "Failed to generate presigned URL.", detail: message }, { status: 500 });
  }

  // Log hostname only — never the full signed URL (contains secret query params).
  let host = "unknown";
  try { host = new URL(uploadUrl).hostname; } catch { /* ignore */ }

  console.info("[debug] r2-cors-test presigned URL generated", { host, objectKey, bucket });

  return NextResponse.json({
    uploadUrl,
    host,
    objectKey,
    publicUrl: `${publicBaseUrl}/${objectKey}`,
    method:  "PUT",
    headers: {},
    expiresInSeconds: SIGNED_URL_EXPIRY_SECONDS,
    note: "TEMPORARY DEBUG ENDPOINT — delete app/api/debug/ when done",
  });
}
