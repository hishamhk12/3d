"use client";

import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import {
  getRoomPreviewErrorLogDetails,
  isRoomPreviewRequestError,
} from "@/lib/room-preview/session-client";
import {
  saveRoomPreviewSessionRoom,
  requestDirectUploadUrl,
  uploadFileToR2,
  confirmDirectUpload,
} from "@/lib/room-preview/room-service";
import { compressRoomImage } from "@/lib/room-preview/image-compress";
import { trackClientSessionEvent } from "@/lib/room-preview/session-diagnostics-client";
import {
  getCustomerRecoveryMessage,
  type CustomerRecoveryMessage,
} from "@/lib/room-preview/customer-recovery";
import type { TranslationDictionary } from "@/lib/i18n/dictionaries";
import type {
  RoomPreviewRoomSource,
  RoomPreviewSession,
} from "@/lib/room-preview/types";
import type { LogLevel } from "@/features/room-preview/mobile/debug";
import {
  createActionErrorMessage,
  getViewStateFromError,
  type MobileSessionViewState,
  type SaveStatus,
} from "@/features/room-preview/mobile/mobile-session-utils";
import {
  getErrorMessage,
  getRequestErrorCode,
} from "@/features/room-preview/mobile/mobile-session-error-utils";

/**
 * Owns the `isSavingRoom` state and the `handleFileSelection` action used by
 * the mobile session flow. The handler body is moved verbatim from
 * `useMobileSession.ts` — identical compress + signed-URL + R2 PUT + confirm
 * + FormData-fallback pipeline, identical diagnostics events, identical
 * Arabic strings, identical 413 / 403 / generic error branching.
 *
 * Parent state writers are passed in so the upload flow can drive the
 * session view exactly as before without owning that state. `roomSaveStatus`
 * and `roomSaveStatusLabel` deliberately stay in the parent because they are
 * also written by the connect flow and the initial-load effect.
 */
export interface UseRoomUploadParams {
  session: RoomPreviewSession | null;
  setSession: Dispatch<SetStateAction<RoomPreviewSession | null>>;
  setViewState: Dispatch<SetStateAction<MobileSessionViewState>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setSuccessMessage: Dispatch<SetStateAction<string | null>>;
  setRecoveryMessage: Dispatch<SetStateAction<CustomerRecoveryMessage | null>>;
  setRoomSaveStatus: Dispatch<SetStateAction<SaveStatus>>;
  setProductSaveStatus: Dispatch<SetStateAction<SaveStatus>>;
  setRoomSaveStatusLabel: Dispatch<SetStateAction<string | null>>;
  sessionId: string;
  t: TranslationDictionary;
  debugLog: (level: LogLevel, message: string, detail?: string) => void;
}

export interface UseRoomUploadReturn {
  isSavingRoom: boolean;
  handleFileSelection: (
    source: Extract<RoomPreviewRoomSource, "camera" | "gallery">,
    file: File | null,
  ) => Promise<void>;
}

