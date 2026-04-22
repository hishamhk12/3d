import { ROOM_PREVIEW_ROUTES, ROOM_PREVIEW_TIMEOUTS } from "@/lib/room-preview/constants";
import {
  fetchRoomPreviewSession,
  isRoomPreviewRequestError,
  requestRoomPreviewJson,
  RoomPreviewRequestError,
} from "@/lib/room-preview/session-client";
import type {
  RoomPreviewRoomSource,
  SaveRoomPreviewSessionResult,
  SaveRoomPreviewSessionRoomResponse,
} from "@/lib/room-preview/types";
import {
  assertValidResponse,
  isSaveRoomPreviewSessionRoomResponse,
} from "@/lib/room-preview/validators";


function wait(durationMs: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function getRoomPreviewUploadTimeoutMs(fileSizeBytes: number) {
  const fileSizeInMegabytes = fileSizeBytes / (1024 * 1024);
  const computedTimeoutMs =
    15000 + Math.ceil(fileSizeInMegabytes * ROOM_PREVIEW_TIMEOUTS.UPLOAD_PER_MB_MS);

  return Math.min(
    ROOM_PREVIEW_TIMEOUTS.UPLOAD_MAX_MS,
    Math.max(ROOM_PREVIEW_TIMEOUTS.UPLOAD_MIN_MS, computedTimeoutMs),
  );
}

function assertRoomSaveResponse(data: unknown) {
  try {
    return assertValidResponse<SaveRoomPreviewSessionRoomResponse>(
      data,
      isSaveRoomPreviewSessionRoomResponse,
      "The server returned an invalid room selection response.",
    );
  } catch {
    throw new RoomPreviewRequestError(
      "invalid_response",
      "The server returned an invalid room selection response.",
    );
  }
}

export async function saveRoomPreviewSessionRoom(
  sessionId: string,
  options:
    | {
        source: "demo";
        demoRoomId: string;
      }
    | {
        source: Exclude<RoomPreviewRoomSource, "demo">;
        file: File;
        previousRoomImageUrl?: string | null;
      },
) {
  const formData = new FormData();
  formData.set("source", options.source);

  if (options.source === "demo") {
    formData.set("demoRoomId", options.demoRoomId);
  } else {
    formData.set("image", options.file);
  }

  const requestTimeoutMs =
    options.source === "demo"
      ? ROOM_PREVIEW_TIMEOUTS.REQUEST_MS
      : getRoomPreviewUploadTimeoutMs(options.file.size);

  let data: unknown;

  try {
    data = await requestRoomPreviewJson(
      ROOM_PREVIEW_ROUTES.roomApi(sessionId),
      {
        method: "POST",
        body: formData,
        cache: "no-store",
      },
      "Could not save the selected room for this session.",
      requestTimeoutMs,
    );
  } catch (error) {
    if (
      options.source !== "demo" &&
      isRoomPreviewRequestError(error) &&
      error.code === "timeout"
    ) {
      const timeoutDeadline = Date.now() + ROOM_PREVIEW_TIMEOUTS.UPLOAD_RECOVERY_WINDOW_MS;

      while (Date.now() < timeoutDeadline) {
        try {
          const recoveredSession = await fetchRoomPreviewSession(sessionId);
          const recoveredRoom = recoveredSession.selectedRoom;

          if (
            recoveredRoom?.source === options.source &&
            recoveredRoom.imageUrl &&
            recoveredRoom.imageUrl !== (options.previousRoomImageUrl ?? null)
          ) {
            console.warn("[room-preview] Recovered uploaded room after client timeout", {
              previousRoomImageUrl: options.previousRoomImageUrl ?? null,
              recoveredRoom,
              sessionId,
              source: options.source,
            });

            return {
              room: recoveredRoom,
              session: recoveredSession,
            } satisfies SaveRoomPreviewSessionResult;
          }
        } catch (recoveryError) {
          if (
            isRoomPreviewRequestError(recoveryError) &&
            (recoveryError.code === "expired" || recoveryError.code === "not_found")
          ) {
            throw recoveryError;
          }
        }

        await wait(ROOM_PREVIEW_TIMEOUTS.UPLOAD_RECOVERY_POLL_MS);
      }

      throw new RoomPreviewRequestError(
        "timeout",
        "Uploading this image is taking longer than expected. Please wait a moment and try again.",
        {
          status: error.status,
        },
      );
    }

    throw error;
  }

  const saveResponse = assertRoomSaveResponse(data);
  const session = await fetchRoomPreviewSession(sessionId);
  const selectedRoom = session.selectedRoom;

  if (!selectedRoom?.imageUrl || selectedRoom.source !== saveResponse.room.source) {
    console.error("[room-preview] Missing room state after save", {
      requestedSource: options.source,
      reloadedRoom: selectedRoom,
      savedRoom: saveResponse.room,
      sessionId,
      status: session.status,
    });

    throw new RoomPreviewRequestError("server", "Failed to save room. Please try again.");
  }

  if (options.source === "demo" && selectedRoom.demoRoomId !== options.demoRoomId) {
    console.error("[room-preview] Demo room id mismatch after save", {
      expectedDemoRoomId: options.demoRoomId,
      reloadedRoom: selectedRoom,
      sessionId,
    });

    throw new RoomPreviewRequestError("server", "Failed to save room. Please try again.");
  }

  return {
    room: saveResponse.room,
    session,
  } satisfies SaveRoomPreviewSessionResult;
}
