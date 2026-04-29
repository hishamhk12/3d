import { ROOM_PREVIEW_ROUTES, ROOM_PREVIEW_TIMEOUTS } from "@/lib/room-preview/constants";
import {
  fetchRoomPreviewSession,
  isRoomPreviewRequestError,
  requestRoomPreviewJson,
  RoomPreviewRequestError,
} from "@/lib/room-preview/session-client";
import type {
  DirectUploadUrlResponse,
  RoomPreviewRoomSource,
  SaveRoomPreviewSessionResult,
  SaveRoomPreviewSessionRoomResponse,
} from "@/lib/room-preview/types";
import {
  assertValidResponse,
  isDirectUploadUrlResponse,
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
  const session = saveResponse.session;
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

// ─── Direct upload (R2 presigned PUT) ─────────────────────────────────────────

export type DirectUploadFileOptions = {
  source: "camera" | "gallery";
  file: File;
};

export async function requestDirectUploadUrl(
  sessionId: string,
  options: DirectUploadFileOptions,
): Promise<DirectUploadUrlResponse> {
  const { source, file } = options;

  const data = await requestRoomPreviewJson(
    ROOM_PREVIEW_ROUTES.uploadUrlApi(sessionId),
    {
      method: "POST",
      body: JSON.stringify({
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        source,
      }),
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    },
    "Could not get an upload URL.",
    ROOM_PREVIEW_TIMEOUTS.REQUEST_MS,
  );

  try {
    return assertValidResponse<DirectUploadUrlResponse>(
      data,
      isDirectUploadUrlResponse,
      "The server returned an invalid upload URL response.",
    );
  } catch {
    throw new RoomPreviewRequestError(
      "invalid_response",
      "The server returned an invalid upload URL response.",
    );
  }
}

export type R2FailureDetails = {
  status: number;
  statusText: string;
  responseText: string;
  host: string;
};

export type UploadFileToR2Options = {
  onProgress?: (percent: number) => void;
  onR2Failure?: (details: R2FailureDetails) => void;
};

export function uploadFileToR2(
  uploadUrl: string,
  file: File,
  options?: UploadFileToR2Options,
): Promise<void> {
  // Extract hostname only — never log the full signed URL (contains secret query params).
  let uploadHost = "unknown";
  try { uploadHost = new URL(uploadUrl).hostname; } catch { /* ignore */ }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl, true);
    // No custom headers — avoids CORS preflight Access-Control-Request-Headers
    // complications with R2. Content-Type is intentionally omitted; the object
    // is confirmed server-side after upload so the stored MIME type is not critical.

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        options?.onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }

      const details: R2FailureDetails = {
        status: xhr.status,
        statusText: xhr.statusText,
        responseText: xhr.responseText.slice(0, 1000),
        host: uploadHost,
      };

      console.error("[room-preview] R2 PUT failed", {
        host: details.host,
        status: details.status,
        statusText: details.statusText,
        responseText: details.responseText,
        fileType: file.type,
        fileSize: file.size,
      });

      options?.onR2Failure?.(details);

      if (xhr.status === 403) {
        reject(
          new RoomPreviewRequestError(
            "server",
            "انتهت صلاحية رابط الرفع، حاول مرة أخرى",
            { status: 403 },
          ),
        );
      } else {
        reject(
          new RoomPreviewRequestError(
            "server",
            "تعذر رفع الصورة، تحقق من الاتصال وحاول مرة أخرى",
            { status: xhr.status },
          ),
        );
      }
    });

    xhr.addEventListener("error", () => {
      const details: R2FailureDetails = {
        status: 0,
        statusText: "",
        responseText: "",
        host: uploadHost,
      };

      console.error("[room-preview] R2 PUT network error (likely CORS)", {
        host: details.host,
        fileType: file.type,
        fileSize: file.size,
      });

      options?.onR2Failure?.(details);

      reject(
        new RoomPreviewRequestError("network", "تعذر رفع الصورة، تحقق من الاتصال وحاول مرة أخرى"),
      );
    });

    xhr.addEventListener("abort", () => {
      reject(new RoomPreviewRequestError("network", "تم إلغاء رفع الصورة"));
    });

    xhr.addEventListener("timeout", () => {
      reject(
        new RoomPreviewRequestError("timeout", "تعذر رفع الصورة، تحقق من الاتصال وحاول مرة أخرى"),
      );
    });

    xhr.addEventListener("loadend", () => {
      console.debug("[room-preview] R2 PUT loadend", {
        host: uploadHost,
        status: xhr.status,
        statusText: xhr.statusText,
        fileSize: file.size,
      });
    });

    xhr.send(file);
  });
}

export async function confirmDirectUpload(
  sessionId: string,
  options: {
    objectKey: string;
    publicUrl: string;
    source: "camera" | "gallery";
    file: File;
  },
): Promise<SaveRoomPreviewSessionResult> {
  const { objectKey, publicUrl, source, file } = options;

  const data = await requestRoomPreviewJson(
    ROOM_PREVIEW_ROUTES.confirmUploadApi(sessionId),
    {
      method: "POST",
      body: JSON.stringify({
        objectKey,
        publicUrl,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        source,
      }),
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    },
    "Could not confirm the upload.",
    ROOM_PREVIEW_TIMEOUTS.REQUEST_MS,
  );

  try {
    const saveResponse = assertValidResponse<SaveRoomPreviewSessionRoomResponse>(
      data,
      isSaveRoomPreviewSessionRoomResponse,
      "The server returned an invalid confirmation response.",
    );
    return { room: saveResponse.room, session: saveResponse.session };
  } catch {
    throw new RoomPreviewRequestError(
      "invalid_response",
      "The server returned an invalid confirmation response.",
    );
  }
}
