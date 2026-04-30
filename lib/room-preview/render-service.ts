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
import { createRenderJob, updateRenderJob } from "@/lib/room-preview/render-repository";
import {
  decrementRenderCount,
  getSessionById,
  saveSessionState,
  tryClaimRenderingSlot,
} from "@/lib/room-preview/session-repository";
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
  // Atomic check-and-claim: only one process can win for a given sessionId.
  // This replaces the in-process globalThis guard and works across multiple
  // server instances because it relies on a conditional DB update.
  const claimed = await tryClaimRenderingSlot(sessionId);

  if (!claimed) {
    // Session is already rendering, not ready, or doesn't exist.
    return;
  }

  let renderJobId: string | null = null;

  try {
    // Fetch the session — it is now in "rendering" state in the DB.
    const session = await getSessionById(sessionId);

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
      throw new Error("Render capacity reached. Please try again in a moment.");
    }

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
    if (renderJobId) {
      await updateRenderJob(renderJobId, {
        result: null,
        status: "failed",
      }).catch(() => undefined);
    }

    await markSessionAsFailed(sessionId).catch(() => undefined);
    await openSessionIssue({
      sessionId,
      type: "RENDER_FAILED",
      metadata: {
        renderJobId,
        error: diagnosticsErrorMetadata(err),
      },
    });
    await trackSessionEvent({
      sessionId,
      source: "renderer",
      eventType: "render_failed",
      level: "error",
      code: "RENDER_FAILED",
      message: err instanceof Error ? err.message : String(err),
      metadata: { renderJobId },
    });
    await decrementRenderCount(sessionId).catch((error) => {
      log.error({ err: error, sessionId }, "Failed to roll back render count after pipeline failure");
    });

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

/**
 * Run the render pipeline for a session and wait for it to finish.
 *
 * This replaces the previous `startRoomPreviewRenderPipeline` + `setTimeout`
 * pattern, which was silently broken on serverless runtimes (Vercel, AWS
 * Lambda, etc.) where the process is frozen the moment the HTTP response is
 * sent and any pending `setTimeout` callbacks are never executed.
 *
 * Callers must now `await` this function inside their request handler so the
 * runtime keeps the invocation alive for the full duration of the AI render.
 * Set `export const maxDuration = 300` on the corresponding route file to
 * allow up to 5 minutes on Vercel Pro.
 */
export async function executeRenderPipeline(sessionId: string): Promise<void> {
  try {
    await runRoomPreviewRenderPipeline(sessionId);
  } catch (err) {
    log.error({ err, sessionId }, "Unexpected top-level render pipeline error");
  }
}
