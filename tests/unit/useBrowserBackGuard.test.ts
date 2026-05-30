// @vitest-environment happy-dom

/**
 * Unit tests for `useBrowserBackGuard`.
 *
 * The hook installs a `popstate` listener that:
 *   1. Re-pushes a duplicate history entry (keeps the guard alive)
 *   2. Synchronously emits a `back_pressed` event with `currentPath` /
 *      `currentStatus` / `timestamp` metadata
 *   3. Asynchronously re-fetches the authoritative session, updates view
 *      state, and emits `redirected_to_correct_step`
 *   4. Shows the Arabic success toast for 4 s
 *
 * Tests dispatch a real `PopStateEvent`, drain microtasks for the async IIFE,
 * and use fake timers to control the 4-second toast clear.
 *
 * No production code was modified.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { RoomPreviewSession } from "@/lib/room-preview/types";
import type { TranslationDictionary } from "@/lib/i18n/dictionaries";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/room-preview/session-client", async (importOriginal) => {
  // Keep the real RoomPreviewRequestError class + isRoomPreviewRequestError
  // guard so the hook's catch-block code path runs against real instances.
  const actual = await importOriginal<typeof import("@/lib/room-preview/session-client")>();
  return {
    ...actual,
    fetchRoomPreviewSession: vi.fn(),
  };
});

vi.mock("@/lib/room-preview/session-diagnostics-client", () => ({
  trackClientSessionEvent: vi.fn(),
}));

const { useBrowserBackGuard } = await import(
  "@/features/room-preview/mobile/useBrowserBackGuard"
);
const {
  fetchRoomPreviewSession,
  RoomPreviewRequestError,
} = await import("@/lib/room-preview/session-client");
const { trackClientSessionEvent } = await import(
  "@/lib/room-preview/session-diagnostics-client"
);
const { getCustomerRecoveryMessage } = await import(
  "@/lib/room-preview/customer-recovery"
);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SESSION_ID = "test-session-back-guard";
const BACK_TOAST = "أعدناك إلى الخطوة الصحيحة للحفاظ على تجربتك";

const t = {
  roomPreview: {
    mobile: {
      loadFailed: "Failed to load session",
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
    selectedRoom: null,
    selectedProduct: null,
    renderResult: null,
    ...overrides,
  };
}

function makeParams(opts: { session?: RoomPreviewSession | null } = {}) {
  return {
    session: opts.session ?? null,
    setSession: vi.fn(),
    setViewState: vi.fn(),
    setError: vi.fn(),
    setSuccessMessage: vi.fn(),
    setRecoveryMessage: vi.fn(),
    setShowResult: vi.fn(),
    sessionId: SESSION_ID,
    t,
  };
}

function emittedEvents() {
  return vi.mocked(trackClientSessionEvent).mock.calls.map(([, payload]) => payload);
}

function eventsOfType(eventType: string) {
  return emittedEvents().filter((e) => e.eventType === eventType);
}

/** Drains pending microtasks so awaited fetch promises and chained .then's run. */
async function flushMicrotasks() {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

let addEventListenerSpy: ReturnType<typeof vi.spyOn>;
let removeEventListenerSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: false });
  addEventListenerSpy = vi.spyOn(window, "addEventListener");
  removeEventListenerSpy = vi.spyOn(window, "removeEventListener");
});

