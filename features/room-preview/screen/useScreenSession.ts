"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/provider";
import {
  ROOM_PREVIEW_ROUTES,
  SCREEN_RESULT_RESET_MS,
  SCREEN_FAILED_RESET_MS,
  SCREEN_IDLE_RESET_MS,
  SCREEN_ERROR_RESET_MS,
} from "@/lib/room-preview/constants";
import {
  fetchRoomPreviewSession,
  isRoomPreviewRequestError,
  type RoomPreviewRequestError,
} from "@/lib/room-preview/session-client";
import { createRoomPreviewSessionEventsClient } from "@/lib/room-preview/session-events-client";
import { createRoomPreviewSessionPoller } from "@/lib/room-preview/session-polling";
import { trackClientSessionEvent } from "@/lib/room-preview/session-diagnostics-client";
import { useScreenHeartbeat } from "@/features/room-preview/screen/useScreenHeartbeat";
import type { TranslationDictionary } from "@/lib/i18n/dictionaries";
import type { RoomPreviewSession, RoomPreviewSessionStatus } from "@/lib/room-preview/types";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ScreenSessionViewState = "loading" | "ready" | "not_found" | "expired" | "failed";

export interface UseScreenSessionReturn {
  // i18n
  t: TranslationDictionary;
  locale: "ar" | "en";
  dir: "ltr" | "rtl";
  formatMessage: (template: string, params: Record<string, string>) => string;

  // State
  session: RoomPreviewSession | null;
  viewState: ScreenSessionViewState;
  error: string | null;
  pollError: string | null;
  isUsingPollingFallback: boolean;
  resetCountdown: number | null;
  idleCountdown: number | null;
  errorCountdown: number | null;

  // Derived
  hasSelectedProduct: boolean;
  hasSelectedRoom: boolean;
  hasRenderResult: boolean;

  // Heartbeat
  heartbeatConnected: boolean;
  heartbeatFailedCount: number;
  heartbeatLastSuccessAt: number | null;

