import { describe, expect, it, vi } from "vitest";
import { generateSessionToken } from "@/lib/room-preview/session-token";
import { RoomPreviewSessionTransitionError } from "@/lib/room-preview/session-machine";

const SESSION_ID = "connect-test-session";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/room-preview/session-service", () => ({
  connectMobileToSession: vi.fn(),
  isRoomPreviewSessionNotFoundError: vi.fn((e) => e?.code === "SESSION_NOT_FOUND"),
  RoomPreviewSessionTransitionError,
}));

vi.mock("@/lib/analytics/event-tracker", () => ({
  trackEvent: vi.fn(),
  getUserSessionIdForSession: vi.fn().mockResolvedValue(null),
}));

const { POST } = await import(
  "@/app/api/room-preview/sessions/[sessionId]/connect/route"
);
const { connectMobileToSession } = await import("@/lib/room-preview/session-service");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeContext(sessionId: string) {
  return {
    params: Promise.resolve({ sessionId }),
  } as unknown as RouteContext<"/api/room-preview/sessions/[sessionId]/connect">;
}

function makeRequest(sessionId: string, withToken = true) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (withToken) {
    headers["x-session-token"] = generateSessionToken(sessionId);
  }
  return new Request(`http://localhost/api/room-preview/sessions/${sessionId}/connect`, {
    method: "POST",
    headers,
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/room-preview/sessions/[sessionId]/connect", () => {
  it("returns 200 with success:true when token is valid and session connects", async () => {
    // connectMobileToSession return value is not used by the route handler
    vi.mocked(connectMobileToSession).mockResolvedValueOnce(undefined as never);

    const response = await POST(makeRequest(SESSION_ID), makeContext(SESSION_ID));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("returns 401 when x-session-token header is missing", async () => {
    const request = makeRequest(SESSION_ID, false);
    const response = await POST(request, makeContext(SESSION_ID));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 when x-session-token is invalid", async () => {
    const request = new Request("http://localhost/connect", {
      method: "POST",
      headers: { "x-session-token": "invalid-token" },
    });
    const response = await POST(request, makeContext(SESSION_ID));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 when token belongs to a different session", async () => {
    const request = new Request("http://localhost/connect", {
      method: "POST",
      headers: { "x-session-token": generateSessionToken("other-session") },
    });
    const response = await POST(request, makeContext(SESSION_ID));
    const body = await response.json();

    expect(response.status).toBe(401);
  });

  it("returns 404 when session is not found", async () => {
    const notFoundError = Object.assign(new Error("Session not found"), {
      code: "SESSION_NOT_FOUND",
    });
    vi.mocked(connectMobileToSession).mockRejectedValueOnce(notFoundError);

    const response = await POST(makeRequest(SESSION_ID), makeContext(SESSION_ID));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.code).toBe("SESSION_NOT_FOUND");
  });

  it("returns 400 when transition is invalid", async () => {
    vi.mocked(connectMobileToSession).mockRejectedValueOnce(
      new RoomPreviewSessionTransitionError(
        "Session is not waiting for a mobile connection.",
        "result_ready",
      ),
    );

    const response = await POST(makeRequest(SESSION_ID), makeContext(SESSION_ID));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe("SESSION_INVALID_STATE");
  });

  it("returns 500 on unexpected errors", async () => {
    vi.mocked(connectMobileToSession).mockRejectedValueOnce(new Error("Unexpected"));

    const response = await POST(makeRequest(SESSION_ID), makeContext(SESSION_ID));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(typeof body.error).toBe("string");
  });
});
