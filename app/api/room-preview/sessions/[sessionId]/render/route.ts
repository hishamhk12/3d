import { createHash } from "node:crypto";
import { after, NextResponse } from "next/server";
import { getLogger } from "@/lib/logger";
import { guardSession } from "@/lib/room-preview/api-guard";
import { isRoomPreviewRateLimitDisabled } from "@/lib/room-preview/rate-limit-bypass";
import { trackEvent, getUserSessionIdForSession } from "@/lib/analytics/event-tracker";
import {
  isRoomPreviewSessionExpiredError,
  isRoomPreviewSessionNotFoundError,
  RoomPreviewSessionTransitionError,
  startRenderSession,
} from "@/lib/room-preview/session-service";
import {
  acquireRenderLock,
  checkDeviceCooldown,
  releaseRenderLock,
  setDeviceCooldown,
  DEVICE_COOLDOWN_SECONDS,
} from "@/lib/room-preview/render-rate-limit";
import {
  decrementRenderCount,
  getSessionById,
  getSessionScreenFields,
  tryIncrementRenderCount,
} from "@/lib/room-preview/session-repository";
import { executeRenderPipeline } from "@/lib/room-preview/render-service";
import { openSessionIssue, trackSessionEvent } from "@/lib/room-preview/session-diagnostics";
import {
  checkAndIncrementScreenBudget,
  checkScreenCooldown,
  decrementScreenBudget,
  getActiveScreenById,
  saveSessionRenderHash,
  touchScreenLastRenderAt,
} from "@/lib/room-preview/screen-repository";

const log = getLogger("render-api");

/** Maximum renders allowed per session. */
const MAX_RENDERS_PER_SESSION = 2;

// Keep the function alive for up to 5 minutes so the after() render pipeline
// can complete. Requires Vercel Pro.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDeviceFingerprint(request: Request): string {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip")?.trim() ??
    "";

  const ua = (request.headers.get("user-agent") ?? "").slice(0, 300);

  const input = ip || ua ? `${ip}|${ua}` : "unknown";

  return createHash("sha256")
    .update(input)
    .digest("hex")
    .slice(0, 32);
}

function tooManyRequests(body: { error: string }, retryAfter: number): NextResponse {
  return NextResponse.json(body, {
    status: 429,
    headers: { "Retry-After": String(retryAfter) },
  });
}

