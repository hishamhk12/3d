import "server-only";

import { openSessionIssue, trackSessionEvent } from "@/lib/room-preview/session-diagnostics";
import { getSessionById } from "@/lib/room-preview/session-repository";
import { publishRoomPreviewSessionEvent } from "@/lib/room-preview/session-events";
import { prisma } from "@/lib/server/prisma";

/**
 * Fetches the updated session and pushes a real-time SSE event to connected
 * screen and mobile clients. Called after every cleanup status change so
 * clients don't have to wait for the next poll or SSE reconnect.
 */
async function publishCleanupEvent(sessionId: string): Promise<void> {
  const updated = await getSessionById(sessionId);
  if (updated) {
    publishRoomPreviewSessionEvent(updated.id, { type: "session_updated", session: updated });
  }
}

/**
 * Emits `mobile_stale_detected` for live sessions whose mobile client has
 * stopped heartbeating for longer than `staleThresholdMs`.
 *
 * Spam prevention via transition-window detection: only sessions whose
 * `lastMobileSeenAt` falls inside the half-open window
 *   (now − staleThresholdMs − cleanupIntervalMs,  now − staleThresholdMs]
 * are matched. This window advances with each cron tick, so a session is
 * matched in exactly one cleanup run per stale episode — no dedup query
 * needed and no schema changes required.
 *
 * Does NOT expire or modify sessions — observation only.
 */
export async function detectMobileStale(
  staleThresholdMs = 75_000,
  cleanupIntervalMs = 2 * 60_000,
): Promise<number> {
  const now = Date.now();
  const windowEnd   = new Date(now - staleThresholdMs);
  const windowStart = new Date(now - staleThresholdMs - cleanupIntervalMs);

  const sessions = await prisma.roomPreviewSession.findMany({
    where: {
      status: { notIn: ["expired", "completed", "failed"] },
      // NULL lastMobileSeenAt never satisfies gte, so null sessions are
      // implicitly excluded — no explicit null check needed.
      lastMobileSeenAt: { gte: windowStart, lte: windowEnd },
    },
    select: { id: true, status: true, lastMobileSeenAt: true },
  });

  if (sessions.length === 0) return 0;

  await Promise.all(
    sessions.map((session) =>
      trackSessionEvent({
        sessionId: session.id,
        source: "server",
        eventType: "mobile_stale_detected",
        level: "warning",
        metadata: {
          lastMobileSeenAt: session.lastMobileSeenAt!.toISOString(),
          gapMs: now - session.lastMobileSeenAt!.getTime(),
          staleThresholdMs,
        },
      }),
    ),
  );

  return sessions.length;
}

/**
 * Marks all non-terminal sessions past their expiresAt as `expired`.
 * Also catches legacy sessions with null expiresAt (created before the expiry
 * field was added) — they are permanent orphans and should be closed out.
 *
 * `result_ready` is excluded: those sessions have a successful render that
 * completeResultReadySessions() will advance to `completed`. Expiring them
 * here would race with that function and could lose the completed signal.
 */
export async function expireOldSessions(): Promise<number> {
  // "rendering", "ready_to_render", and "result_ready" are excluded so an
  // active render is not expired mid-flight. failStuckRenderingSessions()
  // handles orphaned renders; completeResultReadySessions() handles result_ready.
  const where = {
    status: { notIn: ["failed", "expired", "completed", "rendering", "ready_to_render", "result_ready"] as string[] },
    OR: [
      { expiresAt: null },
      { expiresAt: { lte: new Date() } },
    ],
  };

  const sessions = await prisma.roomPreviewSession.findMany({
    where,
    select: { id: true, status: true },
  });
  const result = await prisma.roomPreviewSession.updateMany({
    where,
    data: { status: "expired" },
  });
  await Promise.all(sessions.map((session) =>
    trackSessionEvent({
      sessionId: session.id,
      source: "server",
      eventType: "session_expired",
      level: "warning",
      statusBefore: session.status,
      statusAfter: "expired",
      metadata: { reason: "expires_at" },
    }),
  ));
  await Promise.all(sessions.map((session) => publishCleanupEvent(session.id)));
  return result.count;
}

/**
 * Expires `waiting_for_mobile` sessions that have been idle for longer than
 * idleAfterMs. These are orphaned sessions — the QR was shown but nobody
 * scanned, and the screen has since created a new session.
 *
 * Default: 1 minute (showroom sessions are short-lived; any session still
 * waiting after 1 min is almost certainly abandoned).
 */
