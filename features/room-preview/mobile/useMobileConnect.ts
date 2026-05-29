"use client";

import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { connectRoomPreviewSession } from "@/lib/room-preview/session-client";
import { trackClientSessionEvent } from "@/lib/room-preview/session-diagnostics-client";
import type { TranslationDictionary } from "@/lib/i18n/dictionaries";
import type { RoomPreviewSession } from "@/lib/room-preview/types";
import type { LogLevel } from "@/features/room-preview/mobile/debug";
import {
  createActionErrorMessage,
  getViewStateFromError,
  isSessionConnected,
  type MobileSessionViewState,
  type SaveStatus,
} from "@/features/room-preview/mobile/mobile-session-utils";
import {
  getErrorMessage,
  getRequestErrorCode,
} from "@/features/room-preview/mobile/mobile-session-error-utils";

/**
 * Owns the `isConnecting` state and the `handleConnect` action used by the
 * mobile session flow. The body of `handleConnect` is moved verbatim from
 * `useMobileSession.ts` — identical diagnostics events, identical Arabic
 * strings, identical state-update sequence.
 *
 * Parent state writers are passed in as setters so the connect flow can drive
 * the session view exactly as before without owning any of that state.
 */
export interface UseMobileConnectParams {
  session: RoomPreviewSession | null;
  setSession: Dispatch<SetStateAction<RoomPreviewSession | null>>;
  setViewState: Dispatch<SetStateAction<MobileSessionViewState>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setSuccessMessage: Dispatch<SetStateAction<string | null>>;
  setRoomSaveStatus: Dispatch<SetStateAction<SaveStatus>>;
  setProductSaveStatus: Dispatch<SetStateAction<SaveStatus>>;
  setRoomSaveStatusLabel: Dispatch<SetStateAction<string | null>>;
  sessionId: string;
  t: TranslationDictionary;
  debugLog: (level: LogLevel, message: string, detail?: string) => void;
}

export interface UseMobileConnectReturn {
  isConnecting: boolean;
  handleConnect: () => Promise<void>;
}

export function useMobileConnect(
  params: UseMobileConnectParams,
): UseMobileConnectReturn {
  const {
    session,
    setSession,
    setViewState,
    setError,
    setSuccessMessage,
    setRoomSaveStatus,
    setProductSaveStatus,
    setRoomSaveStatusLabel,
    sessionId,
    t,
    debugLog,
  } = params;

  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnect = useCallback(async () => {
    if (isConnecting || !session || isSessionConnected(session)) return;

    trackClientSessionEvent(sessionId, {
      source: "mobile",
      eventType: "mobile_tap_detected",
      level: "info",
      metadata: { target: "connect" },
    });
    setIsConnecting(true);
    setError(null);
    setSuccessMessage(null);
    setRoomSaveStatus("idle");
    setProductSaveStatus("idle");
    setRoomSaveStatusLabel(null);

    debugLog("network", `POST /connect  sessionId: ${sessionId}`);
    console.info("[room-preview] mobile_connect_started", {
      mode: "manual",
      sessionId,
      statusBefore: session.status,
    });
    trackClientSessionEvent(sessionId, {
      source: "mobile",
      eventType: "mobile_connect_started",
      level: "info",
      statusBefore: session.status,
      metadata: { mode: "manual" },
    });

    try {
      const connectedSession = await connectRoomPreviewSession(sessionId);
      console.info("[room-preview] mobile_connect_success", {
        mode: "manual",
        sessionId,
        statusAfter: connectedSession.status,
      });
      trackClientSessionEvent(sessionId, {
        source: "mobile",
        eventType: "mobile_connect_success",
        level: "info",
        statusAfter: connectedSession.status,
        metadata: { mode: "manual" },
      });
      setSession({
        ...session,
        mobileConnected: true,
        status:
          session.selectedProduct?.id && session.selectedProduct?.imageUrl
            ? "product_selected"
            : session.selectedRoom?.imageUrl
              ? "room_selected"
              : "mobile_connected",
      });
      setSuccessMessage(t.roomPreview.mobile.connectedSuccess);
      debugLog("success", "Session connected");
    } catch (connectError) {
      const failure = getViewStateFromError(connectError, t);
      console.error("[room-preview] mobile_connect_failed", {
        error: getErrorMessage(connectError),
        mode: "manual",
        sessionId,
      });
      trackClientSessionEvent(sessionId, {
        source: "mobile",
        eventType: "mobile_connect_failed",
        level: "error",
        code: getRequestErrorCode(connectError),
        message: getErrorMessage(connectError),
        statusBefore: session.status,
        metadata: { mode: "manual" },
      });
      debugLog("error", `Connect failed: ${getErrorMessage(connectError)}`);

      if (failure.state === "expired" || failure.state === "not_found") {
        setSession(null);
        setViewState(failure.state);
        setError(failure.message);
        debugLog("state", `viewState → ${failure.state}`);
      } else {
        setError(createActionErrorMessage(connectError, t.roomPreview.mobile.connectFailed));
      }
    } finally {
      setIsConnecting(false);
    }
  }, [
    isConnecting,
    session,
    sessionId,
    t,
    debugLog,
    setSession,
    setViewState,
    setError,
    setSuccessMessage,
    setRoomSaveStatus,
    setProductSaveStatus,
    setRoomSaveStatusLabel,
  ]);

  return { isConnecting, handleConnect };
}
