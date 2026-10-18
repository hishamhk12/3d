import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRoomPreviewSessionForScreen } from "@/lib/room-preview/session-client";

const session = {
  id: "cmvc944db0000y2j1ev6f8xbv",
  status: "waiting_for_mobile",
  createdAt: "2026-10-17T10:26:05.471Z",
  updatedAt: "2026-10-17T10:26:05.471Z",
  expiresAt: "2026-10-17T10:34:05.288Z",
  mobileConnected: false,
  customerRoleSelected: false,
  selectedRoom: null,
  selectedProduct: null,
  renderResult: null,
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("fetchRoomPreviewSessionForScreen", () => {
  it("recovers from a request timeout and loads waiting_for_mobile", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(session), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    const load = fetchRoomPreviewSessionForScreen(session.id);
    await vi.advanceTimersByTimeAsync(300);
    await expect(load).resolves.toMatchObject({
      id: session.id,
      status: "waiting_for_mobile",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.runOnlyPendingTimersAsync();
  });

  it("does not retry missing sessions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: "SESSION_NOT_FOUND", error: "Session not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    await expect(fetchRoomPreviewSessionForScreen(session.id)).rejects.toMatchObject({
      code: "not_found",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
