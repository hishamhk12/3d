import "server-only";

import { createHash } from "node:crypto";
import { after } from "next/server";

import { renderRoomPreviewWithProvider } from "@/lib/room-preview/render-providers";
import { acquireGeminiSlot, releaseGeminiSlot } from "@/lib/room-preview/gemini-semaphore";
import { publishRoomPreviewSessionEvent } from "@/lib/room-preview/session-events";
import {
  completeRenderingTransition,
  failRenderingTransition,
  RoomPreviewSessionTransitionError,
} from "@/lib/room-preview/session-machine";
import { createRenderJob, findStuckRenderJobForSession, updateRenderJob } from "@/lib/room-preview/render-repository";
import {
  decrementRenderCount,
  getSessionById,
  getSessionScreenFields,
  saveSessionState,
  tryClaimRenderingSlot,
} from "@/lib/room-preview/session-repository";
import { decrementScreenBudget } from "@/lib/room-preview/screen-repository";
import type {
  RenderJobInput,
  RenderJobResult,
  RoomPreviewRenderResult,
  RoomPreviewSession,
} from "@/lib/room-preview/types";
import { isFloorMaterialProduct } from "@/lib/room-preview/validators";
import { getLogger } from "@/lib/logger";
import { trackEvent, getUserSessionIdForSession } from "@/lib/analytics/event-tracker";
import { saveCustomerExperienceForSession } from "@/lib/room-preview/customer-service";
import {
  diagnosticsErrorMetadata,
  openSessionIssue,
  resolveSessionIssue,
  trackSessionEvent,
} from "@/lib/room-preview/session-diagnostics";

const log = getLogger("render-service");

function getFailureReason(err: unknown): string | null {
  if (
    err &&
    typeof err === "object" &&
    "failureReason" in err &&
    typeof (err as { failureReason?: unknown }).failureReason === "string"
  ) {
    return (err as { failureReason: string }).failureReason;
  }
  return null;
}

async function persistSessionTransition(nextSession: RoomPreviewSession) {
  const updatedSession = await saveSessionState({
    id: nextSession.id,
    status: nextSession.status,
    mobileConnected: nextSession.mobileConnected,
    selectedRoom: nextSession.selectedRoom,
    selectedProduct: nextSession.selectedProduct,
    renderResult: nextSession.renderResult,
  });

  publishRoomPreviewSessionEvent(updatedSession.id, {
    type: "session_updated",
    session: updatedSession,
  });

  if (nextSession.status !== updatedSession.status) {
    await trackSessionEvent({
      sessionId: updatedSession.id,
      source: "renderer",
      eventType: "session_status_changed",
      level: "info",
      statusAfter: updatedSession.status,
      metadata: { transition: "render_pipeline" },
    });
  }

  return updatedSession;
}

function buildRenderJobInput(session: RoomPreviewSession): RenderJobInput {
  if (!session.selectedRoom?.imageUrl || !session.selectedRoom.source) {
    throw new Error("A selected room is required before creating a render job.");
  }

  if (!session.selectedProduct?.id || !session.selectedProduct.imageUrl || !session.selectedProduct.name) {
    throw new Error("A selected product is required before creating a render job.");
  }

  if (!isFloorMaterialProduct(session.selectedProduct)) {
    throw new Error("Only floor_material products are supported in this render phase.");
  }

  return {
    product: session.selectedProduct,
    room: session.selectedRoom,
    sessionId: session.id,
  };
}

async function markSessionAsFailed(sessionId: string) {
  const session = await getSessionById(sessionId);

  if (!session) {
    return;
  }

  try {
    const failedSession = failRenderingTransition(session);
    await persistSessionTransition(failedSession);
  } catch (error) {
    if (!(error instanceof RoomPreviewSessionTransitionError)) {
      throw error;
    }
  }
}