afterEach(() => {
  addEventListenerSpy.mockRestore();
  removeEventListenerSpy.mockRestore();
  vi.useRealTimers();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useBrowserBackGuard", () => {

  describe("listener registration", () => {
    it("registers a popstate listener on mount", () => {
      renderHook(() => useBrowserBackGuard(makeParams()));

      const popstateCalls = (addEventListenerSpy.mock.calls as unknown[][]).filter(
        ([type]) => type === "popstate",
      );
      expect(popstateCalls).toHaveLength(1);
    });

    it("unregisters the same popstate listener on unmount", () => {
      const { unmount } = renderHook(() => useBrowserBackGuard(makeParams()));

      const registered = (addEventListenerSpy.mock.calls as unknown[][]).find(
        ([type]) => type === "popstate",
      );
      expect(registered).toBeTruthy();

      unmount();

      const removed = (removeEventListenerSpy.mock.calls as unknown[][]).find(
        ([type]) => type === "popstate",
      );
      expect(removed).toBeTruthy();
      // Same handler reference.
      expect(removed?.[1]).toBe(registered?.[1]);
    });

    it("no longer reacts to popstate after unmount", async () => {
      const params = makeParams({ session: makeSession({ status: "product_selected" }) });
      vi.mocked(fetchRoomPreviewSession).mockResolvedValue(makeSession());

      const { unmount } = renderHook(() => useBrowserBackGuard(params));
      unmount();

      window.dispatchEvent(new PopStateEvent("popstate"));
      await flushMicrotasks();

      expect(eventsOfType("back_pressed")).toHaveLength(0);
      expect(fetchRoomPreviewSession).not.toHaveBeenCalled();
      expect(params.setSession).not.toHaveBeenCalled();
    });
  });

  describe("back_pressed event", () => {
    it("emits synchronously when popstate fires, with currentStatus from sessionRef", async () => {
      const params = makeParams({ session: makeSession({ status: "ready_to_render" }) });
      vi.mocked(fetchRoomPreviewSession).mockResolvedValue(makeSession({ status: "ready_to_render" }));

      renderHook(() => useBrowserBackGuard(params));

      window.dispatchEvent(new PopStateEvent("popstate"));

      // back_pressed fires synchronously, before any microtasks drain.
      const events = eventsOfType("back_pressed");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        source: "mobile",
        eventType: "back_pressed",
        level: "info",
        metadata: {
          currentStatus: "ready_to_render",
        },
      });
      const meta = events[0].metadata as { currentPath: unknown; timestamp: unknown };
      expect(typeof meta.currentPath).toBe("string");
      expect(typeof meta.timestamp).toBe("string");

      // Drain so the dangling fetch promise resolves before the next test.
      await flushMicrotasks();
    });

    it("reads currentStatus = null when no session is present", async () => {
      const params = makeParams({ session: null });
      vi.mocked(fetchRoomPreviewSession).mockResolvedValue(makeSession());

      renderHook(() => useBrowserBackGuard(params));

      window.dispatchEvent(new PopStateEvent("popstate"));

      const events = eventsOfType("back_pressed");
      expect(events).toHaveLength(1);
      expect((events[0].metadata as { currentStatus: unknown }).currentStatus).toBeNull();

      await flushMicrotasks();
    });
  });

  describe("session re-fetch + view-state update", () => {
    it("calls fetchRoomPreviewSession(sessionId) on back press", async () => {
      vi.mocked(fetchRoomPreviewSession).mockResolvedValue(makeSession({ status: "product_selected" }));
      const params = makeParams();

      renderHook(() => useBrowserBackGuard(params));

      window.dispatchEvent(new PopStateEvent("popstate"));
      await flushMicrotasks();

      expect(fetchRoomPreviewSession).toHaveBeenCalledWith(SESSION_ID);
    });

    it("for a live session: sets the fetched session and viewState to ready", async () => {
      const fresh = makeSession({ status: "product_selected" });
      vi.mocked(fetchRoomPreviewSession).mockResolvedValue(fresh);
      const params = makeParams();

      renderHook(() => useBrowserBackGuard(params));

      window.dispatchEvent(new PopStateEvent("popstate"));
      await flushMicrotasks();

      expect(params.setSession).toHaveBeenCalledWith(fresh);
      expect(params.setViewState).toHaveBeenCalledWith("ready");
      expect(params.setShowResult).not.toHaveBeenCalled();
    });

    it("emits redirected_to_correct_step with reason: \"browser_back_recovery\"", async () => {
      vi.mocked(fetchRoomPreviewSession).mockResolvedValue(makeSession({ status: "mobile_connected" }));
      const params = makeParams();

      renderHook(() => useBrowserBackGuard(params));

      window.dispatchEvent(new PopStateEvent("popstate"));
      await flushMicrotasks();

      const events = eventsOfType("redirected_to_correct_step");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        source: "mobile",
        eventType: "redirected_to_correct_step",
        level: "info",
        metadata: {
          status: "mobile_connected",
          reason: "browser_back_recovery",
        },
      });
    });

    it("for expired/completed: viewState becomes expired and error is cleared", async () => {
      for (const status of ["expired", "completed"] as const) {
        vi.clearAllMocks();
        vi.mocked(fetchRoomPreviewSession).mockResolvedValue(makeSession({ status }));
        const params = makeParams();

        const { unmount } = renderHook(() => useBrowserBackGuard(params));

        window.dispatchEvent(new PopStateEvent("popstate"));
        await flushMicrotasks();

        expect(params.setViewState).toHaveBeenCalledWith("expired");
        expect(params.setError).toHaveBeenCalledWith(null);

        unmount();
      }
    });
  });

  describe("result_ready branch sets showResult", () => {
    it("calls setShowResult(true) when fresh.status is result_ready and renderResult.imageUrl exists", async () => {
      vi.mocked(fetchRoomPreviewSession).mockResolvedValue(
        makeSession({
          status: "result_ready",
          renderResult: {
            imageUrl: "https://cdn/result.png",
            kind: "composited_preview",
            jobId: "j",
            generatedAt: new Date().toISOString(),
            modelName: "gemini",
          },
        }),
      );
      const params = makeParams();

      renderHook(() => useBrowserBackGuard(params));

      window.dispatchEvent(new PopStateEvent("popstate"));
      await flushMicrotasks();

      expect(params.setViewState).toHaveBeenCalledWith("ready");
      expect(params.setShowResult).toHaveBeenCalledWith(true);
    });

    it("does NOT call setShowResult when status is result_ready but renderResult.imageUrl is missing", async () => {
      vi.mocked(fetchRoomPreviewSession).mockResolvedValue(
        makeSession({ status: "result_ready", renderResult: null }),
      );
      const params = makeParams();

      renderHook(() => useBrowserBackGuard(params));

      window.dispatchEvent(new PopStateEvent("popstate"));
      await flushMicrotasks();

      expect(params.setViewState).toHaveBeenCalledWith("ready");
      expect(params.setShowResult).not.toHaveBeenCalled();
    });
  });

  describe("failed status: retry_render recovery", () => {
    it("sets viewState=ready, recoveryMessage=retry_render, error=recovery.text", async () => {
      vi.mocked(fetchRoomPreviewSession).mockResolvedValue(makeSession({ status: "failed" }));
      const params = makeParams();

      renderHook(() => useBrowserBackGuard(params));

      window.dispatchEvent(new PopStateEvent("popstate"));
      await flushMicrotasks();

      expect(params.setViewState).toHaveBeenCalledWith("ready");

      const expectedRecovery = getCustomerRecoveryMessage("retry_render");
      expect(params.setRecoveryMessage).toHaveBeenCalledWith(expectedRecovery);
      // Error string is the recovery text (or t.loadFailed if recovery is null).
      expect(params.setError).toHaveBeenCalledWith(expectedRecovery?.text ?? "Failed to load session");
    });
  });

  describe("fetch errors", () => {
    it("expired RoomPreviewRequestError → setViewState(\"expired\")", async () => {
      vi.mocked(fetchRoomPreviewSession).mockRejectedValue(
        new RoomPreviewRequestError("expired", "Session has expired."),
      );
      const params = makeParams({ session: makeSession({ status: "product_selected" }) });

      renderHook(() => useBrowserBackGuard(params));

      window.dispatchEvent(new PopStateEvent("popstate"));
      await flushMicrotasks();

      expect(params.setViewState).toHaveBeenCalledWith("expired");
      // Should NOT have called setSession or shown the success toast.
      expect(params.setSession).not.toHaveBeenCalled();
      expect(params.setSuccessMessage).not.toHaveBeenCalled();
    });

    it("not_found RoomPreviewRequestError → setViewState(\"not_found\")", async () => {
      vi.mocked(fetchRoomPreviewSession).mockRejectedValue(
        new RoomPreviewRequestError("not_found", "Session not found."),
      );
      const params = makeParams({ session: makeSession({ status: "product_selected" }) });

      renderHook(() => useBrowserBackGuard(params));

      window.dispatchEvent(new PopStateEvent("popstate"));
      await flushMicrotasks();

      expect(params.setViewState).toHaveBeenCalledWith("not_found");
      expect(params.setSession).not.toHaveBeenCalled();
      expect(params.setSuccessMessage).not.toHaveBeenCalled();
    });

    it("generic non-typed error: silently no-ops (back guard must never crash UI)", async () => {
      vi.mocked(fetchRoomPreviewSession).mockRejectedValue(new Error("network down"));
      const params = makeParams({ session: makeSession({ status: "product_selected" }) });

      renderHook(() => useBrowserBackGuard(params));

      window.dispatchEvent(new PopStateEvent("popstate"));
      await flushMicrotasks();

      // back_pressed still fired synchronously, but no recovery state.
      expect(eventsOfType("back_pressed")).toHaveLength(1);
      expect(params.setSession).not.toHaveBeenCalled();
      expect(params.setViewState).not.toHaveBeenCalled();
      expect(params.setError).not.toHaveBeenCalled();
      expect(params.setSuccessMessage).not.toHaveBeenCalled();
      expect(params.setShowResult).not.toHaveBeenCalled();
      expect(eventsOfType("redirected_to_correct_step")).toHaveLength(0);
    });
  });

  describe("Arabic success toast", () => {
    it("calls setSuccessMessage with the exact Arabic string after a successful fetch", async () => {
      vi.mocked(fetchRoomPreviewSession).mockResolvedValue(makeSession({ status: "product_selected" }));
      const params = makeParams();

      renderHook(() => useBrowserBackGuard(params));

      window.dispatchEvent(new PopStateEvent("popstate"));
      await flushMicrotasks();

      expect(params.setSuccessMessage).toHaveBeenCalledWith(BACK_TOAST);
    });

    it("schedules an auto-clear after 4 seconds using an identity-checking updater", async () => {
      vi.mocked(fetchRoomPreviewSession).mockResolvedValue(makeSession({ status: "product_selected" }));
      const params = makeParams();

      renderHook(() => useBrowserBackGuard(params));

      window.dispatchEvent(new PopStateEvent("popstate"));
      await flushMicrotasks();

      // After microtask drain, the toast has been set but the 4 s timer hasn't fired.
      expect(params.setSuccessMessage).toHaveBeenCalledTimes(1);
      expect(params.setSuccessMessage).toHaveBeenLastCalledWith(BACK_TOAST);

      // Advance just under 4 s — still no clear.
      vi.advanceTimersByTime(3_999);
      expect(params.setSuccessMessage).toHaveBeenCalledTimes(1);

      // Advance the final ms — the auto-clear fires.
      vi.advanceTimersByTime(1);
      expect(params.setSuccessMessage).toHaveBeenCalledTimes(2);

      // The second call is an updater function. Verify the identity check:
      //   prev === BACK_TOAST → null
      //   prev === "something else" → unchanged
      const updater = params.setSuccessMessage.mock.calls[1][0] as (prev: string | null) => string | null;
      expect(updater(BACK_TOAST)).toBeNull();
      expect(updater("user typed a different message")).toBe("user typed a different message");
      expect(updater(null)).toBeNull();
    });

    it("does NOT show the toast on the expired/not_found error paths", async () => {
      vi.mocked(fetchRoomPreviewSession).mockRejectedValue(
        new RoomPreviewRequestError("expired", "Expired."),
      );
      const params = makeParams();

      renderHook(() => useBrowserBackGuard(params));

      window.dispatchEvent(new PopStateEvent("popstate"));
      await flushMicrotasks();
      vi.advanceTimersByTime(10_000);

      expect(params.setSuccessMessage).not.toHaveBeenCalled();
    });
  });
});
