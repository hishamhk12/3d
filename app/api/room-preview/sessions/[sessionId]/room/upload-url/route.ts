import { NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getLogger } from "@/lib/logger";
import { guardSession } from "@/lib/room-preview/api-guard";
import { trackSessionEvent } from "@/lib/room-preview/session-diagnostics";

const log = getLogger("upload-url-api");

const SUPPORTED_MIME_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 MB
const SIGNED_URL_EXPIRY_SECONDS = 300; // 5 minutes

let _s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (_s3Client) return _s3Client;
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 credentials are not fully configured.");
  }
  _s3Client = new S3Client({
    region: "auto",
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
  return _s3Client;
}

function isValidUploadSource(s: unknown): s is "camera" | "gallery" {
  return s === "camera" || s === "gallery";
}

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;

  const unauthorized = guardSession(request, sessionId);
  if (unauthorized) return unauthorized;

  if (process.env.STORAGE_PROVIDER !== "r2") {
    return NextResponse.json(
      { code: "DIRECT_UPLOAD_NOT_SUPPORTED", error: "Direct upload is only available in production." },
      { status: 501 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { fileName, fileType, fileSize, source } = body as Record<string, unknown>;

  if (typeof fileType !== "string" || !SUPPORTED_MIME_TYPES[fileType]) {
    return NextResponse.json(
      {
        code: "ROOM_UPLOAD_INVALID_MIME_TYPE",
        error: "Unsupported file type. Please upload a JPEG, PNG, or WebP image.",
      },
      { status: 415 },
    );
  }

  if (typeof fileSize !== "number" || fileSize <= 0 || fileSize > MAX_FILE_SIZE) {
    return NextResponse.json(
      {
        code: "ROOM_UPLOAD_FILE_TOO_LARGE",
        error: `Image is too large. Maximum size is ${Math.round(MAX_FILE_SIZE / (1024 * 1024))}MB.`,
      },
      { status: 413 },
    );
  }

  if (!isValidUploadSource(source)) {
    return NextResponse.json({ error: "Invalid upload source." }, { status: 400 });
  }

  const ext = SUPPORTED_MIME_TYPES[fileType];
  const objectKey = `uploads/room-preview/${sessionId}-${source}-${crypto.randomUUID()}.${ext}`;

  const publicBaseUrl = process.env.R2_PUBLIC_URL?.replace(/\/+$/, "");
  const bucket = process.env.R2_BUCKET_NAME;

  if (!publicBaseUrl || !bucket) {
    log.error({ sessionId }, "R2_PUBLIC_URL or R2_BUCKET_NAME is not configured");
    return NextResponse.json({ error: "Storage is not configured." }, { status: 500 });
  }

  const publicUrl = `${publicBaseUrl}/${objectKey}`;

  let uploadUrl: string;
  try {
    const s3 = getS3Client();
    // Do NOT include ContentType or ContentLength in the signed command.
    //
    // When either field is present the SDK adds it to x-amz-signedheaders, which
    // means the browser PUT must send that header with the exact same value.
    // Two problems arise in browser environments:
    //   1. content-length is a forbidden header — browsers manage it themselves
    //      and never include it in the CORS preflight Access-Control-Request-Headers.
    //      R2 rejects the preflight → XHR fires "error" (status 0, network failure).
    //   2. iOS Safari appends "; charset=utf-8" to image/* content-types, making
    //      the actual value differ from the signed one → R2 returns 403.
    //
    // Omitting both means only "host" is signed. MIME type and size have already
    // been validated above before this URL is issued, so security is maintained.
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
    });
    uploadUrl = await getSignedUrl(s3, command, { expiresIn: SIGNED_URL_EXPIRY_SECONDS });
  } catch (err) {
    log.error({ err, sessionId }, "Failed to generate presigned upload URL");
    return NextResponse.json({ error: "Failed to generate upload URL." }, { status: 500 });
  }

  await trackSessionEvent({
    sessionId,
    source: "server",
    eventType: "room_upload_url_requested",
    level: "info",
    metadata: {
      source,
      fileType,
      fileSize,
      fileName: typeof fileName === "string" ? fileName : null,
      objectKey,
    },
  });

  log.info({ sessionId, source, objectKey }, "Upload URL generated");

  return NextResponse.json({
    uploadUrl,
    objectKey,
    publicUrl,
    method: "PUT",
    headers: {},
  });
}
