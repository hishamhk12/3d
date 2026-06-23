import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RoomPreviewSession } from "@/lib/room-preview/types";

// ─── Mocks (must precede all imports of the module under test) ────────────────

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: vi.fn((fn: () => unknown) => { void fn(); }),
  };
});

vi.mock("@/lib/logger", () => ({
  getLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("@/lib/room-preview/session-repository", () => ({
  tryClaimRenderingSlot: vi.fn(),
  getSessionById: vi.fn(),
  getSessionScreenFields: vi.fn(),
  saveSessionState: vi.fn(),
  decrementRenderCount: vi.fn(),
}));

vi.mock("@/lib/room-preview/render-repository", () => ({
  createRenderJob: vi.fn(),
  updateRenderJob: vi.fn(),
  findStuckRenderJobForSession: vi.fn(),
}));

vi.mock("@/lib/room-preview/gemini-semaphore", () => ({
  acquireGeminiSlot: vi.fn(),
  releaseGeminiSlot: vi.fn(),
}));

vi.mock("@/lib/room-preview/render-providers", () => ({
  renderRoomPreviewWithProvider: vi.fn(),
}));

vi.mock("@/lib/room-preview/session-diagnostics", () => ({
  trackSessionEvent: vi.fn().mockResolvedValue(undefined),
  openSessionIssue: vi.fn().mockResolvedValue(undefined),
  resolveSessionIssue: vi.fn().mockResolvedValue(undefined),
  diagnosticsErrorMetadata: vi.fn().mockReturnValue({ message: "err", name: "Error" }),
}));

vi.mock("@/lib/room-preview/session-events", () => ({
  publishRoomPreviewSessionEvent: vi.fn(),
}));

vi.mock("@/lib/room-preview/screen-repository", () => ({
  decrementScreenBudget: vi.fn(),
}));

vi.mock("@/lib/analytics/event-tracker", () => ({
  trackEvent: vi.fn().mockResolvedValue(undefined),
  getUserSessionIdForSession: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/room-preview/customer-service", () => ({
  saveCustomerExperienceForSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/room-preview/validators", () => ({
  isFloorMaterialProduct: vi.fn().mockReturnValue(true),
  isRenderableProduct: vi.fn().mockReturnValue(true),
}));

// ─── Import module under test ─────────────────────────────────────────────────

const {
  executeRenderPipeline,
  recoverStuckRenderJob,
} = await import("@/lib/room-preview/render-service");

const { tryClaimRenderingSlot, getSessionById, getSessionScreenFields, saveSessionState, decrementRenderCount } =
  await import("@/lib/room-preview/session-repository");
const { createRenderJob, updateRenderJob, findStuckRenderJobForSession } =
  await import("@/lib/room-preview/render-repository");
const { acquireGeminiSlot, releaseGeminiSlot } =
  await import("@/lib/room-preview/gemini-semaphore");
const { renderRoomPreviewWithProvider } =
  await import("@/lib/room-preview/render-providers");
const { trackSessionEvent, openSessionIssue, resolveSessionIssue } =
  await import("@/lib/room-preview/session-diagnostics");
const { decrementScreenBudget } =
  await import("@/lib/room-preview/screen-repository");

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SESSION_ID = "test-session-pipeline";

const renderingSession: RoomPreviewSession = {
  id: SESSION_ID,
  status: "rendering",
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T01:00:00.000Z",
  expiresAt: null,
  mobileConnected: true,
  selectedRoom: {
    source: "camera",
    imageUrl: "https://example.com/room.jpg",
  },
  selectedProduct: {
    id: "prod-1",
    barcode: null,
    name: "Oak Flooring",
    productType: "floor_material",
    imageUrl: "https://example.com/product.jpg",
  },
  renderResult: null,
};

const fakeJob = {
  id: "job-abc123",
  sessionId: SESSION_ID,
  status: "pending" as const,
  input: {
    product: renderingSession.selectedProduct!,
    room: renderingSession.selectedRoom!,
    sessionId: SESSION_ID,
  },
  result: null,
  createdAt: "2024-01-01T01:00:00.000Z",
  updatedAt: "2024-01-01T01:00:00.000Z",
};

const fakeProviderResult = {
  imageUrl: "https://storage.example.com/result.png",
  kind: "composited_preview" as const,
  generatedAt: "2024-01-01T01:01:00.000Z",
  modelName: "gemini-3.1-flash-image-preview",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setupSuccessPath() {
  vi.mocked(tryClaimRenderingSlot).mockResolvedValue(true);
  vi.mocked(getSessionById).mockResolvedValue(renderingSession);
  vi.mocked(getSessionScreenFields).mockResolvedValue({ screenId: null, lastRenderHash: null });
  vi.mocked(createRenderJob).mockResolvedValue(fakeJob);
  vi.mocked(updateRenderJob).mockResolvedValue({ ...fakeJob, status: "completed" });
  vi.mocked(acquireGeminiSlot).mockResolvedValue({ acquired: true, slot: { slotId: "slot-1" } });
  vi.mocked(releaseGeminiSlot).mockResolvedValue(undefined);
  vi.mocked(renderRoomPreviewWithProvider).mockResolvedValue(fakeProviderResult);
  vi.mocked(saveSessionState).mockImplementation(async (input) => ({
    ...renderingSession,
    ...input,
    updatedAt: new Date().toISOString(),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Tests: executeRenderPipeline ─────────────────────────────────────────────

describe("executeRenderPipeline", () => {
  it("returns early without calling provider when the rendering slot cannot be claimed", async () => {
    vi.mocked(tryClaimRenderingSlot).mockResolvedValue(false);

    await executeRenderPipeline(SESSION_ID);

    expect(renderRoomPreviewWithProvider).not.toHaveBeenCalled();
    expect(createRenderJob).not.toHaveBeenCalled();
  });

  it("creates a render job, calls provider, and transitions session to result_ready on success", async () => {
    setupSuccessPath();

    await executeRenderPipeline(SESSION_ID);

    expect(createRenderJob).toHaveBeenCalledOnce();
    expect(createRenderJob).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: SESSION_ID, status: "pending" }),
    );

    expect(renderRoomPreviewWithProvider).toHaveBeenCalledOnce();
    expect(renderRoomPreviewWithProvider).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: fakeJob.id, sessionId: SESSION_ID }),
    );

    // Job should be updated to completed with result
    expect(updateRenderJob).toHaveBeenCalledWith(
      fakeJob.id,
      expect.objectContaining({ status: "completed", result: expect.objectContaining({ imageUrl: fakeProviderResult.imageUrl }) }),
    );

    // Session should be saved (via persistSessionTransition)
    expect(saveSessionState).toHaveBeenCalledWith(
      expect.objectContaining({ status: "result_ready", id: SESSION_ID }),
    );
  });

  it("emits render_completed diagnostic event on success", async () => {
    setupSuccessPath();

    await executeRenderPipeline(SESSION_ID);

    expect(trackSessionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: SESSION_ID,
        eventType: "render_completed",
        level: "info",
        statusAfter: "result_ready",
      }),
    );
  });

  it("emits render_timing_summary diagnostic event on success", async () => {
    setupSuccessPath();

    await executeRenderPipeline(SESSION_ID);

    expect(trackSessionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: SESSION_ID,
        eventType: "render_timing_summary",
        metadata: expect.objectContaining({ status: "completed", renderJobId: fakeJob.id }),
      }),
    );
  });

  it("resolves RENDER_FAILED and RENDER_TIMEOUT issues on success", async () => {
    setupSuccessPath();

    await executeRenderPipeline(SESSION_ID);

    expect(resolveSessionIssue).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: SESSION_ID, type: "RENDER_FAILED" }),
    );
    expect(resolveSessionIssue).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: SESSION_ID, type: "RENDER_TIMEOUT" }),
    );
  });

  it("on provider failure: marks job failed and rolls back render count", async () => {
    setupSuccessPath();
    vi.mocked(renderRoomPreviewWithProvider).mockRejectedValue(new Error("Gemini unavailable"));
    vi.mocked(decrementRenderCount).mockResolvedValue(undefined);

    await executeRenderPipeline(SESSION_ID);

    expect(updateRenderJob).toHaveBeenCalledWith(
      fakeJob.id,
      expect.objectContaining({ status: "failed" }),
    );

    expect(decrementRenderCount).toHaveBeenCalledWith(SESSION_ID);
  });

  it("on provider failure: rolls back screen budget when a screenId is present", async () => {
    setupSuccessPath();
    vi.mocked(getSessionScreenFields).mockResolvedValue({ screenId: "screen-99", lastRenderHash: null });
    vi.mocked(renderRoomPreviewWithProvider).mockRejectedValue(new Error("timeout"));
    vi.mocked(decrementScreenBudget).mockResolvedValue(undefined);

    await executeRenderPipeline(SESSION_ID);

    expect(decrementScreenBudget).toHaveBeenCalledWith("screen-99");
  });

  it("on provider failure: does NOT decrement screen budget when no screenId", async () => {
    setupSuccessPath();
    vi.mocked(getSessionScreenFields).mockResolvedValue({ screenId: null, lastRenderHash: null });
    vi.mocked(renderRoomPreviewWithProvider).mockRejectedValue(new Error("timeout"));

    await executeRenderPipeline(SESSION_ID);

    expect(decrementScreenBudget).not.toHaveBeenCalled();
  });

  it("on provider failure: emits render_failed diagnostic with failure reason", async () => {
    setupSuccessPath();
    const err = Object.assign(new Error("gemini timed out"), { failureReason: "gemini_timeout" });
    vi.mocked(renderRoomPreviewWithProvider).mockRejectedValue(err);

    await executeRenderPipeline(SESSION_ID);

    expect(trackSessionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: SESSION_ID,
        eventType: "render_failed",
        level: "error",
        code: "gemini_timeout",
      }),
    );
  });

  it("on provider failure: emits render_timing_summary with status=failed", async () => {
    setupSuccessPath();
    vi.mocked(renderRoomPreviewWithProvider).mockRejectedValue(new Error("fail"));

    await executeRenderPipeline(SESSION_ID);

    expect(trackSessionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "render_timing_summary",
        metadata: expect.objectContaining({ status: "failed" }),
      }),
    );
  });

  it("on provider failure: opens RENDER_FAILED session issue", async () => {
    setupSuccessPath();
    vi.mocked(renderRoomPreviewWithProvider).mockRejectedValue(new Error("fail"));

    await executeRenderPipeline(SESSION_ID);

    expect(openSessionIssue).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: SESSION_ID, type: "RENDER_FAILED" }),
    );
  });

  it("when semaphore is at capacity: does not call provider and emits render_capacity_exceeded", async () => {
    vi.mocked(tryClaimRenderingSlot).mockResolvedValue(true);
    vi.mocked(getSessionById).mockResolvedValue(renderingSession);
    vi.mocked(getSessionScreenFields).mockResolvedValue({ screenId: null, lastRenderHash: null });
    vi.mocked(createRenderJob).mockResolvedValue(fakeJob);
    vi.mocked(updateRenderJob).mockResolvedValue({ ...fakeJob, status: "processing" });
    vi.mocked(acquireGeminiSlot).mockResolvedValue({ acquired: false });

    await executeRenderPipeline(SESSION_ID);

    expect(renderRoomPreviewWithProvider).not.toHaveBeenCalled();

    expect(trackSessionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: SESSION_ID,
        eventType: "render_capacity_exceeded",
        level: "warning",
      }),
    );
  });

  it("releases the Gemini slot even when the provider throws", async () => {
    setupSuccessPath();
    vi.mocked(renderRoomPreviewWithProvider).mockRejectedValue(new Error("provider error"));

    await executeRenderPipeline(SESSION_ID);

    expect(releaseGeminiSlot).toHaveBeenCalledWith({ slotId: "slot-1" });
  });
});

