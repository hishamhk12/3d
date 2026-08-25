import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoomPreviewSession } from "@/lib/room-preview/session-client";

const session = {
  id: "sess-real-123",
  sessionId: "sess-real-123",
  status: "waiting_for_mobile",
  createdAt: "2026-08-05T06:13:49.000Z",
  updatedAt: "2026-08-05T06:13:49.000Z",
  expiresAt: "2026-08-05T07:43:49.000Z",
  mobileConnected: false,
  customerRoleSelected: false,
  selectedRoom: null,
  selectedProduct: null,
  renderResult: null,
  token: "signed-token",
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("createRoomPreviewSession", () => {
  it("extracts the explicit persisted sessionId contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(session), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    await expect(
      createRoomPreviewSession(undefined, {
        existingSessionId: "sess-previous",
        source: "hero_try_button",
      }),
    ).resolves.toEqual({ sessionId: "sess-real-123", token: "signed-token" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/room-preview/sessions",
      expect.objectContaining({ method: "POST" }),
    );
    const sentHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(sentHeaders.get("x-room-preview-existing-session-id")).toBe("sess-previous");
    expect(sentHeaders.get("x-room-preview-source")).toBe("hero_try_button");
  });

  it("rejects inconsistent id and sessionId values before navigation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ...session, sessionId: "different-id" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    await expect(createRoomPreviewSession()).rejects.toMatchObject({
      code: "invalid_response",
    });
  });
});
