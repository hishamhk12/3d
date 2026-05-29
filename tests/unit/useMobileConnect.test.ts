// @vitest-environment happy-dom

/**
 * Unit tests for `useMobileConnect`.
 *
 * Each test renders the hook with a controlled set of parent setters and
 * exercises `handleConnect`, then asserts the state mutations + diagnostic
 * events emitted.
 *
 * No production code was modified — the hook already accepts all its
 * dependencies as params, which is the only "test seam" needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { RoomPreviewSession } from "@/lib/room-preview/types";
import type { TranslationDictionary } from "@/lib/i18n/dictionaries";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/room-preview/session-client", async (importOriginal) => {
  // Keep the real RoomPreviewRequestError class and isRoomPreviewRequestError
  // type guard so the hook's error classification runs against real instances.
  const actual = await importOriginal<typeof import("@/lib/room-preview/session-client")>();
  return {
    ...actual,
    connectRoomPreviewSession: vi.fn(),
  };
});

vi.mock("@/lib/room-preview/session-diagnostics-client", () => ({
  trackClientSessionEvent: vi.fn(),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

const { useMobileConnect } = await import(
  "@/features/room-preview/mobile/useMobileConnect"
);
const {
  connectRoomPreviewSession,
  RoomPreviewRequestError,
} = await import("@/lib/room-preview/session-client");
const { trackClientSessionEvent } = await import(
  "@/lib/room-preview/session-diagnostics-client"
);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SESSION_ID = "test-session-mobile-connect";

/** Minimal stub of the translation dictionary subset the hook reads. */
const t = {
  roomPreview: {
    mobile: {
      connectedSuccess: "Connected successfully",
      connectFailed: "Could not connect to the session",
      invalidLink: "Invalid link",
      expiredLink: "Expired link",
      loadFailed: "Failed to load session",
    },
  },
} as unknown as TranslationDictionary;

function makeSession(overrides: Partial<RoomPreviewSession> = {}): RoomPreviewSession {
  return {
    id: SESSION_ID,
    status: "waiting_for_mobile",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    mobileConnected: false,
    selectedRoom: null,
    selectedProduct: null,
    renderResult: null,
    ...overrides,
  };
}

/** Builds the params object passed to `useMobileConnect`, with vi.fn() setters. */
function makeParams(session: RoomPreviewSession | null) {
  return {
    session,
    setSession: vi.fn(),
    setViewState: vi.fn(),
    setError: vi.fn(),
    setSuccessMessage: vi.fn(),
    setRoomSaveStatus: vi.fn(),
    setProductSaveStatus: vi.fn(),
    setRoomSaveStatusLabel: vi.fn(),
    sessionId: SESSION_ID,
    t,
    debugLog: vi.fn(),
  };
}

/** Captures all `trackClientSessionEvent` calls and returns just the event payloads. */
function emittedEvents() {
  return vi.mocked(trackClientSessionEvent).mock.calls.map(([, payload]) => payload);
}

