// @vitest-environment happy-dom

/**
 * Unit tests for `useMobileSessionEvents`.
 *
 * The hook composes four passive telemetry effects:
 *   1. Heartbeat-disconnect tracker — emits `weak_connection_warning_shown`
 *      on the true → false edge only.
 *   2. `result_seen_mobile` tracker — fires once per unique render imageUrl.
 *   3. Status sync — mirrors `session?.status` via `updateStatus` and emits
 *      `console.info("[room-preview] mobile_session_status_changed", …)`.
 *   4. Mount / unmount debug logging.
 *
 * No production code was modified — the hook already accepts every
 * dependency as a param.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { RoomPreviewSession } from "@/lib/room-preview/types";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/room-preview/session-diagnostics-client", () => ({
  trackClientSessionEvent: vi.fn(),
}));

const { useMobileSessionEvents } = await import(
  "@/features/room-preview/mobile/useMobileSessionEvents"
);
const { trackClientSessionEvent } = await import(
  "@/lib/room-preview/session-diagnostics-client"
);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SESSION_ID = "test-session-events";

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

type Params = {
  session: RoomPreviewSession | null;
  sessionId: string;
  showResult: boolean;
  heartbeatConnected: boolean;
  heartbeatFailedCount: number;
  updateStatus: (status: string | null) => void;
  debugLog: (level: "info" | "success" | "warn" | "error" | "network" | "state", message: string, detail?: string) => void;
};

function makeParams(overrides: Partial<Params> = {}): Params {
  return {
    session: null,
    sessionId: SESSION_ID,
    showResult: false,
    heartbeatConnected: true,
    heartbeatFailedCount: 0,
    updateStatus: vi.fn(),
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

let consoleInfoSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  consoleInfoSpy.mockRestore();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useMobileSessionEvents", () => {

  describe("heartbeat disconnect tracker", () => {
    it("emits weak_connection_warning_shown on the connected → disconnected edge", () => {
      const params = makeParams({ heartbeatConnected: true, heartbeatFailedCount: 0 });

      const { rerender } = renderHook(
        (p: Params) => useMobileSessionEvents(p),
        { initialProps: params },
      );

      // Initial mount with heartbeatConnected: true — no event yet (ref started as true).
      expect(eventsOfType("weak_connection_warning_shown")).toHaveLength(0);

      // Edge: true → false. Single event with the current failedCount.
      rerender({ ...params, heartbeatConnected: false, heartbeatFailedCount: 3 });

      const events = eventsOfType("weak_connection_warning_shown");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        source: "mobile",
        eventType: "weak_connection_warning_shown",
        level: "warning",
        metadata: { failedCount: 3 },
      });
    });

    it("does NOT emit on disconnected → disconnected (no edge)", () => {
      const params = makeParams({ heartbeatConnected: true, heartbeatFailedCount: 0 });

      const { rerender } = renderHook(
        (p: Params) => useMobileSessionEvents(p),
        { initialProps: params },
      );

      // Edge 1: true → false — fires once.
      rerender({ ...params, heartbeatConnected: false, heartbeatFailedCount: 1 });
      expect(eventsOfType("weak_connection_warning_shown")).toHaveLength(1);

      // No-edge: false → false (only failedCount changes). The effect re-runs
      // because failedCount is in the deps, but `wasConnected` is now false,
      // so the conditional does NOT fire.
      rerender({ ...params, heartbeatConnected: false, heartbeatFailedCount: 2 });
      expect(eventsOfType("weak_connection_warning_shown")).toHaveLength(1);

      // Another no-edge transition.
      rerender({ ...params, heartbeatConnected: false, heartbeatFailedCount: 3 });
      expect(eventsOfType("weak_connection_warning_shown")).toHaveLength(1);
    });

    it("does NOT emit when heartbeatConnected stays true", () => {
      const params = makeParams({ heartbeatConnected: true, heartbeatFailedCount: 0 });

      const { rerender } = renderHook(
        (p: Params) => useMobileSessionEvents(p),
        { initialProps: params },
      );

      rerender({ ...params, heartbeatConnected: true, heartbeatFailedCount: 1 });
      rerender({ ...params, heartbeatConnected: true, heartbeatFailedCount: 2 });

      expect(eventsOfType("weak_connection_warning_shown")).toHaveLength(0);
    });

    it("re-emits on a fresh connected → disconnected edge after a recovery", () => {
      const params = makeParams({ heartbeatConnected: true, heartbeatFailedCount: 0 });

      const { rerender } = renderHook(
        (p: Params) => useMobileSessionEvents(p),
        { initialProps: params },
      );

      // First disconnect.
      rerender({ ...params, heartbeatConnected: false, heartbeatFailedCount: 1 });
      expect(eventsOfType("weak_connection_warning_shown")).toHaveLength(1);

      // Recovery (false → true) — no event for recovery edge.
      rerender({ ...params, heartbeatConnected: true, heartbeatFailedCount: 1 });
      expect(eventsOfType("weak_connection_warning_shown")).toHaveLength(1);

      // Second disconnect — should emit again.
      rerender({ ...params, heartbeatConnected: false, heartbeatFailedCount: 2 });
      expect(eventsOfType("weak_connection_warning_shown")).toHaveLength(2);
    });
  });

  describe("result_seen_mobile tracker", () => {
    it("emits once when showResult flips to true with a render imageUrl", () => {
      const sessionWithoutResult = makeSession({ renderResult: null });
      const params = makeParams({ session: sessionWithoutResult, showResult: false });

      const { rerender } = renderHook(
        (p: Params) => useMobileSessionEvents(p),
        { initialProps: params },
      );

      // Initial: no result and not showing — no event.
      expect(eventsOfType("result_seen_mobile")).toHaveLength(0);

      // Result arrives + showResult flips on.
      const sessionWithResult = makeSession({
        status: "result_ready",
        renderResult: {
          imageUrl: "https://cdn/result-1.png",
          kind: "composited_preview",
          jobId: "job-1",
          generatedAt: new Date().toISOString(),
          modelName: "gemini",
        },
      });
      rerender({ ...params, session: sessionWithResult, showResult: true });

      const events = eventsOfType("result_seen_mobile");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        source: "mobile",
        eventType: "result_seen_mobile",
        level: "info",
        metadata: {
          status: "result_ready",
          hasResultImage: true,
        },
      });
      // Timestamp is set to new Date().toISOString() — just check it's a string.
      expect(typeof (events[0].metadata as { timestamp: unknown }).timestamp).toBe("string");
    });

    it("does NOT emit twice for the same imageUrl across re-renders", () => {
      const session = makeSession({
        status: "result_ready",
        renderResult: {
          imageUrl: "https://cdn/result-stable.png",
          kind: "composited_preview",
          jobId: "job-stable",
          generatedAt: new Date().toISOString(),
          modelName: "gemini",
        },
      });
      const params = makeParams({ session, showResult: true });

      const { rerender } = renderHook(
        (p: Params) => useMobileSessionEvents(p),
        { initialProps: params },
      );

      // First mount with showResult=true and a result — fires once.
      expect(eventsOfType("result_seen_mobile")).toHaveLength(1);

      // Re-render with an updated session reference but the SAME imageUrl —
      // the ref guard short-circuits.
      const sameUrlNewObj = makeSession({
        status: "result_ready",
        renderResult: { ...session.renderResult! },
      });
      rerender({ ...params, session: sameUrlNewObj });

      expect(eventsOfType("result_seen_mobile")).toHaveLength(1);

      // Another re-render with the same URL — still one.
      rerender({ ...params, session: { ...sameUrlNewObj } });
      expect(eventsOfType("result_seen_mobile")).toHaveLength(1);
    });

    it("emits again when imageUrl changes to a new render result", () => {
      const session1 = makeSession({
        status: "result_ready",
        renderResult: {
          imageUrl: "https://cdn/result-A.png",
          kind: "composited_preview",
          jobId: "job-A",
          generatedAt: new Date().toISOString(),
          modelName: "gemini",
        },
      });
      const params = makeParams({ session: session1, showResult: true });

      const { rerender } = renderHook(
        (p: Params) => useMobileSessionEvents(p),
        { initialProps: params },
      );

      expect(eventsOfType("result_seen_mobile")).toHaveLength(1);

      // New render with a distinct imageUrl — should emit again.
      const session2 = makeSession({
        status: "result_ready",
        renderResult: {
          imageUrl: "https://cdn/result-B.png",
          kind: "composited_preview",
          jobId: "job-B",
          generatedAt: new Date().toISOString(),
          modelName: "gemini",
        },
      });
      rerender({ ...params, session: session2 });

      expect(eventsOfType("result_seen_mobile")).toHaveLength(2);
    });

    it("does NOT emit when showResult is false even with a render imageUrl present", () => {
      const session = makeSession({
        status: "result_ready",
        renderResult: {
          imageUrl: "https://cdn/result.png",
          kind: "composited_preview",
          jobId: "j",
          generatedAt: new Date().toISOString(),
          modelName: "gemini",
        },
      });
      const params = makeParams({ session, showResult: false });

      renderHook((p: Params) => useMobileSessionEvents(p), { initialProps: params });

      expect(eventsOfType("result_seen_mobile")).toHaveLength(0);
    });

    it("does NOT emit when renderResult.imageUrl is missing", () => {
      const session = makeSession({ status: "result_ready", renderResult: null });
      const params = makeParams({ session, showResult: true });

      renderHook((p: Params) => useMobileSessionEvents(p), { initialProps: params });

      expect(eventsOfType("result_seen_mobile")).toHaveLength(0);
    });
  });

  describe("status sync (updateStatus)", () => {
    it("calls updateStatus with session.status on mount and on status change", () => {
      const updateStatus = vi.fn();
      const session = makeSession({ status: "product_selected" });
      const params = makeParams({ session, updateStatus });

      const { rerender } = renderHook(
        (p: Params) => useMobileSessionEvents(p),
        { initialProps: params },
      );

      expect(updateStatus).toHaveBeenCalledWith("product_selected");

      rerender({
        ...params,
        session: makeSession({ status: "ready_to_render" }),
      });

      expect(updateStatus).toHaveBeenCalledWith("ready_to_render");
    });

    it("calls updateStatus(null) when session is null", () => {
      const updateStatus = vi.fn();
      const params = makeParams({ session: null, updateStatus });

      renderHook((p: Params) => useMobileSessionEvents(p), { initialProps: params });

      expect(updateStatus).toHaveBeenCalledWith(null);
    });

    it("re-syncs updateStatus when mobileConnected changes", () => {
      const updateStatus = vi.fn();
      const session = makeSession({ status: "mobile_connected", mobileConnected: false });
      const params = makeParams({ session, updateStatus });

      const { rerender } = renderHook(
        (p: Params) => useMobileSessionEvents(p),
        { initialProps: params },
      );

      const callsBefore = updateStatus.mock.calls.length;
      expect(callsBefore).toBeGreaterThanOrEqual(1);

      rerender({
        ...params,
        session: makeSession({ status: "mobile_connected", mobileConnected: true }),
      });

      // Effect ran again because session?.mobileConnected is in the deps.
      expect(updateStatus.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  describe("mobile_session_status_changed console.info", () => {
    it("logs the status payload when session.status is truthy", () => {
      const session = makeSession({ status: "rendering", mobileConnected: true });
      const params = makeParams({ session });

      renderHook((p: Params) => useMobileSessionEvents(p), { initialProps: params });

      expect(consoleInfoSpy).toHaveBeenCalledWith(
        "[room-preview] mobile_session_status_changed",
        expect.objectContaining({
          mobileConnected: true,
          sessionId: SESSION_ID,
          status: "rendering",
        }),
      );
    });

    it("does NOT log when session is null", () => {
      const params = makeParams({ session: null });

      renderHook((p: Params) => useMobileSessionEvents(p), { initialProps: params });

      const calls = (consoleInfoSpy.mock.calls as unknown[][]).filter(
        ([msg]) => msg === "[room-preview] mobile_session_status_changed",
      );
      expect(calls).toHaveLength(0);
    });
  });

  describe("lifecycle debug logging", () => {
    it("calls debugLog with the mounted message on mount", () => {
      const debugLog = vi.fn();
      const params = makeParams({ debugLog });

      renderHook((p: Params) => useMobileSessionEvents(p), { initialProps: params });

      expect(debugLog).toHaveBeenCalledWith(
        "info",
        "MobileSessionClient mounted",
        `sessionId: ${SESSION_ID}`,
      );
    });

    it("calls debugLog with the unmounting message on unmount", () => {
      const debugLog = vi.fn();
      const params = makeParams({ debugLog });

      const { unmount } = renderHook(
        (p: Params) => useMobileSessionEvents(p),
        { initialProps: params },
      );

      debugLog.mockClear();
      unmount();

      expect(debugLog).toHaveBeenCalledWith("warn", "MobileSessionClient unmounting");
    });

    it("logs mounted only once even when other deps change", () => {
      const debugLog = vi.fn();
      const params = makeParams({ debugLog });

      const { rerender } = renderHook(
        (p: Params) => useMobileSessionEvents(p),
        { initialProps: params },
      );

      const mountCallsBefore = debugLog.mock.calls.filter(
        ([level, msg]) => level === "info" && msg === "MobileSessionClient mounted",
      ).length;
      expect(mountCallsBefore).toBe(1);

      // Re-render with different session/heartbeat — mount log should not fire again.
      rerender({ ...params, session: makeSession({ status: "rendering" }) });
      rerender({ ...params, heartbeatConnected: false, heartbeatFailedCount: 5 });

      const mountCallsAfter = debugLog.mock.calls.filter(
        ([level, msg]) => level === "info" && msg === "MobileSessionClient mounted",
      ).length;
      expect(mountCallsAfter).toBe(1);
    });
  });
});
