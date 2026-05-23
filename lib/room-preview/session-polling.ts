import { fetchRoomPreviewSession, RoomPreviewRequestError } from "@/lib/room-preview/session-client";
import { ROOM_PREVIEW_TIMEOUTS } from "@/lib/room-preview/constants";
import type { RoomPreviewSession, RoomPreviewSessionStatus } from "@/lib/room-preview/types";

type RoomPreviewSessionPollerOptions = {
  intervalMs?: number;
  onStop?: (reason: "stopped" | "terminal") => void;
  onError?: (error: Error) => boolean | void;
  onUpdate: (session: RoomPreviewSession) => void;
};

const TERMINAL_SESSION_STATUSES = new Set<RoomPreviewSessionStatus>([
  "completed",
  "failed",
  "expired",
]);

function getSmartPollIntervalMs(status: RoomPreviewSessionStatus | null | undefined) {
  switch (status) {
    case "created":
    case "waiting_for_mobile":
      return 4_000;
    case "mobile_connected":
    case "room_selected":
    case "product_selected":
      return 2_250;
    case "ready_to_render":
    case "rendering":
      return 1_250;
    case "result_ready":
      return 1_000;
    default:
      return 3_000;
  }
}

function getVisibilityMultiplier() {
  if (typeof document === "undefined") return 1;
  return document.visibilityState === "hidden" ? 4 : 1;
}

export function createRoomPreviewSessionPoller(
  sessionId: string,
  options: RoomPreviewSessionPollerOptions,
) {
  const { intervalMs, onError, onStop, onUpdate } = options;
  let active = true;
  let timeoutId: number | undefined;
  let lastStatus: RoomPreviewSessionStatus | null = null;
  let stopNotified = false;

  const notifyStop = (reason: "stopped" | "terminal") => {
    if (stopNotified) return;
    stopNotified = true;
    onStop?.(reason);
  };

  const scheduleNextPoll = () => {
    if (!active) return;
    const baseIntervalMs = intervalMs ?? getSmartPollIntervalMs(lastStatus);
    timeoutId = window.setTimeout(
      poll,
      Math.max(1_000, baseIntervalMs * getVisibilityMultiplier()),
    );
  };

  async function poll() {
    try {
      const session = await fetchRoomPreviewSession(sessionId);

      if (!active) {
        return;
      }

      onUpdate(session);
      lastStatus = session.status;

      if (TERMINAL_SESSION_STATUSES.has(session.status)) {
        active = false;
        notifyStop("terminal");
        return;
      }
    } catch (error) {
      if (!active) {
        return;
      }

      const shouldContinue = onError?.(
        error instanceof Error
          ? error
          : new Error("Could not refresh the connection status for this session."),
      );

      if (shouldContinue === false) {
        active = false;
        notifyStop("stopped");
        return;
      }
    }

    scheduleNextPoll();
  }

  void poll();

  return () => {
    active = false;

    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
    notifyStop("stopped");
  };
}

function getRenderPollIntervalMs(elapsedMs: number): number {
  if (elapsedMs < 30_000) return 2_500;
  if (elapsedMs < 90_000) return 5_000;
  return 10_000;
}

export function pollForRenderResult(
  sessionId: string,
  timeoutMs = ROOM_PREVIEW_TIMEOUTS.RENDER_POLL_TIMEOUT_MS,
  options?: {
    onUpdate?: (session: RoomPreviewSession) => void;
  },
): Promise<RoomPreviewSession> {
  return new Promise((resolve, reject) => {
    let active = true;
    let timeoutId: number | undefined;
    let settled = false;
    const startedAt = Date.now();

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      active = false;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      window.clearTimeout(deadlineId);
      fn();
    };

    async function poll() {
      try {
        const session = await fetchRoomPreviewSession(sessionId);
        if (!active) return;
        options?.onUpdate?.(session);
        if (session.status === "result_ready" || session.status === "failed") {
          settle(() => resolve(session));
          return;
        }
      } catch {
        // transient error — keep polling
        if (!active) return;
      }

      if (active) {
        const intervalMs = getRenderPollIntervalMs(Date.now() - startedAt);
        timeoutId = window.setTimeout(poll, intervalMs);
      }
    }

    const deadlineId = window.setTimeout(() => {
      settle(() =>
        reject(
          new RoomPreviewRequestError("timeout", "Render timed out. Please try again."),
        ),
      );
    }, timeoutMs);

    void poll();
  });
}