export async function expireIdleWaitingSessions(
  idleAfterMs = 1 * 60 * 1000,
): Promise<number> {
  const cutoff = new Date(Date.now() - idleAfterMs);
  const sessions = await prisma.roomPreviewSession.findMany({
    where: {
      status: "waiting_for_mobile",
      updatedAt: { lte: cutoff },
    },
    select: { id: true, status: true, updatedAt: true },
  });
  const result = await prisma.roomPreviewSession.updateMany({
    where: {
      status: "waiting_for_mobile",
      updatedAt: { lte: cutoff },
    },
    data: { status: "expired" },
  });
  await Promise.all(sessions.map(async (session) => {
    await openSessionIssue({
      sessionId: session.id,
      type: "SESSION_STUCK",
      metadata: { status: session.status, idleAfterMs, updatedAt: session.updatedAt.toISOString() },
    });
    await trackSessionEvent({
      sessionId: session.id,
      source: "server",
      eventType: "session_expired",
      level: "warning",
      statusBefore: session.status,
      statusAfter: "expired",
      metadata: { reason: "idle_waiting_for_mobile", idleAfterMs },
    });
  }));
  await Promise.all(sessions.map((session) => publishCleanupEvent(session.id)));
  return result.count;
}

/**
 * Marks sessions stuck in `rendering` or `ready_to_render` as `failed`.
 * Covers Vercel function timeouts and crashes mid-render.
 *
 * Default threshold: 7 minutes (Vercel max function duration is 5 min;
 * 7 min gives a generous buffer before we declare the render dead).
 */
export async function failStuckRenderingSessions(
  stuckAfterMs = 7 * 60 * 1000,
): Promise<number> {
  const cutoff = new Date(Date.now() - stuckAfterMs);
  const sessions = await prisma.roomPreviewSession.findMany({
    where: {
      status: { in: ["rendering", "ready_to_render"] },
      updatedAt: { lte: cutoff },
    },
    select: { id: true, status: true, updatedAt: true },
  });
  const result = await prisma.roomPreviewSession.updateMany({
    where: {
      status: { in: ["rendering", "ready_to_render"] },
      updatedAt: { lte: cutoff },
    },
    data: { status: "failed" },
  });
  await Promise.all(sessions.map(async (session) => {
    await openSessionIssue({
      sessionId: session.id,
      type: "RENDER_TIMEOUT",
      metadata: { status: session.status, stuckAfterMs, updatedAt: session.updatedAt.toISOString() },
    });
    await trackSessionEvent({
      sessionId: session.id,
      source: "server",
      eventType: "render_timeout",
      level: "error",
      statusBefore: session.status,
      statusAfter: "failed",
      code: "RENDER_TIMEOUT",
      metadata: { stuckAfterMs },
    });
  }));
  await Promise.all(sessions.map((session) => publishCleanupEvent(session.id)));
  return result.count;
}

/**
 * Advances `result_ready` sessions to `completed` after the display window.
 *
 * The showroom screen displays the render for SCREEN_RESULT_RESET_MS (60 s)
 * then resets. Once the screen has moved on, `completed` signals "this session
 * successfully reached the customer" — a clean terminal-success state
 * distinguishable from sessions that never rendered.
 *
 * Default: 90 s = 60 s display window + 30 s buffer for animation / clock skew.
 */
export async function completeResultReadySessions(
  displayAfterMs = 90 * 1000,
): Promise<number> {
  const cutoff = new Date(Date.now() - displayAfterMs);
  const sessions = await prisma.roomPreviewSession.findMany({
    where: {
      status: "result_ready",
      updatedAt: { lte: cutoff },
    },
    select: { id: true },
  });
  if (sessions.length === 0) return 0;
  const result = await prisma.roomPreviewSession.updateMany({
    where: {
      id: { in: sessions.map((s) => s.id) },
      status: "result_ready",
    },
    data: { status: "completed" },
  });
  await Promise.all(
    sessions.map((session) =>
      trackSessionEvent({
        sessionId: session.id,
        source: "server",
        eventType: "session_completed",
        level: "info",
        statusBefore: "result_ready",
        statusAfter: "completed",
        metadata: {
          previousStatus: "result_ready",
          nextStatus: "completed",
          reason: "result_display_window_elapsed",
        },
      }),
    ),
  );
  await Promise.all(sessions.map((session) => publishCleanupEvent(session.id)));
  return result.count;
}