async function runRoomPreviewRenderPipeline(sessionId: string) {
  const pipelineStart = Date.now();

  // Atomic check-and-claim: only one process can win for a given sessionId.
  // This replaces the in-process globalThis guard and works across multiple
  // server instances because it relies on a conditional DB update.
  const claimed = await tryClaimRenderingSlot(sessionId);

  if (!claimed) {
    // Session is already rendering, not ready, or doesn't exist.
    return;
  }

  // Timing checkpoints (ms since pipelineStart; 0 = not yet reached)
  let tSetupDone    = 0;   // Gemini slot acquired — provider is about to start
  let tProviderDone = 0;   // renderRoomPreviewWithProvider returned
  let tSaved        = 0;   // session state persisted + SSE published

  let renderJobId: string | null = null;
  let screenId: string | null = null;

  try {
    const [session, screenFields] = await Promise.all([
      getSessionById(sessionId),
      getSessionScreenFields(sessionId),
    ]);
    screenId = screenFields?.screenId ?? null;

    if (!session) {
      return;
    }

    // Notify clients that the session transitioned to "rendering".
    publishRoomPreviewSessionEvent(session.id, {
      type: "session_updated",
      session,
    });

    await trackSessionEvent({
      sessionId,
      source: "renderer",
      eventType: "render_started",
      level: "info",
      statusAfter: session.status,
    });

    const input = buildRenderJobInput(session);
    const inputHash =
      input.room.imageUrl && input.product.id
        ? createHash("sha256")
            .update(`${input.room.imageUrl}::${input.product.id}`)
            .digest("hex")
        : undefined;

    const createdJob = await createRenderJob({
      input,
      sessionId,
      status: "pending",
      inputHash,
    });
    renderJobId = createdJob.id;

    await updateRenderJob(createdJob.id, {
      status: "processing",
    });

    await trackSessionEvent({
      sessionId,
      source: "renderer",
      eventType: "render_job_processing",
      level: "info",
      metadata: { renderJobId: createdJob.id },
    });

    const semaphore = await acquireGeminiSlot();
    if (!semaphore.acquired) {
      await trackSessionEvent({
        sessionId,
        source: "renderer",
        eventType: "render_capacity_exceeded",
        level: "warning",
        metadata: {
          reason: "semaphore_capacity_exceeded",
          renderJobId,
        },
      });
      throw new Error("Render capacity reached. Please try again in a moment.");
    }

    tSetupDone = Date.now() - pipelineStart;

    let composedPreview: Awaited<ReturnType<typeof renderRoomPreviewWithProvider>>;
    try {
      composedPreview = await renderRoomPreviewWithProvider({
        jobId: createdJob.id,
        renderJobInput: input,
        sessionId,
      });
    } finally {
      await releaseGeminiSlot(semaphore.slot);
    }
    tProviderDone = Date.now() - pipelineStart;

    const result = {
      imageUrl: composedPreview.imageUrl,
      kind: composedPreview.kind,
      generatedAt: composedPreview.generatedAt,
      modelName: composedPreview.modelName,
    } satisfies RenderJobResult;

    await updateRenderJob(createdJob.id, {
      result,
      status: "completed",
    });

    await resolveSessionIssue({
      sessionId,
      type: "RENDER_FAILED",
      metadata: { renderJobId: createdJob.id },
    });
    await resolveSessionIssue({
      sessionId,
      type: "RENDER_TIMEOUT",
      metadata: { renderJobId: createdJob.id },
    });
    await trackSessionEvent({
      sessionId,
      source: "renderer",
      eventType: "render_completed",
      level: "info",
      statusAfter: "result_ready",
      metadata: {
        renderJobId: createdJob.id,
        modelName: composedPreview.modelName,
      },
    });

    after(async () => {
      const userSessionId = await getUserSessionIdForSession(sessionId);
      if (userSessionId) {
        await trackEvent({
          userSessionId,
          eventType: "render_completed",
          sessionId,
          renderJobId: createdJob.id,
          metadata: {
            durationMs: Date.now() - new Date(createdJob.createdAt).getTime(),
            modelName: composedPreview.modelName,
          },
        });
      }
    });

    await persistSessionTransition(
      completeRenderingTransition(session, {
        imageUrl: result.imageUrl,
        kind: result.kind,
        jobId: createdJob.id,
        generatedAt: result.generatedAt,
        modelName: result.modelName,
      } satisfies RoomPreviewRenderResult),
    );
    tSaved = Date.now() - pipelineStart;

    void trackSessionEvent({
      sessionId,
      source: "renderer",
      eventType: "render_timing_summary",
      level: "info",
      metadata: {
        renderJobId: createdJob.id,
        status: "completed",
        totalMs:    tSaved,
        setupMs:    tSetupDone > 0 ? tSetupDone : null,
        providerMs: tProviderDone > 0 && tSetupDone > 0 ? tProviderDone - tSetupDone : null,
        saveMs:     tSaved > 0 && tProviderDone > 0 ? tSaved - tProviderDone : null,
      },
    }).catch(() => undefined);

    // Save experience for returning customer tracking (fire-and-forget).
    after(async () => {
      await saveCustomerExperienceForSession(sessionId, {
        roomImageUrl: session.selectedRoom?.imageUrl,
        productId: session.selectedProduct?.id,
        productName: session.selectedProduct?.name,
        resultImageUrl: result.imageUrl,
      }).catch((err) => {
        log.warn({ err, sessionId }, "Failed to save customer experience after render");
      });
    });
  } catch (err) {
    const failureReason = getFailureReason(err);

    if (renderJobId) {
      await updateRenderJob(renderJobId, {
        result: null,
        status: "failed",
        failureReason: failureReason ?? (err instanceof Error ? err.message.slice(0, 500) : "Unknown render error"),
      }).catch(() => undefined);
    }

    await markSessionAsFailed(sessionId).catch(() => undefined);

    await openSessionIssue({
      sessionId,
      type: "RENDER_FAILED",
      metadata: {
        renderJobId,
        error: diagnosticsErrorMetadata(err),
        ...(failureReason ? { failureReason } : {}),
      },
    });
    await trackSessionEvent({
      sessionId,
      source: "renderer",
      eventType: "render_failed",
      level: "error",
      code: failureReason ?? "RENDER_FAILED",
      message: err instanceof Error ? err.message : String(err),
      metadata: { renderJobId, ...(failureReason ? { failureReason } : {}) },
    });

    void trackSessionEvent({
      sessionId,
      source: "renderer",
      eventType: "render_timing_summary",
      level: "warning",
      metadata: {
        renderJobId,
        status: "failed",
        totalMs:    Date.now() - pipelineStart,
        setupMs:    tSetupDone > 0 ? tSetupDone : null,
        providerMs: tProviderDone > 0 && tSetupDone > 0 ? tProviderDone - tSetupDone : null,
        saveMs:     null,
      },
    }).catch(() => undefined);

    await decrementRenderCount(sessionId).catch((error) => {
      log.error({ err: error, sessionId }, "Failed to roll back render count after pipeline failure");
    });

    if (screenId) {
      await decrementScreenBudget(screenId).catch((error) => {
        log.error({ err: error, sessionId, screenId }, "Failed to roll back screen budget after pipeline failure");
      });
    }

    after(async () => {
      const userSessionId = await getUserSessionIdForSession(sessionId);
      if (userSessionId) {
        await trackEvent({
          userSessionId,
          eventType: "render_failed",
          sessionId,
          renderJobId: renderJobId ?? undefined,
          metadata: { error: err instanceof Error ? err.message : String(err) },
        });
      }
    });

    log.error({ err, renderJobId, sessionId }, "Render pipeline failed");
  }
}

