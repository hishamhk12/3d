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

export function pollForRenderResult(
  sessionId: string,
  timeoutMs = ROOM_PREVIEW_TIMEOUTS.RENDER_POLL_TIMEOUT_MS,
): Promise<RoomPreviewSession> {
  return new Promise((resolve, reject) => {
    let stop: (() => void) | null = null;
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      stop?.();
      window.clearTimeout(deadlineId);
      fn();
    };

    stop = createRoomPreviewSessionPoller(sessionId, {
      intervalMs: ROOM_PREVIEW_TIMEOUTS.RENDER_POLL_MS,
      onUpdate(session) {
        if (session.status === "result_ready" || session.status === "failed") {
          settle(() => resolve(session));
        }
      },
      onError() {
        return true;
      },
    });

    const deadlineId = window.setTimeout(() => {
      settle(() =>
        reject(
          new RoomPreviewRequestError("timeout", "Render timed out. Please try again."),
        ),
      );
    }, timeoutMs);
  });
}
