// @vitest-environment happy-dom

/**
 * Unit tests for `useSessionExpiryTimer`.
 *
 * The hook is a single `useEffect` that schedules a wall-clock-based
 * `setTimeout` to force the UI into the `"expired"` state when the session
 * crosses its `expiresAt` boundary. Tests use fake timers to deterministically
 * verify the schedule + cleanup behavior.
 *
 * No production code was modified — the hook already accepts all its
 * dependencies as params.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { RoomPreviewSession } from "@/lib/room-preview/types";
import type { MobileSessionViewState } from "@/features/room-preview/mobile/mobile-session-utils";

const { useSessionExpiryTimer } = await import(
  "@/features/room-preview/mobile/useSessionExpiryTimer"
);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SESSION_ID = "test-session-expiry-timer";

function makeSession(overrides: Partial<RoomPreviewSession> = {}): RoomPreviewSession {
  return {
    id: SESSION_ID,
    status: "product_selected",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    expiresAt: null,
    mobileConnected: true,
    selectedRoom: null,
    selectedProduct: null,
    renderResult: null,
    ...overrides,
  };
}

function makeParams(opts: {
  session: RoomPreviewSession | null;
  viewState: MobileSessionViewState;
}) {
  return {
    session: opts.session,
    viewState: opts.viewState,
    setSession: vi.fn(),
    setError: vi.fn(),
    setViewState: vi.fn(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useSessionExpiryTimer", () => {

  describe("guard: viewState is not \"ready\"", () => {
    it.each(["loading", "not_found", "expired", "failed"] as const)(
      "does nothing when viewState is %s, even with a past expiresAt",
      (viewState) => {
        const session = makeSession({
          expiresAt: new Date(Date.now() - 60_000).toISOString(),
        });
        const params = makeParams({ session, viewState });

        renderHook(() => useSessionExpiryTimer(params));

        expect(params.setSession).not.toHaveBeenCalled();
        expect(params.setError).not.toHaveBeenCalled();
        expect(params.setViewState).not.toHaveBeenCalled();

        // Even after advancing time, nothing should fire — the effect short-circuited.
        vi.advanceTimersByTime(60_000);
        expect(params.setViewState).not.toHaveBeenCalled();
      },
    );
  });

  describe("guard: missing expiresAt", () => {
    it("does nothing when session is null", () => {
      const params = makeParams({ session: null, viewState: "ready" });

      renderHook(() => useSessionExpiryTimer(params));

      expect(params.setSession).not.toHaveBeenCalled();
      expect(params.setError).not.toHaveBeenCalled();
      expect(params.setViewState).not.toHaveBeenCalled();
    });

    it("does nothing when session.expiresAt is null", () => {
      const params = makeParams({
        session: makeSession({ expiresAt: null }),
        viewState: "ready",
      });

      renderHook(() => useSessionExpiryTimer(params));

      expect(params.setSession).not.toHaveBeenCalled();
      expect(params.setError).not.toHaveBeenCalled();
      expect(params.setViewState).not.toHaveBeenCalled();

      vi.advanceTimersByTime(10 * 60_000);
      expect(params.setViewState).not.toHaveBeenCalled();
    });
  });

  describe("immediate expiration (expiresAt already in the past)", () => {
    it("synchronously transitions to expired when expiresAt is in the past", () => {
      const session = makeSession({
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
      });
      const params = makeParams({ session, viewState: "ready" });

      renderHook(() => useSessionExpiryTimer(params));

      expect(params.setSession).toHaveBeenCalledWith(null);
      expect(params.setError).toHaveBeenCalledWith(null);
      expect(params.setViewState).toHaveBeenCalledWith("expired");

      // Each setter called exactly once, no scheduled-timer duplicate after advancing.
      expect(params.setSession).toHaveBeenCalledTimes(1);
      expect(params.setError).toHaveBeenCalledTimes(1);
      expect(params.setViewState).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(10 * 60_000);
      expect(params.setViewState).toHaveBeenCalledTimes(1);
    });

    it("treats expiresAt at exactly now (msUntilExpiry === 0) as already expired", () => {
      const session = makeSession({ expiresAt: new Date(Date.now()).toISOString() });
      const params = makeParams({ session, viewState: "ready" });

      renderHook(() => useSessionExpiryTimer(params));

      expect(params.setViewState).toHaveBeenCalledWith("expired");
      expect(params.setSession).toHaveBeenCalledWith(null);
      expect(params.setError).toHaveBeenCalledWith(null);
    });
  });

  describe("scheduled expiration (expiresAt in the future)", () => {
    it("does not fire setters before the timeout elapses", () => {
      const session = makeSession({
        expiresAt: new Date(Date.now() + 5_000).toISOString(),
      });
      const params = makeParams({ session, viewState: "ready" });

      renderHook(() => useSessionExpiryTimer(params));

      // Before any time advance — nothing has fired.
      expect(params.setSession).not.toHaveBeenCalled();
      expect(params.setError).not.toHaveBeenCalled();
      expect(params.setViewState).not.toHaveBeenCalled();

      // Advance partway — still nothing.
      vi.advanceTimersByTime(4_999);
      expect(params.setViewState).not.toHaveBeenCalled();
    });

    it("fires all three setters after msUntilExpiry elapses", () => {
      const session = makeSession({
        expiresAt: new Date(Date.now() + 5_000).toISOString(),
      });
      const params = makeParams({ session, viewState: "ready" });

      renderHook(() => useSessionExpiryTimer(params));

      vi.advanceTimersByTime(5_000);

      expect(params.setSession).toHaveBeenCalledWith(null);
      expect(params.setError).toHaveBeenCalledWith(null);
      expect(params.setViewState).toHaveBeenCalledWith("expired");

      // Each setter called exactly once.
      expect(params.setSession).toHaveBeenCalledTimes(1);
      expect(params.setError).toHaveBeenCalledTimes(1);
      expect(params.setViewState).toHaveBeenCalledTimes(1);
    });

    it("respects the exact wall-clock interval (no early fire)", () => {
      const session = makeSession({
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      const params = makeParams({ session, viewState: "ready" });

      renderHook(() => useSessionExpiryTimer(params));

      // 1 ms before expiry — nothing.
      vi.advanceTimersByTime(59_999);
      expect(params.setViewState).not.toHaveBeenCalled();

      // The final ms — fires now.
      vi.advanceTimersByTime(1);
      expect(params.setViewState).toHaveBeenCalledWith("expired");
    });
  });

  describe("cleanup: clearTimeout on unmount", () => {
    it("does not fire setters after the hook is unmounted before expiry", () => {
      const session = makeSession({
        expiresAt: new Date(Date.now() + 10_000).toISOString(),
      });
      const params = makeParams({ session, viewState: "ready" });

      const { unmount } = renderHook(() => useSessionExpiryTimer(params));

      // Unmount before the timer fires.
      unmount();

      // Advance past the original expiry — the cleared timer must not fire.
      vi.advanceTimersByTime(10_000);

      expect(params.setSession).not.toHaveBeenCalled();
      expect(params.setError).not.toHaveBeenCalled();
      expect(params.setViewState).not.toHaveBeenCalled();
    });
  });

  describe("cleanup: dependency change clears prior timer", () => {
    it("cancels the old timer when expiresAt changes to a later value", () => {
      const session1 = makeSession({
        expiresAt: new Date(Date.now() + 5_000).toISOString(),
      });
      const session2 = makeSession({
        expiresAt: new Date(Date.now() + 20_000).toISOString(),
      });
      const setSession = vi.fn();
      const setError = vi.fn();
      const setViewState = vi.fn();

      const { rerender } = renderHook(
        ({ s }: { s: RoomPreviewSession }) =>
          useSessionExpiryTimer({
            session: s,
            viewState: "ready",
            setSession,
            setError,
            setViewState,
          }),
        { initialProps: { s: session1 } },
      );

      // Re-render with a session whose expiry is later.
      rerender({ s: session2 });

      // Advance past the original 5s deadline — the cleared old timer must NOT fire.
      vi.advanceTimersByTime(5_000);
      expect(setViewState).not.toHaveBeenCalled();

      // Advance to the new 20s deadline (15s more from the 5s point) — fires once.
      vi.advanceTimersByTime(15_000);
      expect(setViewState).toHaveBeenCalledWith("expired");
      expect(setViewState).toHaveBeenCalledTimes(1);
    });

    it("cancels the timer when viewState leaves \"ready\"", () => {
      const session = makeSession({
        expiresAt: new Date(Date.now() + 5_000).toISOString(),
      });
      const setSession = vi.fn();
      const setError = vi.fn();
      const setViewState = vi.fn();

      const { rerender } = renderHook(
        ({ vs }: { vs: MobileSessionViewState }) =>
          useSessionExpiryTimer({
            session,
            viewState: vs,
            setSession,
            setError,
            setViewState,
          }),
        { initialProps: { vs: "ready" as MobileSessionViewState } },
      );

      // Transition viewState away from "ready" — cleanup must fire.
      rerender({ vs: "failed" });

      vi.advanceTimersByTime(5_000);
      expect(setViewState).not.toHaveBeenCalled();
      expect(setSession).not.toHaveBeenCalled();
      expect(setError).not.toHaveBeenCalled();
    });
  });

  describe("no orphan timers", () => {
    it("does not leave a queued timer after multiple re-renders followed by unmount", () => {
      const setSession = vi.fn();
      const setError = vi.fn();
      const setViewState = vi.fn();

      const { rerender, unmount } = renderHook(
        ({ s }: { s: RoomPreviewSession }) =>
          useSessionExpiryTimer({
            session: s,
            viewState: "ready",
            setSession,
            setError,
            setViewState,
          }),
        {
          initialProps: {
            s: makeSession({ expiresAt: new Date(Date.now() + 3_000).toISOString() }),
          },
        },
      );

      // Three re-renders with progressively-later expiries.
      rerender({ s: makeSession({ expiresAt: new Date(Date.now() + 6_000).toISOString() }) });
      rerender({ s: makeSession({ expiresAt: new Date(Date.now() + 9_000).toISOString() }) });
      rerender({ s: makeSession({ expiresAt: new Date(Date.now() + 12_000).toISOString() }) });

      unmount();

      // Advance well past every queued deadline.
      vi.advanceTimersByTime(60_000);

      // Not a single setter should have fired — all cleanups ran.
      expect(setViewState).not.toHaveBeenCalled();
      expect(setSession).not.toHaveBeenCalled();
      expect(setError).not.toHaveBeenCalled();
    });
  });
});
