import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { RoomPreviewSession } from "@/lib/room-preview/types";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const baseSession: RoomPreviewSession = {
  id: "sess-abc123",
  status: "waiting_for_mobile",
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  expiresAt: null,
  mobileConnected: false,
  selectedRoom: null,
  selectedProduct: null,
  renderResult: null,
};

// ─── Mocks (before route import) ─────────────────────────────────────────────

vi.mock("@/lib/room-preview/session-service", () => ({
  createRoomPreviewSession: vi.fn(),
  getRoomPreviewSession: vi.fn(),
  isRoomPreviewSessionNotFoundError: vi.fn((e) => e?.code === "SESSION_NOT_FOUND"),
}));

vi.mock("@/lib/ip-rate-limit", () => ({
  checkIpRateLimit: vi.fn().mockResolvedValue({ limited: false, retryAfterSeconds: 0 }),
  checkActiveSessionsPerIp: vi.fn().mockResolvedValue(true),
  registerSessionForIp: vi.fn().mockResolvedValue(undefined),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

function makePostRequest() {
  return new NextRequest("http://localhost/api/room-preview/sessions", { method: "POST" });
}

const { POST: createSessionPOST } = await import("@/app/api/room-preview/sessions/route");
const { GET: getSessionGET } = await import(
  "@/app/api/room-preview/sessions/[sessionId]/route"
);
const { createRoomPreviewSession, getRoomPreviewSession } = await import(
  "@/lib/room-preview/session-service"
);

function makeContext(sessionId: string) {
  // Cast through unknown — the real RouteContext is constrained to known app
  // routes by Next.js generated types; for testing we only care about the shape.
  return {
    params: Promise.resolve({ sessionId }),
  } as unknown as RouteContext<"/api/room-preview/sessions/[sessionId]">;
}

// ─── POST /api/room-preview/sessions ─────────────────────────────────────────

describe("POST /api/room-preview/sessions", () => {
  it("returns 201 with sessionId and a session token", async () => {
    vi.mocked(createRoomPreviewSession).mockResolvedValueOnce(baseSession);

    const response = await createSessionPOST(makePostRequest());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(typeof body.id).toBe("string");
    expect(body.sessionId).toBeUndefined(); // spreads session directly — no wrapper object
    expect(typeof body.token).toBe("string");
    expect(body.token.length).toBeGreaterThan(0);
  });

  it("returns 500 when session creation throws", async () => {
    vi.mocked(createRoomPreviewSession).mockRejectedValueOnce(new Error("DB error"));

    const response = await createSessionPOST(makePostRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(typeof body.error).toBe("string");
  });

  it("token in response verifies against the returned session id", async () => {
    vi.mocked(createRoomPreviewSession).mockResolvedValueOnce(baseSession);

    const { generateSessionToken } = await import("@/lib/room-preview/session-token");
    const response = await createSessionPOST(makePostRequest());
    const body = await response.json();

    const expectedToken = generateSessionToken(baseSession.id);
    expect(body.token).toBe(expectedToken);
  });
});

// ─── GET /api/room-preview/sessions/[sessionId] ───────────────────────────────

describe("GET /api/room-preview/sessions/[sessionId]", () => {
  it("returns 200 with the session when found", async () => {
    vi.mocked(getRoomPreviewSession).mockResolvedValueOnce(baseSession);

    const response = await getSessionGET(new Request("http://localhost"), makeContext("sess-abc123"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe("sess-abc123");
    expect(body.status).toBe("waiting_for_mobile");
  });

  it("returns 404 when session is not found", async () => {
    vi.mocked(getRoomPreviewSession).mockResolvedValueOnce(null);

    const response = await getSessionGET(new Request("http://localhost"), makeContext("missing"));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.code).toBe("SESSION_NOT_FOUND");
  });

  it("returns 410 when session is expired", async () => {
    vi.mocked(getRoomPreviewSession).mockResolvedValueOnce({
      ...baseSession,
      status: "expired",
    });

    const response = await getSessionGET(new Request("http://localhost"), makeContext("expired-id"));
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(body.code).toBe("SESSION_EXPIRED");
  });

  it("returns 500 when service throws unexpectedly", async () => {
    vi.mocked(getRoomPreviewSession).mockRejectedValueOnce(new Error("DB timeout"));

    const response = await getSessionGET(new Request("http://localhost"), makeContext("err-id"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(typeof body.error).toBe("string");
  });
});
