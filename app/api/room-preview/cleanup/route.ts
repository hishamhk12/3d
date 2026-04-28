import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getLogger } from "@/lib/logger";
import {
  expireOldSessions,
  expireIdleWaitingSessions,
  failStuckRenderingSessions,
  completeResultReadySessions,
} from "@/lib/room-preview/session-cleanup";
import { detectStuckSessions } from "@/lib/room-preview/stuck-detection";

const log = getLogger("cleanup-api");

/**
 * GET /api/room-preview/cleanup
 *
 * Four operations per run (in dependency order):
 *   1. Fail sessions stuck in rendering/ready_to_render > 7 min.
 *   2. Complete result_ready sessions after the display window (90 s).
 *   3. Expire waiting_for_mobile sessions idle > 1 min.
 *   4. Expire any remaining live sessions past their expiresAt.
 *
 * Protected by a shared secret — pass via header x-cleanup-secret.
 * In local dev the secret check is skipped when CLEANUP_SECRET is not set.
 */
export async function GET(request: NextRequest) {
  const expectedSecret = process.env.CLEANUP_SECRET;

  if (expectedSecret) {
    const providedSecret = request.headers.get("x-cleanup-secret") ?? "";
    const provided = Buffer.from(providedSecret);
    const expected = Buffer.from(expectedSecret);

    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const detectedIssues = await detectStuckSessions();
    const [stuckFailed, completed, idleExpired, expired] = await Promise.all([
      failStuckRenderingSessions(),
      completeResultReadySessions(),
      expireIdleWaitingSessions(),
      expireOldSessions(),
    ]);

    log.info({ stuckFailed, completed, idleExpired, expired, detectedIssues }, "Session cleanup complete");

    return NextResponse.json({
      ok: true,
      expired,
      idleExpired,
      stuckFailed,
      completed,
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
