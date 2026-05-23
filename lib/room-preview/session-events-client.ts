import type { RoomPreviewSession, RoomPreviewSessionEvent } from "@/lib/room-preview/types";

type RoomPreviewSessionEventsClientOptions = {
  onError?: (details: { attempt: number; nextDelayMs: number }) => void;
  onOpen?: (details: { reconnected: boolean }) => void;
  onSessionUpdate: (session: RoomPreviewSession) => void;
};

const SSE_RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRoomPreviewSessionEvent(value: unknown): value is RoomPreviewSessionEvent {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.sessionId === "string" &&
    value.type === "session_updated" &&
    isRecord(value.session) &&
    typeof value.session.id === "string"
  );
}

export function createRoomPreviewSessionEventsClient(
  sessionId: string,
  options: RoomPreviewSessionEventsClientOptions,
) {
  const { onError, onOpen, onSessionUpdate } = options;
  let source: EventSource | null = null;
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  let hasConnected = false;

  const clearReconnectTimer = () => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const handleOpen = () => {
    const reconnected = hasConnected || reconnectAttempt > 0;
    hasConnected = true;
    reconnectAttempt = 0;
    onOpen?.({ reconnected });
  };

  const handleUpdate = (event: Event) => {
    if (!(event instanceof MessageEvent)) return;
    try {
      const payload: unknown = JSON.parse(event.data as string);

      if (!isRoomPreviewSessionEvent(payload)) {
        return;
      }

      onSessionUpdate(payload.session);
    } catch {
      handleError();
    }
  };

  const handleError = () => {
    if (stopped) return;

    source?.removeEventListener("open", handleOpen);
    source?.removeEventListener("session_updated", handleUpdate);
    source?.removeEventListener("error", handleError);
    source?.close();
    source = null;

    const delayIndex = Math.min(reconnectAttempt, SSE_RECONNECT_DELAYS_MS.length - 1);
    const nextDelayMs = SSE_RECONNECT_DELAYS_MS[delayIndex];
    reconnectAttempt += 1;
    onError?.({ attempt: reconnectAttempt, nextDelayMs });

    clearReconnectTimer();
    reconnectTimer = setTimeout(connect, nextDelayMs);
  };

  const connect = () => {
    if (stopped || source) return;

    source = new EventSource(`/api/room-preview/sessions/${sessionId}/events`);
    source.addEventListener("open", handleOpen);
    source.addEventListener("session_updated", handleUpdate);
    source.addEventListener("error", handleError);
  };

  connect();

  return () => {
    stopped = true;
    clearReconnectTimer();
    source?.removeEventListener("open", handleOpen);
    source?.removeEventListener("session_updated", handleUpdate);
    source?.removeEventListener("error", handleError);
    source?.close();
    source = null;
  };
}
