import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "screen-token" }) }),
}));
vi.mock("@/lib/room-preview/session-token", () => ({ verifySessionToken: () => true }));
vi.mock("@/lib/room-preview/session-diagnostics", () => ({ trackSessionEvent: vi.fn() }));
vi.mock("@/lib/redis", () => ({ isRedisEnabled: () => false }));
// In-memory bus: never delivers anything, like an event published on another
// serverless instance.
vi.mock("@/lib/room-preview/session-events", () => ({
  subscribeToRoomPreviewSessionEvents: () => () => {},
}));

const getRoomPreviewSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/room-preview/session-service", () => ({ getRoomPreviewSession }));

import { GET } from "@/app/api/room-preview/sessions/[sessionId]/events/handler";

const base = { id: "s1", status: "mobile_connected", updatedAt: "2026-10-18T11:00:00.000Z" };

describe("SSE stream without Redis", () => {
  afterEach(() => vi.useRealTimers());

  it("pushes session changes made on other instances by polling the session row", async () => {
    vi.useFakeTimers();
    getRoomPreviewSession.mockResolvedValue(base);

    const controller = new AbortController();
    const response = await GET(
      new Request("http://localhost/api/room-preview/sessions/s1/events", { signal: controller.signal }),
      { params: Promise.resolve({ sessionId: "s1" }) },
    );
    const reader = (response as Response).body!.getReader();
    const decoder = new TextDecoder();
    let received = "";
    // Read continuously in the background; assertions inspect `received`.
    void (async () => {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) return;
        received += decoder.decode(chunk.value);
      }
    })().catch(() => {});
    const drain = () => vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(0);
    await drain();
    const initialUpdates = received.split("event: session_updated").length - 1;
    expect(initialUpdates).toBe(1); // the initial snapshot

    // Unchanged row → nothing new is pushed.
    await vi.advanceTimersByTimeAsync(2_000);
    await drain();
    expect(received.split("event: session_updated").length - 1).toBe(1);

    // The phone uploads a room on another instance → the row changes.
    getRoomPreviewSession.mockResolvedValue({
      ...base,
      status: "room_selected",
      updatedAt: "2026-10-18T11:00:05.000Z",
    });
    await vi.advanceTimersByTimeAsync(2_000);
    await drain();
    expect(received.split("event: session_updated").length - 1).toBe(2);
    expect(received).toContain('"status":"room_selected"');

    controller.abort();
  });
});