// ─── Tests: recoverStuckRenderJob ─────────────────────────────────────────────

describe("recoverStuckRenderJob", () => {
  it("returns false when no stuck job is found", async () => {
    vi.mocked(findStuckRenderJobForSession).mockResolvedValue(null);

    const result = await recoverStuckRenderJob(SESSION_ID);

    expect(result).toBe(false);
    expect(updateRenderJob).not.toHaveBeenCalled();
  });

  it("marks the stuck job as failed and returns true", async () => {
    const stuckJob = { id: "stuck-job-1", updatedAt: new Date(Date.now() - 10 * 60_000) };
    vi.mocked(findStuckRenderJobForSession).mockResolvedValue(stuckJob);
    vi.mocked(getSessionById).mockResolvedValue({ ...renderingSession, status: "rendering" });
    vi.mocked(saveSessionState).mockImplementation(async (input) => ({
      ...renderingSession,
      ...input,
    }));

    const result = await recoverStuckRenderJob(SESSION_ID);

    expect(result).toBe(true);
    expect(updateRenderJob).toHaveBeenCalledWith(
      stuckJob.id,
      expect.objectContaining({ status: "failed", failureReason: "render_timeout_no_update" }),
    );
  });

  it("emits render_stuck_recovery diagnostic event", async () => {
    const stuckJob = { id: "stuck-job-2", updatedAt: new Date(Date.now() - 10 * 60_000) };
    vi.mocked(findStuckRenderJobForSession).mockResolvedValue(stuckJob);
    vi.mocked(getSessionById).mockResolvedValue({ ...renderingSession, status: "rendering" });
    vi.mocked(saveSessionState).mockImplementation(async (input) => ({
      ...renderingSession,
      ...input,
    }));

    await recoverStuckRenderJob(SESSION_ID);

    expect(trackSessionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: SESSION_ID,
        eventType: "render_stuck_recovery",
        level: "warning",
        metadata: expect.objectContaining({ renderJobId: stuckJob.id }),
      }),
    );
  });

  it("opens RENDER_TIMEOUT session issue", async () => {
    const stuckJob = { id: "stuck-job-3", updatedAt: new Date(Date.now() - 10 * 60_000) };
    vi.mocked(findStuckRenderJobForSession).mockResolvedValue(stuckJob);
    vi.mocked(getSessionById).mockResolvedValue({ ...renderingSession, status: "rendering" });
    vi.mocked(saveSessionState).mockImplementation(async (input) => ({
      ...renderingSession,
      ...input,
    }));

    await recoverStuckRenderJob(SESSION_ID);

    expect(openSessionIssue).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: SESSION_ID, type: "RENDER_TIMEOUT" }),
    );
  });
});
