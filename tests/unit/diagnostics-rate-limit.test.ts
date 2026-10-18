import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  // Run after() callbacks inline so we can assert on what gets persisted.
  return { ...actual, after: (fn: () => unknown) => void fn() };
});

const trackSessionEvent = vi.hoisted(() => vi.fn());
vi.mock("@/lib/room-preview/session-diagnostics", () => ({
  trackSessionEvent,
  openSessionIssue: vi.fn(),
}));
vi.mock("@/lib/room-preview/session-service", () => ({
  getRoomPreviewSession: vi.fn(async (id: string) => ({ id, status: "mobile_connected" })),
}));

import { POST } from "@/app/api/room-preview/sessions/[sessionId]/diagnostics/handler";

function send(sessionId: string, eventType: string) {
  return POST(
    new Request(`http://localhost/api/room-preview/sessions/${sessionId}/diagnostics`, {
      method: "POST",
      body: JSON.stringify({ source: "mobile", eventType }),
    }),
    { params: Promise.resolve({ sessionId }) },
  );
}

const persisted = (sessionId: string, eventType: string) =>
  trackSessionEvent.mock.calls.filter(([e]) => e.sessionId === sessionId && e.eventType === eventType).length;

describe("diagnostics rate limiting", () => {
  it("still records upload events after routine events use up the shared budget", async () => {
    const sid = "rate-limit-session";
    // 30 distinct routine (throttled) events exhaust the shared per-minute budget.
    for (let i = 0; i < 30; i += 1) await send(sid, `routine_event_${i}`);
    await send(sid, "routine_event_dropped");
    expect(persisted(sid, "routine_event_dropped")).toBe(0);

    await send(sid, "room_upload_started");
    await send(sid, "room_upload_failed");
    expect(persisted(sid, "room_upload_started")).toBe(1);
    expect(persisted(sid, "room_upload_failed")).toBe(1);
  });

  it("does not dedupe critical events (a retried upload can fail twice in 5 s)", async () => {
    const sid = "dedupe-session";
    await send(sid, "room_upload_failed");
    await send(sid, "room_upload_failed");
    expect(persisted(sid, "room_upload_failed")).toBe(2);

    await send(sid, "routine_event");
    await send(sid, "routine_event");
    expect(persisted(sid, "routine_event")).toBe(1);
  });
});
