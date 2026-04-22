import type { RoomPreviewSession, RoomPreviewSessionEvent } from "@/lib/room-preview/types";

type RoomPreviewSessionEventsClientOptions = {
  onError?: () => void;
  onOpen?: () => void;
  onSessionUpdate: (session: RoomPreviewSession) => void;
};

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
  const source = new EventSource(`/api/room-preview/sessions/${sessionId}/events`);
  const { onError, onOpen, onSessionUpdate } = options;

  const handleOpen = () => {
    onOpen?.();
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
      onError?.();
    }
  };

  const handleError = () => {
    onError?.();
  };

  source.addEventListener("open", handleOpen);
  source.addEventListener("session_updated", handleUpdate);
  source.addEventListener("error", handleError);

  return () => {
    source.removeEventListener("open", handleOpen);
    source.removeEventListener("session_updated", handleUpdate);
    source.removeEventListener("error", handleError);
    source.close();
  };
}
