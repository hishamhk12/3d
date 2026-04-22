import "server-only";

import { prisma } from "@/lib/server/prisma";

/**
 * Marks all non-terminal sessions past their expiresAt as `expired`.
 * Also catches legacy sessions with null expiresAt (created before the expiry
 * field was added) — they are permanent orphans and should be closed out.
 */
export async function expireOldSessions(): Promise<number> {
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
  const result = await prisma.roomPreviewSession.updateMany({
    where: {
      status: "waiting_for_mobile",
      updatedAt: { lte: cutoff },
    },
    data: { status: "expired" },
  });
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
  const result = await prisma.roomPreviewSession.updateMany({
    where: {
      status: { in: ["rendering", "ready_to_render"] },
      updatedAt: { lte: cutoff },
    },
    data: { status: "failed" },
  });
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
