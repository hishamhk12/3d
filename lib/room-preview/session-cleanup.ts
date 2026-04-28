import "server-only";

import { openSessionIssue, trackSessionEvent } from "@/lib/room-preview/session-diagnostics";
import { prisma } from "@/lib/server/prisma";

/**
 * Marks all non-terminal sessions past their expiresAt as `expired`.
 * Also catches legacy sessions with null expiresAt (created before the expiry
 * field was added) — they are permanent orphans and should be closed out.
 */
export async function expireOldSessions(): Promise<number> {
  const sessions = await prisma.roomPreviewSession.findMany({
    where: {
      status: { notIn: ["failed", "expired", "completed"] },
      OR: [
        { expiresAt: null },
        { expiresAt: { lte: new Date() } },
      ],
    },
    select: { id: true, status: true },
  });
  const result = await prisma.roomPreviewSession.updateMany({
    where: {
      status: { notIn: ["failed", "expired", "completed"] },
      OR: [
        { expiresAt: null },
        { expiresAt: { lte: new Date() } },
      ],
    },
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
  const result = await prisma.roomPreviewSession.updateMany({
    where: {
      status: "result_ready",
      updatedAt: { lte: cutoff },
    },
    data: { status: "completed" },
  });
  return result.count;
}