export function useRoomUpload(params: UseRoomUploadParams): UseRoomUploadReturn {
  const {
    session,
    setSession,
    setViewState,
    setError,
    setSuccessMessage,
    setRecoveryMessage,
    setRoomSaveStatus,
    setProductSaveStatus,
    setRoomSaveStatusLabel,
    sessionId,
    t,
    debugLog,
  } = params;

  const [isSavingRoom, setIsSavingRoom] = useState(false);

  const handleFileSelection = useCallback(async (
    source: Extract<RoomPreviewRoomSource, "camera" | "gallery">,
    file: File | null,
  ) => {
    if (!file || isSavingRoom || !session) {
      if (!file) {
        console.warn("[room-preview] Missing uploaded file", { sessionId, source });
        debugLog("warn", `handleFileSelection: no file selected (source: ${source})`);
        setRoomSaveStatus("error");
      }
      return;
    }

    trackClientSessionEvent(sessionId, {
      source: "mobile",
      eventType: "mobile_tap_detected",
      level: "info",
      metadata: { target: "room_upload", source, fileSize: file.size, fileType: file.type },
    });
    trackClientSessionEvent(sessionId, {
      source: "mobile",
      eventType: "room_upload_started",
      level: "info",
      metadata: { source, fileName: file.name, fileSize: file.size, fileType: file.type },
    });
    setIsSavingRoom(true);
    setError(null);
    setSuccessMessage(null);
    setRecoveryMessage(null);
    setRoomSaveStatus("idle");
    setProductSaveStatus("idle");
    setRoomSaveStatusLabel("جاري رفع صورة الغرفة...");

    const fileToUpload = await compressRoomImage(file);

    debugLog(
      "network",
      `uploading room  source: ${source}`,
      `file: ${file.name} (${file.size}b)  ${fileToUpload !== file ? `compressed → ${fileToUpload.name} (${fileToUpload.size}b, ${Math.round((1 - fileToUpload.size / file.size) * 100)}% smaller)` : "skipped compression (file already small)"}`,
    );

    try {
      // ── Step 1: request a signed upload URL from the server ───────────────
      let uploadUrlResponse;
      let usedDirectUpload = false;

      try {
        uploadUrlResponse = await requestDirectUploadUrl(sessionId, { source, file: fileToUpload });
        usedDirectUpload = true;
        trackClientSessionEvent(sessionId, {
          source: "mobile",
          eventType: "room_direct_upload_started",
          level: "info",
          metadata: { source, fileSize: fileToUpload.size, fileType: fileToUpload.type },
        });
        debugLog("network", `Got signed upload URL — PUT ${uploadUrlResponse.objectKey}`);
      } catch (urlError) {
        const isNotSupported =
          isRoomPreviewRequestError(urlError) &&
          urlError.status === 501;

        if (isNotSupported) {
          // Local / non-R2 dev environment — fall back to FormData upload
          debugLog("info", "Direct upload not supported, falling back to FormData upload");
        } else {
          throw urlError;
        }
      }

      let response;

      if (usedDirectUpload && uploadUrlResponse) {
        // ── Step 2: PUT file directly to R2 ────────────────────────────────
        await uploadFileToR2(
          uploadUrlResponse.uploadUrl,
          fileToUpload,
          {
            onProgress: (percent) => {
              setRoomSaveStatusLabel(`جاري رفع صورة الغرفة... ${percent}%`);
            },
            onR2Failure: ({ status, statusText, responseText, host }) => {
              trackClientSessionEvent(sessionId, {
                source: "mobile",
                eventType: "room_direct_upload_r2_failed",
                level: "error",
                code: status === 403 ? "R2_SIGNATURE_INVALID" : status === 0 ? "R2_CORS_OR_NETWORK" : "R2_PUT_FAILED",
                metadata: {
                  status,
                  statusText,
                  responseText: responseText.slice(0, 500),
                  host,
                  source,
                  fileType: fileToUpload.type,
                  fileSize: fileToUpload.size,
                },
              });
            },
          },
        );

        debugLog("success", `File uploaded to R2 (${fileToUpload.size}b)`);
        setRoomSaveStatusLabel("جاري رفع صورة الغرفة...");

        // ── Step 3: confirm the upload on the server ────────────────────────
        response = await confirmDirectUpload(sessionId, {
          objectKey: uploadUrlResponse.objectKey,
          publicUrl: uploadUrlResponse.publicUrl,
          source,
          file: fileToUpload,
        });

        trackClientSessionEvent(sessionId, {
          source: "mobile",
          eventType: "room_direct_upload_confirmed",
          level: "info",
          metadata: { source, objectKey: uploadUrlResponse.objectKey },
        });
      } else {
        // ── Fallback: old FormData upload (development / non-R2) ────────────
        response = await saveRoomPreviewSessionRoom(
          sessionId,
          { source, file: fileToUpload, previousRoomImageUrl: session.selectedRoom?.imageUrl },
        );
      }

      setSession(response.session);
      setRoomSaveStatus("success");
      setRoomSaveStatusLabel(null);
      trackClientSessionEvent(sessionId, {
        source: "mobile",
        eventType: "room_upload_completed",
        level: "info",
        statusAfter: response.session.status,
        metadata: { source, directUpload: usedDirectUpload },
      });
      debugLog("success", `Room saved  source: ${response.session.selectedRoom?.source ?? "?"}`);
    } catch (saveError) {
      const failure = getViewStateFromError(saveError, t);
      debugLog("error", `Room upload failed: ${getErrorMessage(saveError)}`, `file: ${file.name}`);

      if (failure.state === "expired" || failure.state === "not_found") {
        setSession(null);
        setViewState(failure.state);
        setError(failure.message);
        debugLog("state", `viewState → ${failure.state}`);
      } else {
        console.error(
          "[room-preview] Failed to save uploaded room",
          JSON.stringify({ error: JSON.parse(getRoomPreviewErrorLogDetails(saveError)), fileName: file.name, fileSize: file.size, fileType: file.type, sessionId, source }),
        );
        const recovery = isRoomPreviewRequestError(saveError) && saveError.status === 413
          ? getCustomerRecoveryMessage("image_too_large")
          : getCustomerRecoveryMessage("retry_upload");
        setRecoveryMessage(recovery);
        setError(
          recovery?.text ??
          (isRoomPreviewRequestError(saveError) && saveError.status === 403
            ? "انتهت صلاحية رابط الرفع، حاول مرة أخرى"
            : createActionErrorMessage(saveError, "تعذر رفع الصورة، تحقق من الاتصال وحاول مرة أخرى")),
        );
        setRoomSaveStatus("error");
        setRoomSaveStatusLabel(null);
      }
      trackClientSessionEvent(sessionId, {
        source: "mobile",
        eventType: "room_upload_failed",
        level: "error",
        code: getRequestErrorCode(saveError),
        message: getErrorMessage(saveError),
        metadata: { source, fileName: file.name, fileSize: file.size, fileType: file.type },
      });
    } finally {
      setIsSavingRoom(false);
    }
  }, [
    isSavingRoom,
    session,
    sessionId,
    t,
    debugLog,
    setSession,
    setViewState,
    setError,
    setSuccessMessage,
    setRecoveryMessage,
    setRoomSaveStatus,
    setProductSaveStatus,
    setRoomSaveStatusLabel,
  ]);

  return { isSavingRoom, handleFileSelection };
}