function buildRenderHash(roomImageUrl: string, productId: string): string {
  return createHash("sha256")
    .update(`${roomImageUrl}::${productId}`)
    .digest("hex");
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(
  request: Request,
  context: RouteContext<"/api/room-preview/sessions/[sessionId]/render">,
) {
  const { sessionId } = await context.params;

  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const unauthorized = guardSession(request, sessionId);
  if (unauthorized) return unauthorized;

  const rateLimitDisabled = isRoomPreviewRateLimitDisabled();

  await trackSessionEvent({
    sessionId,
    source: "server",
    eventType: "render_requested",
    level: "info",
  });

  const deviceId = getDeviceFingerprint(request);

  // ── 2. Idempotency lock ────────────────────────────────────────────────────
  let renderLockAcquired = false;
  if (!rateLimitDisabled) {
    const lock = await acquireRenderLock(sessionId);
    if (!lock.acquired) {
      log.warn({ sessionId }, "Render blocked — already in flight");
      return tooManyRequests({ error: "Render already in progress. Please wait." }, 30);
    }

    renderLockAcquired = true;
  }

  let renderCountIncremented = false;
  let screenBudgetIncremented = false;
  let screenId: string | null = null;

  try {
    // ── 3. Fetch session early (needed for dedupe + screen checks) ──────────
    const [session, screenFields] = await Promise.all([
      getSessionById(sessionId),
      getSessionScreenFields(sessionId),
    ]);

    screenId = screenFields?.screenId ?? null;

    // ── 4. Dedupe — return cached result if inputs haven't changed ──────────
    const roomImageUrl = session?.selectedRoom?.imageUrl;
    const productId = session?.selectedProduct?.id;

    if (roomImageUrl && productId) {
      const renderHash = buildRenderHash(roomImageUrl, productId);

      if (
        screenFields?.lastRenderHash === renderHash &&
        session?.renderResult !== null
      ) {
        log.info({ sessionId }, "Render dedupe hit — returning cached result");
        return NextResponse.json(session, { status: 200 });
      }
    }

    // ── 5. Device cooldown ─────────────────────────────────────────────────
    if (!rateLimitDisabled) {
      const cooldown = await checkDeviceCooldown(deviceId);
      if (cooldown.limited) {
        log.warn({ sessionId, deviceId, ttl: cooldown.ttl }, "Render blocked — device cooldown active");
        return tooManyRequests({ error: "Try again after 5 minutes" }, cooldown.ttl);
      }
    }

    // ── 6. Session render count ────────────────────────────────────────────
    if (!rateLimitDisabled) {
      const countResult = await tryIncrementRenderCount(sessionId, MAX_RENDERS_PER_SESSION);

      if (!countResult.incremented) {
        log.warn({ sessionId, currentCount: countResult.currentCount }, "Render blocked — session limit reached");
        return tooManyRequests({ error: "Session limit reached" }, DEVICE_COOLDOWN_SECONDS);
      }

      renderCountIncremented = true;
    }

    // ── 7. Screen checks (cooldown + budget) ───────────────────────────────
    if (!rateLimitDisabled && screenId) {
      const screen = await getActiveScreenById(screenId);

      if (screen) {
        const screenCooldown = checkScreenCooldown(screen.lastRenderAt);
        if (screenCooldown.limited) {
          log.warn({ sessionId, screenId, retryAfter: screenCooldown.retryAfterSeconds }, "Render blocked — screen cooldown");
          return tooManyRequests(
            { error: "This screen is cooling down. Please wait before rendering again." },
            screenCooldown.retryAfterSeconds,
          );
        }

        const budget = await checkAndIncrementScreenBudget(screenId, screen.dailyBudget);
        if (!budget.allowed) {
          log.warn({ sessionId, screenId }, "Render blocked — screen daily budget exhausted");
          return tooManyRequests(
            { error: "Daily render limit reached for this screen. Try again tomorrow." },
            3600,
          );
        }

        screenBudgetIncremented = true;
      }
    }

    // ── 8. Transition session to ready_to_render and respond immediately ───
    const updatedSession = await startRenderSession(sessionId);

    // Arm device cooldown now so rapid re-submissions are blocked regardless of
    // render outcome.
    if (!rateLimitDisabled) {
      await setDeviceCooldown(deviceId);
    }

    // Update screen's lastRenderAt and save the render hash for future deduplication.
    const afterPromises: Promise<void>[] = [];

    if (screenId) {
      afterPromises.push(
        touchScreenLastRenderAt(screenId).catch((err) => {
          log.error({ err, screenId }, "Failed to touch screen lastRenderAt");
        }),
      );
    }

    if (roomImageUrl && productId) {
      const renderHash = buildRenderHash(roomImageUrl, productId);
      afterPromises.push(
        saveSessionRenderHash(sessionId, renderHash).catch((err) => {
          log.error({ err, sessionId }, "Failed to save session render hash");
        }),
      );
    }

    if (afterPromises.length > 0) {
      await Promise.all(afterPromises);
    }

    // ── 9. Schedule pipeline and analytics in after() ─────────────────────
    after(async () => {
      const userSessionId = await getUserSessionIdForSession(sessionId);
      if (userSessionId) {
        await trackEvent({ userSessionId, eventType: "render_started", sessionId });
      }
    });

    after(async () => {
      await executeRenderPipeline(sessionId);
    });

    return NextResponse.json(updatedSession, { status: 202 });
  } catch (error) {
    if (renderCountIncremented) {
      await decrementRenderCount(sessionId).catch((err) => {
        log.error({ err, sessionId }, "Failed to roll back render count after error");
      });
    }

    if (screenBudgetIncremented && screenId) {
      await decrementScreenBudget(screenId).catch((err) => {
        log.error({ err, screenId }, "Failed to roll back screen budget after error");
      });
    }

    if (isRoomPreviewSessionNotFoundError(error)) {
      return NextResponse.json(
        { code: error.code, error: error.message },
        { status: 404 },
      );
    }

    if (isRoomPreviewSessionExpiredError(error)) {
      return NextResponse.json(
        { code: error.code, error: error.message },
        { status: 410 },
      );
    }

    if (error instanceof RoomPreviewSessionTransitionError) {
      await openSessionIssue({
        sessionId,
        type: "RENDER_FAILED",
        metadata: { code: error.code, currentStatus: error.currentStatus },
      });
      return NextResponse.json(
        { code: error.code, error: error.message },
        { status: 400 },
      );
    }

    log.error({ err: error, sessionId }, "Failed to start render session");
    await openSessionIssue({
      sessionId,
      type: "RENDER_FAILED",
      metadata: { phase: "render_request" },
    });
    return NextResponse.json(
      { error: "Failed to start render session." },
      { status: 500 },
    );
  } finally {
    if (renderLockAcquired) {
      await releaseRenderLock(sessionId).catch((err) => {
        log.error({ err, sessionId }, "Failed to release render lock");
      });
    }
  }
}
