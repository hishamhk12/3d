import { after, NextResponse } from "next/server";
import { getLogger } from "@/lib/logger";
import { guardSession } from "@/lib/room-preview/api-guard";
import { trackEvent, getUserSessionIdForSession } from "@/lib/analytics/event-tracker";
import { getRoomPreviewDemoRoom } from "@/data/room-preview/demo-rooms";
import {
  getRoomPreviewSession,
  isRoomPreviewSessionExpiredError,
  isRoomPreviewSessionNotFoundError,
  RoomPreviewSessionTransitionError,
  selectRoomForSession,
} from "@/lib/room-preview/session-service";
import {
  RoomPreviewUploadError,
  saveRoomPreviewUploadedFile,
} from "@/lib/room-preview/upload-service";
import type { SelectedRoom } from "@/lib/room-preview/types";

const log = getLogger("room-api");

function isUploadSource(source: string): source is "camera" | "gallery" {
  return source === "camera" || source === "gallery";
}

function isAbortedUploadError(error: unknown) {
  return error instanceof Error && error.message === "aborted";
}

export async function POST(
  request: Request,
  context: RouteContext<"/api/room-preview/sessions/[sessionId]/room">,
) {
  const { sessionId } = await context.params;

  const unauthorized = guardSession(request, sessionId);
  if (unauthorized) return unauthorized;

  // Reject oversized uploads before parsing the body.
  const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { code: "ROOM_UPLOAD_FILE_TOO_LARGE", error: "File must be 10 MB or smaller." },
      { status: 413 },
    );
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch (err) {
    const isAborted = isAbortedUploadError(err);
    if (isAborted) {
      log.warn({ sessionId }, "Room upload request was aborted before parsing completed");
    } else {
      log.error({ err, sessionId }, "Failed to parse room upload form data");
    }

    return NextResponse.json(
      {
        code: "ROOM_UPLOAD_ABORTED",
        error: "Upload was interrupted. Please try again.",
      },
      { status: 408 },
    );
  }

  const rawSource = formData.get("source");

  if (typeof rawSource !== "string") {
    log.warn({ sessionId }, "Missing room source in save request");
    return NextResponse.json({ error: "Room source is required." }, { status: 400 });
  }

  let room: SelectedRoom;

  if (rawSource === "demo") {
    const demoRoomId = formData.get("demoRoomId");

    if (typeof demoRoomId !== "string") {
      log.warn({ sessionId }, "Missing demo room id");
      return NextResponse.json({ error: "Demo room id is required." }, { status: 400 });
    }

    const demoRoom = getRoomPreviewDemoRoom(demoRoomId);

    if (!demoRoom) {
      log.warn({ sessionId, demoRoomId }, "Invalid demo room id");
      return NextResponse.json({ error: "Demo room not found." }, { status: 404 });
    }

    room = {
      source: "demo",
      imageUrl: demoRoom.imageUrl,
      demoRoomId: demoRoom.id,
      floorQuad: demoRoom.floorQuad,
      previewRegion: demoRoom.previewRegion,
    };
  } else if (isUploadSource(rawSource)) {
    const image = formData.get("image");

    if (!(image instanceof File) || image.size === 0) {
      log.warn(
        {
          sessionId,
          source: rawSource,
          fileName: image instanceof File ? image.name : null,
          fileSize: image instanceof File ? image.size : null,
          fileType: image instanceof File ? image.type : null,
        },
        "Missing uploaded file",
      );
      return NextResponse.json(
        {
          code: "ROOM_UPLOAD_MISSING_FILE",
          error: "Please choose an image file to upload.",
        },
        { status: 400 },
      );
    }

    try {
      const uploadedRoom = await saveRoomPreviewUploadedFile({
        file: image,
        sessionId,
        source: rawSource,
      });

      room = uploadedRoom.room;
    } catch (err) {
      const isAborted =
        err instanceof RoomPreviewUploadError && err.code === "ROOM_UPLOAD_ABORTED";

      if (isAborted) {
        log.warn(
          { sessionId, fileName: image.name, source: rawSource },
          "Uploaded room processing was aborted",
        );
      } else {
        log.error(
          {
            err,
            sessionId,
            source: rawSource,
            fileName: image.name,
            fileSize: image.size,
            fileType: image.type,
          },
          "Failed to process uploaded room image",
        );
      }

      if (err instanceof RoomPreviewUploadError) {
        return NextResponse.json(
          { code: err.code, error: err.message },
          { status: err.status },
        );
      }

      return NextResponse.json(
        {
          code: "ROOM_UPLOAD_SAVE_FAILED",
          error: err instanceof Error ? err.message : "Failed to save the uploaded image.",
        },
        { status: 500 },
      );
    }
  } else {
    log.warn({ sessionId, source: rawSource }, "Unsupported room source");
    return NextResponse.json({ error: "Unsupported room source." }, { status: 400 });
  }

  let session = null;

  try {
    session = await selectRoomForSession(sessionId, room);
  } catch (error) {
    if (isRoomPreviewSessionNotFoundError(error)) {
      log.warn({ sessionId, source: room.source }, "Room save attempted for missing session");
      return NextResponse.json(
        { code: error.code, error: error.message },
        { status: 404 },
      );
    }

    if (isRoomPreviewSessionExpiredError(error)) {
      log.warn({ sessionId, source: room.source }, "Room save attempted for expired session");
      return NextResponse.json(
        { code: error.code, error: error.message },
        { status: 410 },
      );
    }

    if (error instanceof RoomPreviewSessionTransitionError) {
      log.warn(
        { sessionId, source: room.source, currentStatus: error.currentStatus },
        "Invalid room selection transition",
      );
      return NextResponse.json(
        { code: error.code, error: error.message },
        { status: 400 },
      );
    }

    log.error(
      { err: error, sessionId, source: room.source },
      "Failed to save room selection",
    );
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
      "Missing room state after save",
    );
    return NextResponse.json(
      {
        code: "ROOM_UPLOAD_VERIFY_FAILED",
        error: "Failed to verify the uploaded room after saving.",
      },
      { status: 500 },
    );
  }

  log.info(
    {
      sessionId,
      source: session.selectedRoom.source,
      demoRoomId: session.selectedRoom.demoRoomId ?? null,
      status: session.status,
    },
    "Room saved",
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

  return NextResponse.json({
    success: true,
    room: session.selectedRoom,
  });
}
