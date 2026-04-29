import { createHash } from "node:crypto";
import { after, NextResponse } from "next/server";
import { getLogger } from "@/lib/logger";
import { guardSession } from "@/lib/room-preview/api-guard";
import { isRoomPreviewRateLimitDisabled } from "@/lib/room-preview/rate-limit-bypass";
import { trackEvent, getUserSessionIdForSession } from "@/lib/analytics/event-tracker";
import {
  isRoomPreviewSessionExpiredError,
  isRoomPreviewSessionNotFoundError,
  RoomPreviewSessionExpiredError,
  RoomPreviewSessionNotFoundError,
  RoomPreviewSessionTransitionError,
} from "@/lib/room-preview/session-service";
import { markReadyToRenderTransition } from "@/lib/room-preview/session-machine";
import { isEffectivelyExpired } from "@/lib/room-preview/session-status";
import { publishRoomPreviewSessionEvent } from "@/lib/room-preview/session-events";
import {
  acquireRenderLock,
  checkDeviceCooldown,
  type DeviceCooldownResult,
  releaseRenderLock,
  setDeviceCooldown,
  DEVICE_COOLDOWN_SECONDS,
} from "@/lib/room-preview/render-rate-limit";
import {
  decrementRenderCount,
  getSessionById,
  getSessionScreenFields,
  saveSessionState,
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
  const deviceId = getDeviceFingerprint(request);

  // ── 2. Idempotency lock ────────────────────────────────────────────────────
  //
  // Kept sequential (not merged into the parallel block below) so we never
  // acquire the lock and then fail to track renderLockAcquired if a parallel
  // DB read throws first.
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
    // ── 3. Parallel reads ──────────────────────────────────────────────────
    //
    // Previously: getSessionById → getSessionScreenFields (parallel) → checkDeviceCooldown
    //             = 3 sequential async steps.
    // Now:        getSessionById + getSessionScreenFields + checkDeviceCooldown
    //             = 1 parallel step. Saves one full Redis/DB round-trip (~5–30ms).
    const [session, screenFields, cooldownResult] = await Promise.all([
      getSessionById(sessionId),
      getSessionScreenFields(sessionId),
      rateLimitDisabled
        ? Promise.resolve<DeviceCooldownResult>({ limited: false })
        : checkDeviceCooldown(deviceId),
    ]);

    screenId = screenFields?.screenId ?? null;

    // ── 4. Session validation ──────────────────────────────────────────────
    //
    // Checked here — before the render-count increment — so an invalid session
    // doesn't trigger a wasted increment + decrement cycle.
    if (!session) throw new RoomPreviewSessionNotFoundError();
    if (isEffectivelyExpired(session)) throw new RoomPreviewSessionExpiredError();

    // ── 5. Dedupe — return cached result if inputs haven't changed ──────────
    const roomImageUrl = session.selectedRoom?.imageUrl;
    const productId    = session.selectedProduct?.id;

    if (roomImageUrl && productId) {
      const renderHash = buildRenderHash(roomImageUrl, productId);
      if (screenFields?.lastRenderHash === renderHash && session.renderResult !== null) {
        log.info({ sessionId }, "Render dedupe hit — returning cached result");
        return NextResponse.json(session, { status: 200 });
      }
    }

    // ── 6. Device cooldown (already fetched in step 3) ─────────────────────
    if (!rateLimitDisabled && cooldownResult.limited) {
      log.warn({ sessionId, deviceId, ttl: cooldownResult.ttl }, "Render blocked — device cooldown active");
      return tooManyRequests({ error: "Try again after 5 minutes" }, cooldownResult.ttl);
    }

    // ── 7. Session render count ────────────────────────────────────────────
    if (!rateLimitDisabled) {
      const countResult = await tryIncrementRenderCount(sessionId, MAX_RENDERS_PER_SESSION);
      if (!countResult.incremented) {
        log.warn({ sessionId, currentCount: countResult.currentCount }, "Render blocked — session limit reached");
        return tooManyRequests({ error: "Session limit reached" }, DEVICE_COOLDOWN_SECONDS);
      }
      renderCountIncremented = true;
    }

    // ── 8. Screen checks (cooldown + budget) ───────────────────────────────
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

    // ── 9. Transition session to ready_to_render ────────────────────────────
    //
    // Previously called startRenderSession(sessionId), which internally called
    // getSessionById again — a redundant third SELECT on the same row within
    // this request. We already hold a fresh copy from step 3, so apply the
    // transition directly and persist it — one DB write instead of read + write.
    const readySession  = markReadyToRenderTransition(session);
    const updatedSession = await saveSessionState({
      id:              readySession.id,
      status:          readySession.status,
      mobileConnected: readySession.mobileConnected,
      selectedRoom:    readySession.selectedRoom,
      selectedProduct: readySession.selectedProduct,
      renderResult:    readySession.renderResult,
    });

    publishRoomPreviewSessionEvent(updatedSession.id, {
      type: "session_updated",
      session: updatedSession,
    });

    if (session.status !== updatedSession.status) {
      void trackSessionEvent({
        sessionId: updatedSession.id,
        source: "server",
        eventType: "session_status_changed",
        level: "info",
        statusBefore: session.status,
        statusAfter:  updatedSession.status,
      });
    }

    // ── 10. Post-response work (non-blocking) ──────────────────────────────
    //
    // setDeviceCooldown, screen timestamp, render hash, and the render_requested
    // diagnostic are all rate-limiting metadata or audit records. None of them
    // affect the 202 body or the render pipeline. Running them in after() removes
    // ~40–60ms from the critical path.
    after(async () => {
      const writes: Promise<unknown>[] = [];

      if (!rateLimitDisabled) {
        writes.push(
          setDeviceCooldown(deviceId).catch((err) => {
            log.error({ err, sessionId }, "Failed to set device cooldown");
          }),
        );
      }

      if (screenId) {
        writes.push(
          touchScreenLastRenderAt(screenId).catch((err) => {
            log.error({ err, screenId }, "Failed to touch screen lastRenderAt");
          }),
        );
      }

      if (roomImageUrl && productId) {
        writes.push(
          saveSessionRenderHash(sessionId, buildRenderHash(roomImageUrl, productId)).catch((err) => {
            log.error({ err, sessionId }, "Failed to save session render hash");
          }),
        );
      }

      if (writes.length > 0) await Promise.all(writes);
    });

    after(async () => {
      void trackSessionEvent({
        sessionId,
        source: "server",
        eventType: "render_requested",
        level: "info",
      });
    });

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
