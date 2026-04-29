import { after, NextResponse } from "next/server";
import { getLogger } from "@/lib/logger";
import { guardSession } from "@/lib/room-preview/api-guard";
import { trackEvent, getUserSessionIdForSession } from "@/lib/analytics/event-tracker";
import {
  getRoomPreviewSession,
  isRoomPreviewSessionExpiredError,
  isRoomPreviewSessionNotFoundError,
  RoomPreviewSessionTransitionError,
  selectRoomForSession,
} from "@/lib/room-preview/session-service";
import {
  diagnosticsErrorMetadata,
  openSessionIssue,
  resolveSessionIssue,
  trackSessionEvent,
} from "@/lib/room-preview/session-diagnostics";
import type { SelectedRoom } from "@/lib/room-preview/types";

const log = getLogger("confirm-upload-api");

const SUPPORTED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 MB

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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { objectKey, publicUrl, fileName, fileType, fileSize, source } = body as Record<
    string,
    unknown
  >;

  // Verify objectKey belongs to this session — prevents clients from pointing at
  // another session's upload or an arbitrary URL.
  const expectedPrefix = `uploads/room-preview/${sessionId}-`;
  if (typeof objectKey !== "string" || !objectKey.startsWith(expectedPrefix)) {
    log.warn({ sessionId, objectKey }, "Rejected confirm-upload: invalid object key");
    return NextResponse.json(
      { code: "ROOM_UPLOAD_SAVE_FAILED", error: "Invalid upload reference." },
      { status: 400 },
    );
  }

  if (typeof publicUrl !== "string" || !publicUrl.startsWith("http")) {
    return NextResponse.json({ error: "Invalid public URL." }, { status: 400 });
  }

  if (!isValidUploadSource(source)) {
    return NextResponse.json({ error: "Invalid upload source." }, { status: 400 });
  }

  if (typeof fileType === "string" && !SUPPORTED_MIME_TYPES.has(fileType)) {
    return NextResponse.json(
      { code: "ROOM_UPLOAD_INVALID_MIME_TYPE", error: "Unsupported file type." },
      { status: 415 },
    );
  }

  if (typeof fileSize === "number" && fileSize > MAX_FILE_SIZE) {
    return NextResponse.json(
      { code: "ROOM_UPLOAD_FILE_TOO_LARGE", error: "File exceeds maximum allowed size." },
      { status: 413 },
    );
  }

  await trackSessionEvent({
    sessionId,
    source: "server",
    eventType: "room_direct_upload_confirmed",
    level: "info",
    metadata: {
      source,
      fileType: typeof fileType === "string" ? fileType : null,
      fileSize: typeof fileSize === "number" ? fileSize : null,
      fileName: typeof fileName === "string" ? fileName : null,
      objectKey,
    },
  });

  const room: SelectedRoom = {
    source,
    imageUrl: publicUrl,
    demoRoomId: null,
    floorQuad: null,
    previewRegion: null,
  };

  let session = null;

  try {
    session = await selectRoomForSession(sessionId, room);
  } catch (error) {
    if (isRoomPreviewSessionNotFoundError(error)) {
      log.warn({ sessionId, source }, "Confirm-upload attempted for missing session");
      return NextResponse.json({ code: error.code, error: error.message }, { status: 404 });
    }

    if (isRoomPreviewSessionExpiredError(error)) {
      log.warn({ sessionId, source }, "Confirm-upload attempted for expired session");
      return NextResponse.json({ code: error.code, error: error.message }, { status: 410 });
    }

    if (error instanceof RoomPreviewSessionTransitionError) {
      log.warn(
        { sessionId, source, currentStatus: error.currentStatus },
        "Invalid room selection transition on confirm-upload",
      );
      return NextResponse.json({ code: error.code, error: error.message }, { status: 400 });
    }

    log.error({ err: error, sessionId, source }, "Failed to save room selection on confirm-upload");
    await trackSessionEvent({
      sessionId,
      source: "server",
      eventType: "room_direct_upload_failed",
      level: "error",
      code: "ROOM_UPLOAD_SAVE_FAILED",
      metadata: { error: diagnosticsErrorMetadata(error), objectKey, source },
    });
    await openSessionIssue({
      sessionId,
      type: "ROOM_UPLOAD_FAILED",
      metadata: { code: "ROOM_UPLOAD_SAVE_FAILED", source },
    });
    return NextResponse.json(
      { code: "ROOM_UPLOAD_SAVE_FAILED", error: "Failed to save room." },
      { status: 500 },
    );
  }

  const verifiedSession = await getRoomPreviewSession(sessionId);

  if (
    !session.selectedRoom?.imageUrl ||
    !verifiedSession?.selectedRoom?.imageUrl ||
    verifiedSession.selectedRoom.imageUrl !== session.selectedRoom.imageUrl
  ) {
    log.error(
      {
        sessionId,
        savedRoom: room,
        sessionRoom: session.selectedRoom,
        verifiedRoom: verifiedSession?.selectedRoom ?? null,
      },
      "Missing room state after confirm-upload",
    );
    await trackSessionEvent({
      sessionId,
      source: "server",
      eventType: "room_direct_upload_failed",
      level: "error",
      code: "ROOM_UPLOAD_VERIFY_FAILED",
      metadata: {
        savedRoom: room,
        sessionRoom: session.selectedRoom,
        verifiedRoom: verifiedSession?.selectedRoom ?? null,
      },
    });
    await openSessionIssue({
      sessionId,
      type: "ROOM_UPLOAD_FAILED",
      metadata: { code: "ROOM_UPLOAD_VERIFY_FAILED", source },
    });
    return NextResponse.json(
      { code: "ROOM_UPLOAD_VERIFY_FAILED", error: "Failed to verify the uploaded room." },
      { status: 500 },
    );
  }

  log.info(
    {
      sessionId,
      source: session.selectedRoom.source,
      status: session.status,
      objectKey,
    },
    "Direct upload confirmed and room saved",
  );

  after(async () => {
    const userSessionId = await getUserSessionIdForSession(sessionId);
    if (userSessionId) {
      await trackEvent({
        userSessionId,
        eventType: "room_opened",
        sessionId,
        metadata: {
          source: session.selectedRoom?.source,
          demoRoomId: session.selectedRoom?.demoRoomId ?? null,
        },
      });
    }
  });

  await resolveSessionIssue({
    sessionId,
    type: "ROOM_UPLOAD_FAILED",
    metadata: { source: session.selectedRoom.source },
  });
  await resolveSessionIssue({
    sessionId,
    type: "ROOM_UPLOAD_STUCK",
    metadata: { source: session.selectedRoom.source },
  });
  await trackSessionEvent({
    sessionId,
    source: "server",
    eventType: "room_upload_completed",
    level: "info",
    statusAfter: session.status,
    metadata: {
      source: session.selectedRoom.source,
      directUpload: true,
    },
  });

  return NextResponse.json({
    success: true,
    room: session.selectedRoom,
    session: verifiedSession,
  });
}
