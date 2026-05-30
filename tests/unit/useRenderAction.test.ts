// @vitest-environment happy-dom

/**
 * Unit tests for `useRenderAction`.
 *
 * The hook owns the `renderRequestInFlightRef` guard and the async
 * `handleCreateRender` action, which:
 *   1. Blocks if `restartDoneRef.current` (restart-in-progress)
 *   2. Awaits any in-flight product save via `productSavePromiseRef`
 *   3. Guards against duplicate / no-session / already-rendering attempts
 *   4. Calls `createRenderForSession`, polls via `pollForRenderResult`
 *   5. Routes success vs failure to the correct Arabic message + diagnostics
 *   6. Cascades errors across 5 specific request-error codes + a timeout
 *      branch + a generic fallback
 *
 * No production code was modified — every dependency is already a param.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { MutableRefObject } from "react";
import type { RoomPreviewSession } from "@/lib/room-preview/types";
import type { TranslationDictionary } from "@/lib/i18n/dictionaries";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/room-preview/session-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/room-preview/session-client")>();
  return {
    ...actual,
    createRenderForSession: vi.fn(),
    // Keep RoomPreviewRequestError + isRoomPreviewRequestError real.
  };
});

vi.mock("@/lib/room-preview/session-polling", () => ({
  pollForRenderResult: vi.fn(),
}));

vi.mock("@/lib/room-preview/session-diagnostics-client", () => ({
  trackClientSessionEvent: vi.fn(),
}));

const { useRenderAction } = await import(
  "@/features/room-preview/mobile/useRenderAction"
);
const {
  createRenderForSession,
  RoomPreviewRequestError,
} = await import("@/lib/room-preview/session-client");
const { pollForRenderResult } = await import(
  "@/lib/room-preview/session-polling"
);
const { trackClientSessionEvent } = await import(
  "@/lib/room-preview/session-diagnostics-client"
);
const { getCustomerRecoveryMessage } = await import(
  "@/lib/room-preview/customer-recovery"
);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SESSION_ID = "test-session-render-action";
const SAVE_SUCCESS = "Render complete";

const t = {
  roomPreview: {
    mobile: {
      invalidLink: "Invalid link",
      expiredLink: "Expired link",
      loadFailed: "Failed to load session",
      product: {
        saveSuccess: SAVE_SUCCESS,
      },
    },
  },
} as unknown as TranslationDictionary;

function makeSession(overrides: Partial<RoomPreviewSession> = {}): RoomPreviewSession {
  return {
    id: SESSION_ID,
    status: "product_selected",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    mobileConnected: true,
    selectedRoom: { source: "camera", imageUrl: "https://cdn/room.jpg" },
    selectedProduct: {
      id: "p-1",
      barcode: null,
      name: "Oak",
      productType: "floor_material",
      imageUrl: "https://cdn/p-1.jpg",
    },
    renderResult: null,
    ...overrides,
  };
}

function makeResultReadySession(): RoomPreviewSession {
  return makeSession({
    status: "result_ready",
    renderResult: {
      imageUrl: "https://cdn/result.png",
      kind: "composited_preview",
      jobId: "job-1",
      generatedAt: new Date().toISOString(),
      modelName: "gemini",
    },
  });
}

type Params = Parameters<typeof useRenderAction>[0];

function makeParams(overrides: Partial<Params> = {}): Params {
  return {
    session: makeSession(),
    setSession: vi.fn(),
    setViewState: vi.fn(),
    setError: vi.fn(),
    setSuccessMessage: vi.fn(),
    setRecoveryMessage: vi.fn(),
    setShowResult: vi.fn(),
    setIsSavingProduct: vi.fn(),
    restartDoneRef: { current: false } as MutableRefObject<boolean>,
    productSavePromiseRef: { current: null } as MutableRefObject<Promise<RoomPreviewSession | null> | null>,
    isSavingProductRef: { current: false } as MutableRefObject<boolean>,
    sessionId: SESSION_ID,
    t,
    debugLog: vi.fn(),
    ...overrides,
  };
}

function emittedEvents() {
  return vi.mocked(trackClientSessionEvent).mock.calls.map(([, payload]) => payload);
}

function eventsOfType(eventType: string) {
  return emittedEvents().filter((e) => e.eventType === eventType);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useRenderAction", () => {

  describe("restart guard", () => {
    it("blocks render and emits render_retry_blocked_after_restart when restartDoneRef is true", async () => {
      const params = makeParams({
        restartDoneRef: { current: true } as MutableRefObject<boolean>,
      });

      const { result } = renderHook(() => useRenderAction(params));
      await act(async () => { await result.current.handleCreateRender(); });

      // Render API NOT called.
      expect(createRenderForSession).not.toHaveBeenCalled();
      expect(pollForRenderResult).not.toHaveBeenCalled();

      // Blocked event emitted with the override-or-session status.
      const blocked = eventsOfType("render_retry_blocked_after_restart");
      expect(blocked).toHaveLength(1);
      expect(blocked[0]).toMatchObject({
        source: "mobile",
        eventType: "render_retry_blocked_after_restart",
        level: "warning",
        metadata: { sessionStatus: "product_selected" },
      });
      // No setters fired beyond the diagnostic.
      expect(params.setIsSavingProduct).not.toHaveBeenCalled();
    });
  });

  describe("waiting for in-flight product save", () => {
    it("awaits productSavePromiseRef and uses the resolved session as activeSession", async () => {
      let resolveProduct!: (s: RoomPreviewSession) => void;
      const productPromise = new Promise<RoomPreviewSession>((res) => { resolveProduct = res; });
      const productSavePromiseRef = { current: productPromise } as MutableRefObject<Promise<RoomPreviewSession | null> | null>;

      const params = makeParams({
        session: makeSession({ status: "room_selected" }), // stale state in params
        productSavePromiseRef,
      });
      vi.mocked(createRenderForSession).mockResolvedValue(makeSession({ status: "rendering" }));
      vi.mocked(pollForRenderResult).mockResolvedValue(makeResultReadySession());

      const { result } = renderHook(() => useRenderAction(params));

      let renderPromise!: Promise<void>;
      await act(async () => {
        renderPromise = result.current.handleCreateRender();
        // Resolve the dangling product save with a fresher session.
        resolveProduct(makeSession({ status: "product_selected" }));
        await renderPromise;
      });

      // render_request_started's metadata reflects the resolved session, NOT the stale params.session.
      const started = eventsOfType("render_request_started")[0];
      expect(started.metadata).toMatchObject({
        currentStatus: "product_selected",
      });
    });

    it("does not await when productSavePromiseRef.current is null", async () => {
      const params = makeParams();
      vi.mocked(createRenderForSession).mockResolvedValue(makeSession({ status: "rendering" }));
      vi.mocked(pollForRenderResult).mockResolvedValue(makeResultReadySession());

      const { result } = renderHook(() => useRenderAction(params));
      await act(async () => { await result.current.handleCreateRender(); });

      expect(createRenderForSession).toHaveBeenCalledWith(SESSION_ID);
    });
  });

  describe("pre-flight guards", () => {
    it("returns silently when no session and no override is provided", async () => {
      const params = makeParams({ session: null });

      const { result } = renderHook(() => useRenderAction(params));
      await act(async () => { await result.current.handleCreateRender(); });

      expect(createRenderForSession).not.toHaveBeenCalled();
      expect(emittedEvents()).toHaveLength(0);
      expect(params.setError).not.toHaveBeenCalled();
    });

    it("sets the Arabic in-progress error string when status is ready_to_render", async () => {
      const params = makeParams({ session: makeSession({ status: "ready_to_render" }) });

      const { result } = renderHook(() => useRenderAction(params));
      await act(async () => { await result.current.handleCreateRender(); });

      expect(createRenderForSession).not.toHaveBeenCalled();
      expect(params.setError).toHaveBeenCalledWith("المعاينة لا تزال قيد الإنشاء، يرجى الانتظار قليلًا.");
    });

    it("sets the Arabic in-progress error string when status is rendering", async () => {
      const params = makeParams({ session: makeSession({ status: "rendering" }) });

      const { result } = renderHook(() => useRenderAction(params));
      await act(async () => { await result.current.handleCreateRender(); });

      expect(createRenderForSession).not.toHaveBeenCalled();
      expect(params.setError).toHaveBeenCalledWith("المعاينة لا تزال قيد الإنشاء، يرجى الانتظار قليلًا.");
    });

    it("returns silently with blockedBy=\"is_saving_product\" when isSavingProductRef is true", async () => {
      const params = makeParams({
        isSavingProductRef: { current: true } as MutableRefObject<boolean>,
      });

      const { result } = renderHook(() => useRenderAction(params));
      await act(async () => { await result.current.handleCreateRender(); });

      expect(createRenderForSession).not.toHaveBeenCalled();
      // No Arabic error string on this branch — only the "already_rendering" branch sets one.
      expect(params.setError).not.toHaveBeenCalled();
    });
  });

  describe("in-flight guard (renderRequestInFlightRef)", () => {
    it("a second concurrent call while the first is awaiting createRenderForSession returns immediately", async () => {
      const params = makeParams();
      const createDeferred = new Promise<RoomPreviewSession>(() => { /* never resolves */ });
      vi.mocked(createRenderForSession).mockReturnValueOnce(createDeferred);

      const { result } = renderHook(() => useRenderAction(params));

      // First call hangs at await createRenderForSession with the ref set to true.
      let firstP!: Promise<void>;
      await act(async () => {
        firstP = result.current.handleCreateRender();
        // Yield one microtask so the synchronous setup inside the first call runs.
        await Promise.resolve();
      });

      // Second call should hit the in-flight guard and resolve immediately.
      await act(async () => {
        await result.current.handleCreateRender();
      });

      expect(createRenderForSession).toHaveBeenCalledTimes(1);
      // mobile_tap_detected fires before the API call — first call emitted it once.
      // Second call's guard returns BEFORE that emission, so still only one event.
      expect(eventsOfType("mobile_tap_detected")).toHaveLength(1);

      // Don't await firstP — it's intentionally dangling.
      void firstP;
    });
  });

  describe("successful render", () => {
    it("calls createRenderForSession, emits mobile_tap_detected + render_request_started + render_request_accepted", async () => {
      const params = makeParams();
      const accepted = makeSession({ status: "rendering" });
      vi.mocked(createRenderForSession).mockResolvedValue(accepted);
      vi.mocked(pollForRenderResult).mockResolvedValue(makeResultReadySession());

      const { result } = renderHook(() => useRenderAction(params));
      await act(async () => { await result.current.handleCreateRender(); });

      expect(createRenderForSession).toHaveBeenCalledWith(SESSION_ID);

      expect(eventsOfType("mobile_tap_detected")[0]).toMatchObject({
        source: "mobile",
        eventType: "mobile_tap_detected",
        level: "info",
        metadata: { target: "render" },
      });
      expect(eventsOfType("render_request_started")[0]).toMatchObject({
        source: "mobile",
        eventType: "render_request_started",
        level: "info",
        metadata: expect.objectContaining({
          sessionId: SESSION_ID,
          currentStatus: "product_selected",
          hasRoomImage: true,
          hasProduct: true,
          productId: "p-1",
        }),
      });
      expect(eventsOfType("render_request_accepted")[0]).toMatchObject({
        source: "mobile",
        eventType: "render_request_accepted",
        level: "info",
        metadata: expect.objectContaining({
          statusAfter: "rendering",
        }),
      });
    });

    it("forwards poller onUpdate calls to setSession", async () => {
      const params = makeParams();
      const intermediate = makeSession({ status: "rendering" });
      const final = makeResultReadySession();
      vi.mocked(createRenderForSession).mockResolvedValue(intermediate);
      vi.mocked(pollForRenderResult).mockImplementation(async (_id, _interval, opts) => {
        // Simulate two poll updates before resolving.
        opts?.onUpdate?.(intermediate);
        opts?.onUpdate?.(intermediate);
        return final;
      });

      const { result } = renderHook(() => useRenderAction(params));
      await act(async () => { await result.current.handleCreateRender(); });

      // setSession called for: createRenderForSession result + 2 poll updates + final result.
      // We just verify the intermediate AND final are among the calls.
      const sessionCalls = vi.mocked(params.setSession).mock.calls.map(([s]) => s);
      expect(sessionCalls).toContain(intermediate);
      expect(sessionCalls).toContain(final);
    });

    it("on result_ready: setShowResult(true) and setSuccessMessage with t.product.saveSuccess", async () => {
      const params = makeParams();
      vi.mocked(createRenderForSession).mockResolvedValue(makeSession({ status: "rendering" }));
      vi.mocked(pollForRenderResult).mockResolvedValue(makeResultReadySession());

      const { result } = renderHook(() => useRenderAction(params));
      await act(async () => { await result.current.handleCreateRender(); });

      expect(params.setShowResult).toHaveBeenCalledWith(true);
      expect(params.setSuccessMessage).toHaveBeenCalledWith(SAVE_SUCCESS);
      // failure_recovery_ui_shown must NOT fire on success.
      expect(eventsOfType("failure_recovery_ui_shown")).toHaveLength(0);
    });
  });

  describe("render pipeline failed (non-result_ready terminal)", () => {
    it("sets retry_render recovery, Arabic error, and failure_recovery_ui_shown with reason=render_pipeline_failed", async () => {
      const params = makeParams();
      vi.mocked(createRenderForSession).mockResolvedValue(makeSession({ status: "rendering" }));
      vi.mocked(pollForRenderResult).mockResolvedValue(makeSession({ status: "failed" }));

      const { result } = renderHook(() => useRenderAction(params));
      await act(async () => { await result.current.handleCreateRender(); });

      const retry = getCustomerRecoveryMessage("retry_render");
      expect(params.setRecoveryMessage).toHaveBeenCalledWith(retry);
      expect(params.setError).toHaveBeenCalledWith("فشل إنشاء التصميم. يرجى المحاولة مرة أخرى.");

      const failureEvents = eventsOfType("failure_recovery_ui_shown");
      expect(failureEvents).toHaveLength(1);
      expect(failureEvents[0]).toMatchObject({
        level: "warning",
        metadata: { reason: "render_pipeline_failed", status: "failed" },
      });
      // setShowResult must NOT be called on this path.
      expect(params.setShowResult).not.toHaveBeenCalled();
    });
  });

  describe("render API errors", () => {
    it("expired error → setSession(null), setViewState(\"expired\"), setRecoveryMessage(null), early return", async () => {
      const params = makeParams();
      vi.mocked(createRenderForSession).mockRejectedValue(
        new RoomPreviewRequestError("expired", "Expired."),
      );

      const { result } = renderHook(() => useRenderAction(params));
      await act(async () => { await result.current.handleCreateRender(); });

      expect(params.setSession).toHaveBeenCalledWith(null);
      expect(params.setViewState).toHaveBeenCalledWith("expired");
      expect(params.setError).toHaveBeenCalledWith("Expired link");
      expect(params.setRecoveryMessage).toHaveBeenCalledWith(null);

      // render_request_failed fires (sync diagnostic before the cascade), but
      // the final render_timeout/render_failed event does NOT (early return).
      expect(eventsOfType("render_request_failed")).toHaveLength(1);
      expect(eventsOfType("render_failed")).toHaveLength(0);
      expect(eventsOfType("render_timeout")).toHaveLength(0);
      expect(eventsOfType("failure_recovery_ui_shown")).toHaveLength(0);
    });

    it("not_found error → setViewState(\"not_found\")", async () => {
      const params = makeParams();
      vi.mocked(createRenderForSession).mockRejectedValue(
        new RoomPreviewRequestError("not_found", "Not found."),
      );

      const { result } = renderHook(() => useRenderAction(params));
      await act(async () => { await result.current.handleCreateRender(); });

      expect(params.setSession).toHaveBeenCalledWith(null);
      expect(params.setViewState).toHaveBeenCalledWith("not_found");
      expect(params.setError).toHaveBeenCalledWith("Invalid link");
      expect(params.setRecoveryMessage).toHaveBeenCalledWith(null);
    });

    it("render_limit_reached error → specific Arabic + retry_render recovery + reason=render_limit_reached", async () => {
      const params = makeParams();
      vi.mocked(createRenderForSession).mockRejectedValue(
        new RoomPreviewRequestError("render_limit_reached", "Limit."),
      );

      const { result } = renderHook(() => useRenderAction(params));
      await act(async () => { await result.current.handleCreateRender(); });

      expect(params.setError).toHaveBeenCalledWith("فشل التصميم أكثر من مرة.");
      expect(params.setRecoveryMessage).toHaveBeenCalledWith(getCustomerRecoveryMessage("retry_render"));
      expect(eventsOfType("failure_recovery_ui_shown")[0]).toMatchObject({
        metadata: { reason: "render_limit_reached" },
      });
      // Final render_failed event with code RENDER_FAILED (it's not a timeout).
      expect(eventsOfType("render_failed")[0]).toMatchObject({
        level: "error",
        code: "RENDER_FAILED",
      });
    });

    it("render_device_cooldown error → cooldown Arabic + retry_render recovery + reason=render_device_cooldown", async () => {
      const params = makeParams();
      vi.mocked(createRenderForSession).mockRejectedValue(
        new RoomPreviewRequestError("render_device_cooldown", "Cooldown."),
      );

      const { result } = renderHook(() => useRenderAction(params));
      await act(async () => { await result.current.handleCreateRender(); });

      expect(params.setError).toHaveBeenCalledWith("يمكنك طلب معاينة جديدة بعد ٥ دقائق.");
      expect(params.setRecoveryMessage).toHaveBeenCalledWith(getCustomerRecoveryMessage("retry_render"));
      expect(eventsOfType("failure_recovery_ui_shown")[0]).toMatchObject({
        metadata: { reason: "render_device_cooldown" },
      });
    });

    it("screen_budget_exhausted error → budget Arabic + setRecoveryMessage(null) + reason=screen_budget_exhausted", async () => {
      const params = makeParams();
      vi.mocked(createRenderForSession).mockRejectedValue(
        new RoomPreviewRequestError("screen_budget_exhausted", "Budget."),
      );

      const { result } = renderHook(() => useRenderAction(params));
      await act(async () => { await result.current.handleCreateRender(); });

      expect(params.setError).toHaveBeenCalledWith("انتهى الحد اليومي لهذه الشاشة. يرجى التواصل مع الموظف المختص.");
      // No recovery on this branch.
      expect(params.setRecoveryMessage).toHaveBeenCalledWith(null);
      expect(eventsOfType("failure_recovery_ui_shown")[0]).toMatchObject({
        metadata: { reason: "screen_budget_exhausted" },
      });
    });

    it("timeout error → timeout-specific Arabic + retry_render recovery + final render_timeout event with code RENDER_TIMEOUT", async () => {
      const params = makeParams();
      vi.mocked(createRenderForSession).mockRejectedValue(
        new RoomPreviewRequestError("timeout", "Timed out."),
      );

      const { result } = renderHook(() => useRenderAction(params));
      await act(async () => { await result.current.handleCreateRender(); });

      expect(params.setError).toHaveBeenCalledWith("فشل إنشاء التصميم أو استغرق وقتًا طويلًا.");
      expect(params.setRecoveryMessage).toHaveBeenCalledWith(getCustomerRecoveryMessage("retry_render"));
      expect(eventsOfType("failure_recovery_ui_shown")[0]).toMatchObject({
        metadata: { reason: "render_timeout" },
      });
      expect(eventsOfType("render_timeout")[0]).toMatchObject({
        level: "error",
        code: "RENDER_TIMEOUT",
      });
      // render_failed must NOT fire on the timeout branch.
      expect(eventsOfType("render_failed")).toHaveLength(0);
    });

    it("generic non-typed Error → default Arabic + retry_render recovery + reason=render_failed + final render_failed event", async () => {
      const params = makeParams();
      vi.mocked(createRenderForSession).mockRejectedValue(new Error("boom"));

      const { result } = renderHook(() => useRenderAction(params));
      await act(async () => { await result.current.handleCreateRender(); });

      expect(params.setError).toHaveBeenCalledWith("فشل إنشاء التصميم. يرجى المحاولة مرة أخرى.");
      expect(params.setRecoveryMessage).toHaveBeenCalledWith(getCustomerRecoveryMessage("retry_render"));
      expect(eventsOfType("failure_recovery_ui_shown")[0]).toMatchObject({
        metadata: { reason: "render_failed" },
      });
      expect(eventsOfType("render_failed")[0]).toMatchObject({
        level: "error",
        code: "RENDER_FAILED",
        message: "boom",
      });
      // render_request_failed metadata for non-typed error.
      expect(eventsOfType("render_request_failed")[0]).toMatchObject({
        code: "UNKNOWN",
        metadata: expect.objectContaining({ status: null, errorMessage: "boom" }),
      });
    });
  });

  describe("setIsSavingProduct lifecycle", () => {
    it("calls setIsSavingProduct(true) before request and setIsSavingProduct(false) in finally on success", async () => {
      const params = makeParams();
      vi.mocked(createRenderForSession).mockResolvedValue(makeSession({ status: "rendering" }));
      vi.mocked(pollForRenderResult).mockResolvedValue(makeResultReadySession());

      const { result } = renderHook(() => useRenderAction(params));
      await act(async () => { await result.current.handleCreateRender(); });

      const calls = vi.mocked(params.setIsSavingProduct).mock.calls;
      expect(calls[0]).toEqual([true]);
      expect(calls[calls.length - 1]).toEqual([false]);
    });

    it("calls setIsSavingProduct(false) in finally even when the render throws", async () => {
      const params = makeParams();
      vi.mocked(createRenderForSession).mockRejectedValue(new Error("crash"));

      const { result } = renderHook(() => useRenderAction(params));
      await act(async () => { await result.current.handleCreateRender(); });

      const calls = vi.mocked(params.setIsSavingProduct).mock.calls;
      expect(calls[0]).toEqual([true]);
      expect(calls[calls.length - 1]).toEqual([false]);
    });
  });

  describe("sessionOverride", () => {
    it("uses the override session instead of params.session when provided", async () => {
      const params = makeParams({ session: null }); // params.session is null
      const override = makeSession({ id: "OVERRIDE-ID", status: "product_selected" });
      vi.mocked(createRenderForSession).mockResolvedValue(makeSession({ status: "rendering" }));
      vi.mocked(pollForRenderResult).mockResolvedValue(makeResultReadySession());

      const { result } = renderHook(() => useRenderAction(params));
      await act(async () => { await result.current.handleCreateRender(override); });

      // Render API was called with the override's id (not the null params.session).
      expect(createRenderForSession).toHaveBeenCalledWith("OVERRIDE-ID");
    });

    it("emits render_retry_blocked_after_restart with the override's status when restartDoneRef is true", async () => {
      const override = makeSession({ status: "result_ready" });
      const params = makeParams({
        session: makeSession({ status: "product_selected" }),
        restartDoneRef: { current: true } as MutableRefObject<boolean>,
      });

      const { result } = renderHook(() => useRenderAction(params));
      await act(async () => { await result.current.handleCreateRender(override); });

      // Override wins: sessionStatus in the metadata reflects "result_ready", not "product_selected".
      expect(eventsOfType("render_retry_blocked_after_restart")[0]).toMatchObject({
        metadata: { sessionStatus: "result_ready" },
      });
    });
  });
});