const STUCK_RENDER_THRESHOLD_MS = 8 * 60 * 1_000; // 8 minutes

/**
 * If a render job for this session has been stuck in `pending` or `processing`
 * for longer than 8 minutes, marks it failed and transitions the session to
 * `failed` so the user can retry. Returns `true` if recovery was performed.
 *
 * Called from the render route before `markReadyToRenderTransition` so that a
 * session stuck in `rendering` (from a killed Vercel invocation) can be
 * retried — `markReadyToRenderTransition` only accepts `product_selected`,
 * `result_ready`, and `failed` as source states.
 */
export async function recoverStuckRenderJob(sessionId: string): Promise<boolean> {
  const stuckJob = await findStuckRenderJobForSession(sessionId, STUCK_RENDER_THRESHOLD_MS);
  if (!stuckJob) return false;

  const stuckForMs = Date.now() - stuckJob.updatedAt.getTime();

  await updateRenderJob(stuckJob.id, {
    result: null,
    status: "failed",
    failureReason: "render_timeout_no_update",
  }).catch(() => undefined);

  await openSessionIssue({
    sessionId,
    type: "RENDER_TIMEOUT",
    metadata: { renderJobId: stuckJob.id, stuckForMs },
  });

  await trackSessionEvent({
    sessionId,
    source: "renderer",
    eventType: "render_stuck_recovery",
    level: "warning",
    metadata: { renderJobId: stuckJob.id, stuckForMs },
  });

  await markSessionAsFailed(sessionId).catch(() => undefined);

  log.warn({ sessionId, renderJobId: stuckJob.id, stuckForMs }, "Recovered stuck render job");

  return true;
}

/**
 * Executes the render pipeline for a session inside the `after()` background hook.
 *
 * Called via `after(async () => { await executeRenderPipeline(sessionId); })`
 * from the render route, which returns a 202 immediately while this function
 * runs for up to `maxDuration = 300` seconds on the Vercel invocation.
 *
 * All errors are caught and logged internally; callers do not need a try/catch.
 */
export async function executeRenderPipeline(sessionId: string): Promise<void> {
  try {
    await runRoomPreviewRenderPipeline(sessionId);
  } catch (err) {
    log.error({ err, sessionId }, "Unexpected top-level render pipeline error");
  }
}
