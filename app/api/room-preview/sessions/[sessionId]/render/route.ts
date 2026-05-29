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
import { executeRenderPipeline, recoverStuckRenderJob } from "@/lib/room-preview/render-service";
import { openSessionIssue, trackSessionEvent } from "@/lib/room-preview/session-diagnostics";
import {
  checkAndIncrementScreenBudget,
  checkScreenCooldown,
  decrementScreenBudget,
  getActiveScreenById,
  saveSessionRenderHash,
  touchScreenLastRenderAt,
} from "@/lib/room-preview/screen-repository";
import {
  buildRenderHash,
  getDeviceFingerprint,
  tooManyRequests,
} from "@/lib/room-preview/render-route-utils";

const log = getLogger("render-api");

/** Maximum renders allowed per session. Override with MAX_RENDERS_PER_SESSION env var. */
const _envMax = parseInt(process.env.MAX_RENDERS_PER_SESSION ?? "", 10);
const MAX_RENDERS_PER_SESSION = Number.isFinite(_envMax) && _envMax > 0 ? _envMax : 2;

// ─── Rate-limit event dedup ────────────────────────────────────────────────────
// Prevents repeated taps from flooding the timeline. One event per key per
// 60 s is sufficient signal; subsequent rejections within the window are silent.
const RATE_LIMIT_WARN_COOLDOWN_MS = 60_000;
const renderLimitWarnCooldown = new Map<string, number>();
const deviceCooldownWarnMap   = new Map<string, number>();
const screenBudgetWarnMap     = new Map<string, number>();

// Keep the function alive for up to 5 minutes so the after() render pipeline
// can complete. Requires Vercel Pro.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

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
      // Skip dedup when session is already at result_ready: the customer explicitly
      // pressed "تعديل" to request a fresh render with the same inputs.
      if (
        screenFields?.lastRenderHash === renderHash &&
        session.renderResult !== null &&
        session.status !== "result_ready"
      ) {
        log.info({ sessionId }, "Render dedupe hit — returning cached result");
        return NextResponse.json(session, { status: 200 });
      }
    }

    // ── 6. Device cooldown (already fetched in step 3) ─────────────────────
    if (!rateLimitDisabled && cooldownResult.limited) {
      log.warn({ sessionId, deviceId, ttl: cooldownResult.ttl }, "Render blocked — device cooldown active");

      after(async () => {
        const now = Date.now();
        const last = deviceCooldownWarnMap.get(deviceId);
        if (last === undefined || now - last >= RATE_LIMIT_WARN_COOLDOWN_MS) {
          deviceCooldownWarnMap.set(deviceId, now);
          await trackSessionEvent({
            sessionId,
            source: "server",
            eventType: "render_device_cooldown",
            level: "warning",
            metadata: {
              ttl: cooldownResult.ttl,
              status: session.status,
            },
          });
        }
      });

      return tooManyRequests(
        { error: "Device cooldown active. Try again after 5 minutes.", code: "RENDER_DEVICE_COOLDOWN" },
        cooldownResult.ttl,
      );
    }

    // ── 7. Session render count ────────────────────────────────────────────
    if (!rateLimitDisabled) {
      const countResult = await tryIncrementRenderCount(sessionId, MAX_RENDERS_PER_SESSION);
      if (!countResult.incremented) {
        log.warn({ sessionId, currentCount: countResult.currentCount }, "Render blocked — session limit reached");

        // Fire render_limit_reached once per 60 s per session to avoid timeline spam.
        after(async () => {
          const now = Date.now();
          const last = renderLimitWarnCooldown.get(sessionId);
          if (last === undefined || now - last >= RATE_LIMIT_WARN_COOLDOWN_MS) {
            renderLimitWarnCooldown.set(sessionId, now);
            await trackSessionEvent({
              sessionId,
              source: "server",
              eventType: "render_limit_reached",
              level: "warning",
              metadata: {
                renderCount: countResult.currentCount,
                maxRendersPerSession: MAX_RENDERS_PER_SESSION,
                status: session.status,
              },
            });
          }
        });

        return tooManyRequests(
          { error: "Session render limit reached.", code: "RENDER_LIMIT_REACHED" },
          DEVICE_COOLDOWN_SECONDS,
        );
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

          // Capture non-null locals for use inside the after() closure.
          const screenIdNonNull = screenId;
          const dailyBudget = screen.dailyBudget;

          after(async () => {
            const now = Date.now();
            const last = screenBudgetWarnMap.get(screenIdNonNull);
            if (last === undefined || now - last >= RATE_LIMIT_WARN_COOLDOWN_MS) {
              screenBudgetWarnMap.set(screenIdNonNull, now);
              await trackSessionEvent({
                sessionId,
                source: "server",
                eventType: "screen_budget_exhausted",
                level: "warning",
                metadata: {
                  screenId: screenIdNonNull,
                  dailyBudget,
                  status: session.status,
                },
              });
            }
          });

          return tooManyRequests(
            { error: "Screen daily render budget exhausted.", code: "SCREEN_BUDGET_EXHAUSTED" },
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
    //
    // If the session is stuck in "rendering" (a prior Vercel invocation was killed
    // before the pipeline completed), recover it first. markReadyToRenderTransition
    // only accepts product_selected / result_ready / failed as source states, so
    // an unrecovered "rendering" session would throw a transition error.
    let sessionForTransition = session;
    if (session.status === "rendering") {
      const recovered = await recoverStuckRenderJob(sessionId);
      if (recovered) {
        const refreshed = await getSessionById(sessionId);
        if (!refreshed) throw new RoomPreviewSessionNotFoundError();
        sessionForTransition = refreshed;
      } else {
        // No stuck job found — another instance is likely actively rendering.
        return tooManyRequests({ error: "Render already in progress. Please wait.", code: "RENDER_IN_PROGRESS" }, 30);
      }
    }

    const readySession  = markReadyToRenderTransition(sessionForTransition);
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

    if (sessionForTransition.status !== updatedSession.status) {
      void trackSessionEvent({
        sessionId: updatedSession.id,
        source: "server",
        eventType: "session_status_changed",
        level: "info",
        statusBefore: sessionForTransition.status,
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