  // Actions
  retry: () => void;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function getViewStateFromError(
  error: unknown,
  t: TranslationDictionary,
): { message: string; state: Exclude<ScreenSessionViewState, "loading" | "ready"> } {
  if (isRoomPreviewRequestError(error)) {
    if (error.code === "not_found") {
      return { state: "not_found", message: t.roomPreview.screen.invalidLink };
    }
    if (error.code === "expired") {
      return { state: "expired",   message: t.roomPreview.screen.expiredLink };
    }
    return { state: "failed", message: error.message };
  }
  return { state: "failed", message: t.roomPreview.screen.failedDescription };
}

function shouldStopPolling(error: RoomPreviewRequestError | Error) {
  return isRoomPreviewRequestError(error) && (error.code === "not_found" || error.code === "expired");
}

const FALLBACK_NOTICE_DELAY_MS = 10_000;
const SSE_RECONNECT_POLLING_GRACE_MS = 4_000;
const SOFT_FALLBACK_NOTICE = {
  ar: "جارٍ متابعة التحديثات...",
  en: "Following updates...",
} as const;

function isPollingTerminalStatus(status: RoomPreviewSession["status"] | null | undefined) {
  return status === "completed" || status === "failed" || status === "expired";
}

const STATUS_RANK: Record<RoomPreviewSessionStatus, number> = {
  created: 0,
  waiting_for_mobile: 1,
  mobile_connected: 2,
  room_selected: 3,
  product_selected: 4,
  ready_to_render: 5,
  rendering: 6,
  result_ready: 7,
  completed: 8,
  failed: 8,
  expired: 8,
};

function getSessionUpdatedAtMs(session: RoomPreviewSession) {
  const timestamp = Date.parse(session.updatedAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function shouldIgnoreIncomingSession(
  current: RoomPreviewSession | null,
  incoming: RoomPreviewSession,
) {
  if (!current || current.id !== incoming.id) return false;

  const currentUpdatedAt = getSessionUpdatedAtMs(current);
  const incomingUpdatedAt = getSessionUpdatedAtMs(incoming);

  if (incomingUpdatedAt < currentUpdatedAt) return true;
  if (incomingUpdatedAt > currentUpdatedAt) return false;

  return STATUS_RANK[incoming.status] < STATUS_RANK[current.status];
}

function mergeIncomingSession(
  current: RoomPreviewSession | null,
  incoming: RoomPreviewSession,
) {
  if (!current || current.id !== incoming.id) return incoming;
  if (shouldIgnoreIncomingSession(current, incoming)) return current;

  return {
    ...incoming,
    selectedRoom:
      incoming.selectedRoom ??
      (STATUS_RANK[incoming.status] >= STATUS_RANK.room_selected ? current.selectedRoom : null),
    selectedProduct:
      incoming.selectedProduct ??
      (STATUS_RANK[incoming.status] >= STATUS_RANK.product_selected ? current.selectedProduct : null),
  };
}

function logRealtimeEvent(
  eventType:
    | "sse_connected"
    | "sse_disconnected"
    | "fallback_polling_started"
    | "fallback_polling_stopped"
    | "sse_reconnected",
  metadata?: Record<string, unknown>,
) {
  console.info(`[room-preview] ${eventType}`, metadata ?? {});
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useScreenSession({ sessionId }: { sessionId: string }): UseScreenSessionReturn {
  const { dir, formatMessage, locale, t } = useI18n();
  const router = useRouter();

  const [session,               setSession]              = useState<RoomPreviewSession | null>(null);
  const [viewState,             setViewState]            = useState<ScreenSessionViewState>("loading");
  const [loadAttempt,           setLoadAttempt]          = useState(0);
  const [error,                 setError]                = useState<string | null>(null);
  const [pollError,             setPollError]            = useState<string | null>(null);
  const [isUsingPollingFallback, setIsUsingPollingFallback] = useState(false);
  const [resetCountdown,        setResetCountdown]       = useState<number | null>(null);
  const [idleCountdown,         setIdleCountdown]        = useState<number | null>(null);
  const [errorCountdown,        setErrorCountdown]       = useState<number | null>(null);
  const sessionRef = useRef<RoomPreviewSession | null>(null);
  const fallbackStartedRef = useRef(false);
  const fallbackNoticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectPollingGraceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasLoadedSession   = session !== null;
  const hasSelectedProduct = Boolean(session?.selectedProduct?.id && session?.selectedProduct?.imageUrl);
  const hasSelectedRoom    = Boolean(session?.selectedRoom?.imageUrl);
  const hasRenderResult    = Boolean(
    session?.renderResult?.imageUrl && session?.status === "result_ready",
  );
  const isPollingTerminal = isPollingTerminalStatus(session?.status);
  const sessionStatusRef = useRef<RoomPreviewSession["status"] | null>(null);
  sessionStatusRef.current = session?.status ?? null;

  const clearReconnectPollingGraceTimer = useCallback(() => {
    if (reconnectPollingGraceTimeoutRef.current !== null) {
      clearTimeout(reconnectPollingGraceTimeoutRef.current);
      reconnectPollingGraceTimeoutRef.current = null;
    }
  }, []);

  const clearFallbackNoticeTimer = useCallback(() => {
    if (fallbackNoticeTimeoutRef.current !== null) {
      clearTimeout(fallbackNoticeTimeoutRef.current);
      fallbackNoticeTimeoutRef.current = null;
    }
  }, []);

  const applySessionUpdate = useCallback((nextSession: RoomPreviewSession, transport: string) => {
    const previousSession = sessionRef.current;

    if (shouldIgnoreIncomingSession(previousSession, nextSession)) {
      console.info("[room-preview] screen_session_update_ignored_stale", {
        currentStatus: previousSession?.status ?? null,
        currentUpdatedAt: previousSession?.updatedAt ?? null,
        incomingStatus: nextSession.status,
        incomingUpdatedAt: nextSession.updatedAt,
        sessionId,
        transport,
      });
      return false;
    }

    const mergedSession = mergeIncomingSession(previousSession, nextSession);
    sessionRef.current = mergedSession;
    setSession(mergedSession);

    if (
      mergedSession.selectedRoom?.imageUrl &&
      mergedSession.selectedRoom.imageUrl !== previousSession?.selectedRoom?.imageUrl
    ) {
      console.info("[room-preview] screen_session_updated_after_upload", {
        roomImageUrl: mergedSession.selectedRoom.imageUrl,
        sessionId,
        status: mergedSession.status,
        transport,
      });
      void trackClientSessionEvent(sessionId, {
        source: "screen",
        eventType: "screen_session_updated_after_upload",
        level: "info",
        statusAfter: mergedSession.status,
        metadata: {
          roomImageUrl: mergedSession.selectedRoom.imageUrl,
          transport,
        },
      });
    }

    if (
      mergedSession.selectedProduct?.imageUrl &&
      mergedSession.selectedProduct.imageUrl !== previousSession?.selectedProduct?.imageUrl
    ) {
      console.info("[room-preview] screen_session_updated_after_product_selection", {
        productId: mergedSession.selectedProduct.id,
        productImageUrl: mergedSession.selectedProduct.imageUrl,
        sessionId,
        status: mergedSession.status,
        transport,
      });
    }

    return true;
  }, [sessionId]);

  const fetchAndApplyLatestSession = useCallback(async (transport: string) => {
    const latestSession = await fetchRoomPreviewSession(sessionId);
    applySessionUpdate(latestSession, transport);
    return latestSession;
  }, [applySessionUpdate, sessionId]);

  const {
    isConnected: heartbeatConnected,
    failedCount: heartbeatFailedCount,
    lastSuccessAt: heartbeatLastSuccessAt,
  } = useScreenHeartbeat(sessionId, session?.status);

  useEffect(() => {
    trackClientSessionEvent(sessionId, {
      source: "screen",
      eventType: "screen_loaded",
      level: "info",
    });
  }, [sessionId]);

  // ── result_displayed_screen ───────────────────────────────────────────────
  // Fires once per unique render result (keyed by imageUrl). The ref prevents
  // duplicate events from SSE reconnects, polling fallback, or re-renders.
  const resultDisplayedRef = useRef<string | null>(null);
  useEffect(() => {
    const imageUrl = session?.renderResult?.imageUrl;
    if (!imageUrl || session?.status !== "result_ready") return;
    if (resultDisplayedRef.current === imageUrl) return;
    resultDisplayedRef.current = imageUrl;
    trackClientSessionEvent(sessionId, {
      source: "screen",
      eventType: "result_displayed_screen",
      level: "info",
      metadata: {
        status: session.status,
        hasResultImage: true,
        timestamp: new Date().toISOString(),
      },
    });
  }, [session, sessionId]);

  useEffect(() => {
    trackClientSessionEvent(sessionId, {
      source: "screen",
      eventType: "screen_render_branch_changed",
      level: "info",
      statusAfter: session?.status ?? null,
      metadata: {
        branch: hasRenderResult ? "result" : viewState,
        pollError: pollError !== null,
      },
    });
  }, [hasRenderResult, pollError, session?.status, sessionId, viewState]);

  // ── Initial session load ───────────────────────────────────────────────────
  useEffect(() => {
    let active = true;

    async function loadSession() {
      setViewState("loading");
      setError(null);
      setPollError(null);
      setIsUsingPollingFallback(false);

      try {
        const nextSession = await fetchRoomPreviewSession(sessionId);
        if (!active) return;
        applySessionUpdate(nextSession, "initial_fetch");
        setViewState("ready");
        trackClientSessionEvent(sessionId, {
          source: "screen",
          eventType: "screen_received_session_update",
          level: "info",
          statusAfter: nextSession.status,
          metadata: { transport: "initial_fetch" },
        });
      } catch (loadError) {
        if (!active) return;
        const failure = getViewStateFromError(loadError, t);
        sessionRef.current = null;
        setSession(null);
        setViewState(failure.state);
        setError(failure.message);
      }
    }

    void loadSession();
    return () => { active = false; };
  }, [applySessionUpdate, loadAttempt, sessionId, t]);

  // ── SSE (real-time) ────────────────────────────────────────────────────────
  useEffect(() => {
    if (viewState !== "ready" || !hasLoadedSession || isPollingTerminal) return;

    let active = true;

    const stopEvents = createRoomPreviewSessionEventsClient(sessionId, {
      onOpen: ({ reconnected }) => {
        if (!active) return;
        logRealtimeEvent(reconnected ? "sse_reconnected" : "sse_connected", {
          sessionId,
          status: sessionStatusRef.current,
        });
        trackClientSessionEvent(sessionId, {
          source: "screen",
          eventType: reconnected ? "sse_reconnected" : "sse_connected",
          level: "info",
          statusAfter: sessionStatusRef.current,
        });
        clearFallbackNoticeTimer();
        setPollError(null);

        if (reconnected) {
          clearReconnectPollingGraceTimer();
          void fetchAndApplyLatestSession("sse_reconnect_fetch")
            .then((latestSession) => {
              if (!active) return;
              if (isPollingTerminalStatus(latestSession.status)) {
                setIsUsingPollingFallback(false);
                return;
              }
              reconnectPollingGraceTimeoutRef.current = setTimeout(() => {
                if (!active) return;
                setIsUsingPollingFallback(false);
              }, SSE_RECONNECT_POLLING_GRACE_MS);
            })
            .catch((refreshError) => {
              if (!active) return;
              console.warn("[room-preview] sse_reconnect_fetch_failed", {
                error: refreshError instanceof Error ? refreshError.message : String(refreshError),
                sessionId,
              });
              setIsUsingPollingFallback(true);
            });
        }
      },
      onError: ({ attempt, nextDelayMs }) => {
        if (!active) return;
        clearReconnectPollingGraceTimer();
        logRealtimeEvent("sse_disconnected", {
          attempt,
          nextDelayMs,
          sessionId,
          status: sessionStatusRef.current,
        });
        trackClientSessionEvent(sessionId, {
          source: "screen",
          eventType: "sse_disconnected",
          level: "warning",
          statusBefore: sessionStatusRef.current,
          metadata: { attempt, nextDelayMs },
        });
        setPollError(null);
        setIsUsingPollingFallback(true);
      },
      onSessionUpdate: (nextSession) => {
        if (!active) return;
        if (isPollingTerminalStatus(nextSession.status)) {
          setIsUsingPollingFallback(false);
          fallbackStartedRef.current = false;
          clearFallbackNoticeTimer();
        }
        setPollError(null);
        applySessionUpdate(nextSession, "sse");
        trackClientSessionEvent(sessionId, {
          source: "screen",
          eventType: "screen_received_session_update",
          level: "info",
          statusAfter: nextSession.status,
          metadata: { transport: "sse" },
        });
      },
    });

    return () => {
      active = false;
      clearFallbackNoticeTimer();
      clearReconnectPollingGraceTimer();
      stopEvents();
    };
  }, [
    applySessionUpdate,
    clearFallbackNoticeTimer,
    clearReconnectPollingGraceTimer,
    fetchAndApplyLatestSession,
    hasLoadedSession,
    isPollingTerminal,
    sessionId,
    viewState,
  ]);

  // ── Polling fallback ───────────────────────────────────────────────────────
  useEffect(() => {
    clearFallbackNoticeTimer();

    if (!isUsingPollingFallback) {
      setPollError(null);
      return;
    }

    fallbackNoticeTimeoutRef.current = setTimeout(() => {
      setPollError(SOFT_FALLBACK_NOTICE[locale]);
    }, FALLBACK_NOTICE_DELAY_MS);

    return clearFallbackNoticeTimer;
  }, [clearFallbackNoticeTimer, isUsingPollingFallback, locale]);

  useEffect(() => {
    if (viewState !== "ready" || !hasLoadedSession || !isUsingPollingFallback) return;

    if (!fallbackStartedRef.current) {
      fallbackStartedRef.current = true;
      logRealtimeEvent("fallback_polling_started", {
        sessionId,
        status: sessionStatusRef.current,
      });
      trackClientSessionEvent(sessionId, {
        source: "screen",
        eventType: "fallback_polling_started",
        level: "info",
        statusAfter: sessionStatusRef.current,
      });
    }

    const stopPolling = createRoomPreviewSessionPoller(sessionId, {
      onError: (nextError) => {
        if (shouldStopPolling(nextError)) {
          const failure = getViewStateFromError(nextError, t);
          sessionRef.current = null;
          setSession(null);
          setViewState(failure.state);
          setError(failure.message);
          setPollError(null);
          setIsUsingPollingFallback(false);
          fallbackStartedRef.current = false;
          return false;
        }
        return true;
      },
      onStop: (reason) => {
        logRealtimeEvent("fallback_polling_stopped", { reason, sessionId });
        trackClientSessionEvent(sessionId, {
          source: "screen",
          eventType: "fallback_polling_stopped",
          level: "info",
          metadata: { reason },
        });
        fallbackStartedRef.current = false;
        clearFallbackNoticeTimer();
        setPollError(null);
      },
      onUpdate: (nextSession) => {
        setPollError(null);
        applySessionUpdate(nextSession, "polling");
        if (isPollingTerminalStatus(nextSession.status)) {
          setIsUsingPollingFallback(false);
        }
        trackClientSessionEvent(sessionId, {
          source: "screen",
          eventType: "screen_received_session_update",
          level: "info",
          statusAfter: nextSession.status,
          metadata: { transport: "polling" },
        });
      },
    });

    return stopPolling;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applySessionUpdate, clearFallbackNoticeTimer, hasLoadedSession, isUsingPollingFallback, sessionId, viewState, t.roomPreview.screen.invalidLink, t.roomPreview.screen.expiredLink, t.roomPreview.screen.failedDescription]);

  // ── Auto-reset: terminal session states (result_ready / failed) ───────────
  useEffect(() => {
    const status    = session?.status;
    const isTerminal = status === "result_ready" || status === "failed";

    if (!isTerminal) {
      setResetCountdown(null);
      return;
    }

    const delayMs      = status === "result_ready" ? SCREEN_RESULT_RESET_MS : SCREEN_FAILED_RESET_MS;
    const totalSeconds = Math.round(delayMs / 1000);
    setResetCountdown(totalSeconds);

    const interval = setInterval(() => {
      setResetCountdown((prev) => (prev === null || prev <= 1 ? null : prev - 1));
    }, 1000);

    const redirect = setTimeout(() => {
      router.replace(ROOM_PREVIEW_ROUTES.screenLauncher);
    }, delayMs);

    return () => {
      clearInterval(interval);
      clearTimeout(redirect);
      setResetCountdown(null);
    };
  }, [session?.status, router]);

  // ── Auto-reset: idle (no mobile connected) ────────────────────────────────
  useEffect(() => {
    if (viewState !== "ready" || session?.mobileConnected !== false) {
      setIdleCountdown(null);
      return;
    }

    const totalSeconds = Math.round(SCREEN_IDLE_RESET_MS / 1000);
    setIdleCountdown(totalSeconds);

    const interval = setInterval(() => {
      setIdleCountdown((prev) => (prev === null || prev <= 1 ? null : prev - 1));
    }, 1000);

    const redirect = setTimeout(() => {
      router.replace(ROOM_PREVIEW_ROUTES.screenLauncher);
    }, SCREEN_IDLE_RESET_MS);

    return () => {
      clearInterval(interval);
      clearTimeout(redirect);
      setIdleCountdown(null);
    };
  }, [viewState, session?.mobileConnected, router]);

  // ── Auto-redirect: error view states ──────────────────────────────────────
  useEffect(() => {
    if (viewState !== "not_found" && viewState !== "expired" && viewState !== "failed") {
      setErrorCountdown(null);
      return;
    }

    const totalSeconds = Math.round(SCREEN_ERROR_RESET_MS / 1000);
    setErrorCountdown(totalSeconds);

    const interval = setInterval(() => {
      setErrorCountdown((prev) => (prev === null || prev <= 1 ? null : prev - 1));
    }, 1000);

    const redirect = setTimeout(() => {
      router.replace(ROOM_PREVIEW_ROUTES.screenLauncher);
    }, SCREEN_ERROR_RESET_MS);

    return () => {
      clearInterval(interval);
      clearTimeout(redirect);
      setErrorCountdown(null);
    };
  }, [viewState, router]);

  return {
    t,
    locale,
    dir,
    formatMessage,
    session,
    viewState,
    error,
    pollError,
    isUsingPollingFallback,
    resetCountdown,
    idleCountdown,
    errorCountdown,
    hasSelectedProduct,
    hasSelectedRoom,
    hasRenderResult,
    heartbeatConnected,
    heartbeatFailedCount,
    heartbeatLastSuccessAt,
    retry: () => setLoadAttempt((n) => n + 1),
  };
}
