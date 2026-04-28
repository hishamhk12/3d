"use client";

import { useEffect, useState } from "react";
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
import type { TranslationDictionary } from "@/lib/i18n/dictionaries";
import type { RoomPreviewSession } from "@/lib/room-preview/types";

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

  const hasLoadedSession   = session !== null;
  const hasSelectedProduct = Boolean(session?.selectedProduct?.id && session?.selectedProduct?.imageUrl);
  const hasSelectedRoom    = Boolean(session?.selectedRoom?.imageUrl);
  const hasRenderResult    = Boolean(
    session?.renderResult?.imageUrl && session?.status === "result_ready",
  );

  useEffect(() => {
    trackClientSessionEvent(sessionId, {
      source: "screen",
      eventType: "screen_loaded",
      level: "info",
    });
  }, [sessionId]);

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
        setSession(nextSession);
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
        setSession(null);
        setViewState(failure.state);
        setError(failure.message);
      }
    }

    void loadSession();
    return () => { active = false; };
  }, [loadAttempt, sessionId, t]);

  // ── SSE (real-time) ────────────────────────────────────────────────────────
  useEffect(() => {
    if (viewState !== "ready" || !hasLoadedSession || isUsingPollingFallback) return;

    let active = true;

    const stopEvents = createRoomPreviewSessionEventsClient(sessionId, {
      onOpen: () => {
        if (!active) return;
        setPollError(null);
      },
      onError: () => {
        if (!active) return;
        setPollError(t.roomPreview.screen.realtimeInterrupted);
        setIsUsingPollingFallback(true);
        trackClientSessionEvent(sessionId, {
          source: "screen",
          eventType: "screen_stale_detected",
          level: "warning",
          code: "SCREEN_NOT_UPDATING",
          message: "Realtime updates interrupted; falling back to polling.",
        });
      },
      onSessionUpdate: (nextSession) => {
        if (!active) return;
        setPollError(null);
        setSession(nextSession);
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
      stopEvents();
    };
  }, [hasLoadedSession, isUsingPollingFallback, sessionId, t.roomPreview.screen.realtimeInterrupted, viewState]);

  // ── Polling fallback ───────────────────────────────────────────────────────
  useEffect(() => {
    if (viewState !== "ready" || !hasLoadedSession || !isUsingPollingFallback) return;

    trackClientSessionEvent(sessionId, {
      source: "screen",
      eventType: "screen_polling_started",
      level: "info",
    });

    const stopPolling = createRoomPreviewSessionPoller(sessionId, {
      intervalMs: 2000,
      onError: (nextError) => {
        if (shouldStopPolling(nextError)) {
          const failure = getViewStateFromError(nextError, t);
          setSession(null);
          setViewState(failure.state);
          setError(failure.message);
          setPollError(null);
          return false;
        }
        setPollError(nextError.message);
        return true;
      },
      onUpdate: (nextSession) => {
        setPollError(null);
        setSession(nextSession);
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
  }, [hasLoadedSession, isUsingPollingFallback, sessionId, viewState, t.roomPreview.screen.invalidLink, t.roomPreview.screen.expiredLink, t.roomPreview.screen.failedDescription]);

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
    retry: () => setLoadAttempt((n) => n + 1),
  };
}
