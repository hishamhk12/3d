import { fetchRoomPreviewSession, RoomPreviewRequestError } from "@/lib/room-preview/session-client";
import { ROOM_PREVIEW_TIMEOUTS } from "@/lib/room-preview/constants";
import type { RoomPreviewSession } from "@/lib/room-preview/types";

type RoomPreviewSessionPollerOptions = {
  intervalMs?: number;
  onError?: (error: Error) => boolean | void;
  onUpdate: (session: RoomPreviewSession) => void;
};

export function createRoomPreviewSessionPoller(
  sessionId: string,
  options: RoomPreviewSessionPollerOptions,
) {
  const { intervalMs = 2000, onError, onUpdate } = options;
  let active = true;
  let timeoutId: number | undefined;

  async function poll() {
    try {
      const session = await fetchRoomPreviewSession(sessionId);

      if (!active) {
        return;
      }

      onUpdate(session);
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
        return;
      }
    }

    if (active) {
      timeoutId = window.setTimeout(poll, intervalMs);
    }
  }

  void poll();

  return () => {
    active = false;

    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
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
    let timeoutId: ReturnType<typeof window.setTimeout> | undefined;
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
