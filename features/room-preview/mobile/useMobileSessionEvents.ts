"use client";

import { useEffect, useRef } from "react";
import { trackClientSessionEvent } from "@/lib/room-preview/session-diagnostics-client";
import type { RoomPreviewSession } from "@/lib/room-preview/types";
import type { LogLevel } from "@/features/room-preview/mobile/debug";

/**
 * Passive telemetry observers for the mobile session flow.
 *
 * Each of the four effects below is moved verbatim from `useMobileSession.ts`:
 *
 *   - Heartbeat disconnect tracker — emits `weak_connection_warning_shown` on
 *     the true → false edge.
 *   - `result_seen_mobile` tracker — fires once per unique render imageUrl.
 *   - Status sync — mirrors `session?.status` into the diagnostics module via
 *     `updateStatus`, plus the `mobile_session_status_changed` console log.
 *   - Mount / unmount debug logging — `MobileSessionClient mounted` /
 *     `MobileSessionClient unmounting`.
 *
 * The two internal refs (`prevHeartbeatConnectedRef`, `resultSeenRef`) are
 * fully owned by the effects that read/write them and travel with this hook.
 *
 * No UI state is touched. No API calls are made. No Arabic strings appear.
 */
export interface UseMobileSessionEventsParams {
  session: RoomPreviewSession | null;
  sessionId: string;
  showResult: boolean;
  heartbeatConnected: boolean;
  heartbeatFailedCount: number;
  /** Stable callback from useMobileDiagnostics that updates a status ref. */
  updateStatus: (status: string | null) => void;
  /** Debug log function from useDebugLog. */
  debugLog: (level: LogLevel, message: string, detail?: string) => void;
}

export function useMobileSessionEvents(params: UseMobileSessionEventsParams): void {
  const {
    session,
    sessionId,
    showResult,
    heartbeatConnected,
    heartbeatFailedCount,
    updateStatus,
    debugLog,
  } = params;

  // Track the first moment the heartbeat becomes unreachable (true → false).
  // Fire-once per disconnection event so we never spam the timeline.
  const prevHeartbeatConnectedRef = useRef(true);
  useEffect(() => {
    const wasConnected = prevHeartbeatConnectedRef.current;
    prevHeartbeatConnectedRef.current = heartbeatConnected;
    if (!heartbeatConnected && wasConnected) {
      trackClientSessionEvent(sessionId, {
        source: "mobile",
        eventType: "weak_connection_warning_shown",
        level: "warning",
        metadata: { failedCount: heartbeatFailedCount },
      });
    }
  }, [heartbeatConnected, heartbeatFailedCount, sessionId]);

  // ── result_seen_mobile ────────────────────────────────────────────────────
  // Fires once per unique render result when the result UI first becomes
  // visible. The ref (keyed by imageUrl) prevents duplicate events from
  // polling re-renders, back-navigation recovery, or repeated setShowResult
  // calls with the same result.
  const resultSeenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!showResult || !session) return;
    const imageUrl = session.renderResult?.imageUrl;
    if (!imageUrl) return;
    if (resultSeenRef.current === imageUrl) return;
    resultSeenRef.current = imageUrl;
    trackClientSessionEvent(session.id, {
      source: "mobile",
      eventType: "result_seen_mobile",
      level: "info",
      metadata: {
        status: session.status,
        hasResultImage: true,
        timestamp: new Date().toISOString(),
      },
    });
  }, [showResult, session]);

  // Keep the diagnostics status ref current for all async event listeners
  useEffect(() => {
    updateStatus(session?.status ?? null);
    if (session?.status) {
      console.info("[room-preview] mobile_session_status_changed", {
        mobileConnected: session.mobileConnected,
        sessionId,
        status: session.status,
      });
    }
  }, [session?.mobileConnected, session?.status, sessionId, updateStatus]);

  // ── Lifecycle logging ────────────────────────────────────────────────────────
  useEffect(() => {
    debugLog("info", "MobileSessionClient mounted", `sessionId: ${sessionId}`);
    // mount_page_mounted is already sent by useMobileDiagnostics — no duplicate needed.
    return () => {
      debugLog("warn", "MobileSessionClient unmounting");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