function eventsOfType(eventType: string) {
  return emittedEvents().filter((e) => e.eventType === eventType);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Silence console.info / console.error noise from the connect-started /
  // connect-success / connect-failed log lines.
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useMobileConnect", () => {

  describe("successful connect", () => {
    it("transitions session to mobile_connected and emits success diagnostics", async () => {
      const session = makeSession({ status: "waiting_for_mobile", mobileConnected: false });
      const params = makeParams(session);
      const connectedSession = makeSession({ status: "mobile_connected", mobileConnected: true });
      vi.mocked(connectRoomPreviewSession).mockResolvedValue(connectedSession);

      const { result } = renderHook(() => useMobileConnect(params));

      await act(async () => {
        await result.current.handleConnect();
      });

      expect(connectRoomPreviewSession).toHaveBeenCalledWith(SESSION_ID);

      // Pre-connect UI reset
      expect(params.setError).toHaveBeenCalledWith(null);
      expect(params.setSuccessMessage).toHaveBeenCalledWith(null);
      expect(params.setRoomSaveStatus).toHaveBeenCalledWith("idle");
      expect(params.setProductSaveStatus).toHaveBeenCalledWith("idle");
      expect(params.setRoomSaveStatusLabel).toHaveBeenCalledWith(null);

      // Session update — derives status from the optimistic local session
      expect(params.setSession).toHaveBeenCalledWith(
        expect.objectContaining({ mobileConnected: true, status: "mobile_connected" }),
      );

      // Success message
      expect(params.setSuccessMessage).toHaveBeenCalledWith("Connected successfully");

      // isConnecting flips back to false after the await chain settles
      expect(result.current.isConnecting).toBe(false);
    });

    it("derives status as product_selected when both room and product exist", async () => {
      const session = makeSession({
        status: "waiting_for_mobile",
        mobileConnected: false,
        selectedRoom: { source: "camera", imageUrl: "/r.jpg" },
        selectedProduct: { id: "p1", barcode: null, name: "Oak", productType: "floor_material", imageUrl: "/p.jpg" },
      });
      const params = makeParams(session);
      vi.mocked(connectRoomPreviewSession).mockResolvedValue(makeSession({ mobileConnected: true }));

      const { result } = renderHook(() => useMobileConnect(params));
      await act(async () => { await result.current.handleConnect(); });

      expect(params.setSession).toHaveBeenCalledWith(
        expect.objectContaining({ status: "product_selected", mobileConnected: true }),
      );
    });

    it("derives status as room_selected when only room exists", async () => {
      const session = makeSession({
        status: "waiting_for_mobile",
        mobileConnected: false,
        selectedRoom: { source: "camera", imageUrl: "/r.jpg" },
      });
      const params = makeParams(session);
      vi.mocked(connectRoomPreviewSession).mockResolvedValue(makeSession({ mobileConnected: true }));

      const { result } = renderHook(() => useMobileConnect(params));
      await act(async () => { await result.current.handleConnect(); });

      expect(params.setSession).toHaveBeenCalledWith(
        expect.objectContaining({ status: "room_selected", mobileConnected: true }),
      );
    });

    it("emits mobile_tap_detected, mobile_connect_started, and mobile_connect_success events", async () => {
      const session = makeSession({ status: "waiting_for_mobile", mobileConnected: false });
      const params = makeParams(session);
      vi.mocked(connectRoomPreviewSession).mockResolvedValue(makeSession({ mobileConnected: true, status: "mobile_connected" }));

      const { result } = renderHook(() => useMobileConnect(params));
      await act(async () => { await result.current.handleConnect(); });

      expect(eventsOfType("mobile_tap_detected")[0]).toMatchObject({
        source: "mobile",
        eventType: "mobile_tap_detected",
        level: "info",
        metadata: { target: "connect" },
      });
      expect(eventsOfType("mobile_connect_started")[0]).toMatchObject({
        source: "mobile",
        eventType: "mobile_connect_started",
        level: "info",
        statusBefore: "waiting_for_mobile",
        metadata: { mode: "manual" },
      });
      expect(eventsOfType("mobile_connect_success")[0]).toMatchObject({
        source: "mobile",
        eventType: "mobile_connect_success",
        level: "info",
        statusAfter: "mobile_connected",
        metadata: { mode: "manual" },
      });
      // Failure event must NOT fire on success
      expect(eventsOfType("mobile_connect_failed")).toHaveLength(0);
    });
  });

  describe("connect failure (generic error)", () => {
    it("sets error message via the fallback path and does not transition viewState", async () => {
      const session = makeSession({ status: "waiting_for_mobile", mobileConnected: false });
      const params = makeParams(session);
      vi.mocked(connectRoomPreviewSession).mockRejectedValue(new Error("network down"));

      const { result } = renderHook(() => useMobileConnect(params));
      await act(async () => { await result.current.handleConnect(); });

      // Error.message wins over the connectFailed fallback because the error is a plain Error
      expect(params.setError).toHaveBeenLastCalledWith("network down");
      expect(params.setViewState).not.toHaveBeenCalled();
      expect(params.setSession).not.toHaveBeenCalled();
    });

    it("emits mobile_connect_failed with the error message and null code", async () => {
      const session = makeSession({ status: "waiting_for_mobile", mobileConnected: false });
      const params = makeParams(session);
      vi.mocked(connectRoomPreviewSession).mockRejectedValue(new Error("boom"));

      const { result } = renderHook(() => useMobileConnect(params));
      await act(async () => { await result.current.handleConnect(); });

      const failedEvents = eventsOfType("mobile_connect_failed");
      expect(failedEvents).toHaveLength(1);
      expect(failedEvents[0]).toMatchObject({
        source: "mobile",
        eventType: "mobile_connect_failed",
        level: "error",
        code: null,
        message: "boom",
        statusBefore: "waiting_for_mobile",
        metadata: { mode: "manual" },
      });
      // Success event must NOT fire on failure
      expect(eventsOfType("mobile_connect_success")).toHaveLength(0);
    });

    it("isConnecting returns to false after a failed connect", async () => {
      const session = makeSession({ mobileConnected: false });
      const params = makeParams(session);
      vi.mocked(connectRoomPreviewSession).mockRejectedValue(new Error("nope"));

      const { result } = renderHook(() => useMobileConnect(params));
      await act(async () => { await result.current.handleConnect(); });

      expect(result.current.isConnecting).toBe(false);
    });
  });

  describe("session expired error", () => {
    it("transitions viewState to expired and clears the session", async () => {
      const session = makeSession({ status: "waiting_for_mobile", mobileConnected: false });
      const params = makeParams(session);
      vi.mocked(connectRoomPreviewSession).mockRejectedValue(
        new RoomPreviewRequestError("expired", "Session has expired."),
      );

      const { result } = renderHook(() => useMobileConnect(params));
      await act(async () => { await result.current.handleConnect(); });

      expect(params.setSession).toHaveBeenCalledWith(null);
      expect(params.setViewState).toHaveBeenCalledWith("expired");
      expect(params.setError).toHaveBeenCalledWith("Expired link");
    });

    it("emits mobile_connect_failed with code: \"expired\"", async () => {
      const session = makeSession({ status: "waiting_for_mobile", mobileConnected: false });
      const params = makeParams(session);
      vi.mocked(connectRoomPreviewSession).mockRejectedValue(
        new RoomPreviewRequestError("expired", "Session has expired."),
      );

      const { result } = renderHook(() => useMobileConnect(params));
      await act(async () => { await result.current.handleConnect(); });

      const failed = eventsOfType("mobile_connect_failed")[0];
      expect(failed).toMatchObject({
        code: "expired",
        message: "Session has expired.",
        level: "error",
      });
    });
  });

  describe("session not_found error", () => {
    it("transitions viewState to not_found and clears the session", async () => {
      const session = makeSession({ status: "waiting_for_mobile", mobileConnected: false });
      const params = makeParams(session);
      vi.mocked(connectRoomPreviewSession).mockRejectedValue(
        new RoomPreviewRequestError("not_found", "Session not found."),
      );

      const { result } = renderHook(() => useMobileConnect(params));
      await act(async () => { await result.current.handleConnect(); });

      expect(params.setSession).toHaveBeenCalledWith(null);
      expect(params.setViewState).toHaveBeenCalledWith("not_found");
      expect(params.setError).toHaveBeenCalledWith("Invalid link");
    });

    it("emits mobile_connect_failed with code: \"not_found\"", async () => {
      const session = makeSession({ status: "waiting_for_mobile", mobileConnected: false });
      const params = makeParams(session);
      vi.mocked(connectRoomPreviewSession).mockRejectedValue(
        new RoomPreviewRequestError("not_found", "Session not found."),
      );

      const { result } = renderHook(() => useMobileConnect(params));
      await act(async () => { await result.current.handleConnect(); });

      const failed = eventsOfType("mobile_connect_failed")[0];
      expect(failed).toMatchObject({
        code: "not_found",
        message: "Session not found.",
        level: "error",
      });
    });
  });

  describe("already-connecting guard", () => {
    it("returns early on a second invocation while the first is still in-flight", async () => {
      const session = makeSession({ status: "waiting_for_mobile", mobileConnected: false });
      const params = makeParams(session);

      // Never-resolving promise keeps isConnecting=true through both calls.
      let resolveConnect: (s: RoomPreviewSession) => void = () => {};
      vi.mocked(connectRoomPreviewSession).mockReturnValue(
        new Promise<RoomPreviewSession>((res) => { resolveConnect = res; }),
      );

      const { result, rerender } = renderHook(() => useMobileConnect(params));

      // Fire the first call — do NOT await. It hangs on the never-resolving promise.
      await act(async () => {
        void result.current.handleConnect();
      });

      // Hook has re-rendered with isConnecting=true; closure is updated.
      rerender();

      // Second call should hit the guard and return immediately.
      const secondPromise = result.current.handleConnect();
      await expect(secondPromise).resolves.toBeUndefined();

      // Exactly one API call total.
      expect(connectRoomPreviewSession).toHaveBeenCalledTimes(1);

      // Exactly one mobile_tap_detected / mobile_connect_started — the second
      // call did not emit anything because the guard fired before the
      // diagnostic block.
      expect(eventsOfType("mobile_tap_detected")).toHaveLength(1);
      expect(eventsOfType("mobile_connect_started")).toHaveLength(1);

      // Cleanup — resolve the dangling promise so React doesn't complain.
      await act(async () => {
        resolveConnect(makeSession({ mobileConnected: true }));
      });
    });
  });

  describe("already-connected guard", () => {
    it("returns early when session.mobileConnected is true", async () => {
      const session = makeSession({ mobileConnected: true });
      const params = makeParams(session);

      const { result } = renderHook(() => useMobileConnect(params));
      await act(async () => { await result.current.handleConnect(); });

      // No API call, no setter calls, no events.
      expect(connectRoomPreviewSession).not.toHaveBeenCalled();
      expect(params.setSession).not.toHaveBeenCalled();
      expect(params.setError).not.toHaveBeenCalled();
      expect(params.setSuccessMessage).not.toHaveBeenCalled();
      expect(params.setRoomSaveStatus).not.toHaveBeenCalled();
      expect(emittedEvents()).toHaveLength(0);
    });

    it("returns early when session is null", async () => {
      const params = makeParams(null);

      const { result } = renderHook(() => useMobileConnect(params));
      await act(async () => { await result.current.handleConnect(); });

      expect(connectRoomPreviewSession).not.toHaveBeenCalled();
      expect(emittedEvents()).toHaveLength(0);
    });
  });
});
