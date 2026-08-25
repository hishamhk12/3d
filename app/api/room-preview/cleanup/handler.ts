import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getLogger } from "@/lib/logger";
import {
  expireOldSessions,
  expireIdleWaitingSessions,
  failStuckRenderingSessions,
  completeResultReadySessions,
  detectMobileStale,
} from "@/lib/room-preview/session-cleanup";
import { detectStuckSessions } from "@/lib/room-preview/stuck-detection";

const log = getLogger("cleanup-api");

/**
 * Constant-time string comparison. Returns false immediately if either
 * argument is empty, to avoid timing leaks on zero-length inputs.
 */
function safeEquals(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Accepts two auth paths:
 *   1. x-cleanup-secret header matching CLEANUP_SECRET   (manual / cURL calls)
 *   2. Authorization: Bearer <token> matching CRON_SECRET (Vercel Cron)
 *
 * If neither env var is set the endpoint is open (local dev).
 * In production set both CLEANUP_SECRET and CRON_SECRET in Vercel env vars.
 */
function isRequestAuthorized(request: NextRequest): boolean {
  const cleanupSecret = process.env.CLEANUP_SECRET;
  const cronSecret = process.env.CRON_SECRET;

  if (!cleanupSecret && !cronSecret) return true; // dev: no secrets configured

  const xSecret = request.headers.get("x-cleanup-secret") ?? "";
  const authHeader = request.headers.get("authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (cleanupSecret && safeEquals(xSecret, cleanupSecret)) return true;
  if (cronSecret && safeEquals(bearerToken, cronSecret)) return true;

  return false;
}

/**
 * GET /api/room-preview/cleanup
 *
 * Four operations per run (in dependency order):
 *   1. Fail sessions stuck in rendering/ready_to_render > 7 min.
 *   2. Complete result_ready sessions after the display window (90 s).
 *   3. Expire waiting_for_mobile sessions idle > 1 min.
 *   4. Expire any remaining live sessions past their expiresAt.
 *
 * Auth (at least one required in production):
 *   - x-cleanup-secret: <CLEANUP_SECRET>   (manual calls)
 *   - Authorization: Bearer <CRON_SECRET>  (Vercel Cron — set automatically)
 */
export async function GET(request: NextRequest) {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const detectedIssues = await detectStuckSessions();
    const [stuckFailed, completed, idleExpired, expired, mobileStale] = await Promise.all([
      failStuckRenderingSessions(),
      completeResultReadySessions(),
      expireIdleWaitingSessions(),
      expireOldSessions(),
      detectMobileStale(),
    ]);

    log.info({ stuckFailed, completed, idleExpired, expired, mobileStale, detectedIssues }, "Session cleanup complete");

    return NextResponse.json({
      ok: true,
      expired,
      idleExpired,
      stuckFailed,
      completed,
      mobileStale,
      detectedIssues,
      ranAt: new Date().toISOString(),
    });
  } catch (err) {
    log.error({ err }, "Failed to run session cleanup");
    return NextResponse.json(
      { error: "Cleanup failed" },
      { status: 500 },
    );
  }
}
