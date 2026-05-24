import { ROOM_PREVIEW_TIMEOUTS } from "@/lib/room-preview/constants";
import type { RoomPreviewSession, RoomPreviewSessionEvent } from "@/lib/room-preview/types";

type RoomPreviewSessionEventsClientOptions = {
  onError?: (details: { attempt: number; nextDelayMs: number }) => void;
  onOpen?: (details: { reconnected: boolean }) => void;
  onSessionUpdate: (session: RoomPreviewSession) => void;
};

const SSE_RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000] as const;
// If no keepalive arrives within 2× the server's send interval, treat the
// connection as silently stale and force a reconnect.
const SSE_KEEPALIVE_TIMEOUT_MS = ROOM_PREVIEW_TIMEOUTS.SSE_KEEPALIVE_MS * 2;

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
  let keepaliveStalenessTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  let hasConnected = false;

  const clearReconnectTimer = () => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const clearKeepaliveTimer = () => {
    if (keepaliveStalenessTimer !== null) {
      clearTimeout(keepaliveStalenessTimer);
      keepaliveStalenessTimer = null;
    }
  };

  const resetKeepaliveTimer = () => {
    clearKeepaliveTimer();
    keepaliveStalenessTimer = setTimeout(() => {
      // No keepalive received within the stale window — the SSE connection is
      // open but delivering nothing (e.g. Redis subscription silently dropped).
      // Trigger handleError so the client reconnects and polling fallback starts.
      handleError();
    }, SSE_KEEPALIVE_TIMEOUT_MS);
  };

  const handleOpen = () => {
    const reconnected = hasConnected || reconnectAttempt > 0;
    hasConnected = true;
    reconnectAttempt = 0;
    resetKeepaliveTimer();
    onOpen?.({ reconnected });
  };

  const handleKeepalive = () => {
    resetKeepaliveTimer();
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

    clearKeepaliveTimer();
    source?.removeEventListener("open", handleOpen);
    source?.removeEventListener("session_updated", handleUpdate);
    source?.removeEventListener("keepalive", handleKeepalive);
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
    source.addEventListener("keepalive", handleKeepalive);
    source.addEventListener("error", handleError);
  };

  connect();

  return () => {
    stopped = true;
    clearReconnectTimer();
    clearKeepaliveTimer();
    source?.removeEventListener("open", handleOpen);
    source?.removeEventListener("session_updated", handleUpdate);
    source?.removeEventListener("keepalive", handleKeepalive);
    source?.removeEventListener("error", handleError);
    source?.close();
    source = null;
  };
}
