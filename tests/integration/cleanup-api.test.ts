import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/room-preview/session-cleanup", () => ({
  expireOldSessions: vi.fn(),
  expireIdleWaitingSessions: vi.fn(),
  failStuckRenderingSessions: vi.fn(),
  completeResultReadySessions: vi.fn(),
}));

const { GET } = await import("@/app/api/room-preview/cleanup/route");
const {
  expireOldSessions,
  expireIdleWaitingSessions,
  failStuckRenderingSessions,
  completeResultReadySessions,
} = await import("@/lib/room-preview/session-cleanup");

function makeRequest(secret?: string) {
  const headers: Record<string, string> = {};
  if (secret) headers["x-cleanup-secret"] = secret;
  return new NextRequest("http://localhost/api/room-preview/cleanup", { headers });
}

describe("GET /api/room-preview/cleanup", () => {
  it("runs all four cleanup operations and returns counts", async () => {
    vi.mocked(expireOldSessions).mockResolvedValueOnce(3);
    vi.mocked(expireIdleWaitingSessions).mockResolvedValueOnce(5);
    vi.mocked(failStuckRenderingSessions).mockResolvedValueOnce(2);
    vi.mocked(completeResultReadySessions).mockResolvedValueOnce(4);

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.expired).toBe(3);
    expect(body.idleExpired).toBe(5);
    expect(body.stuckFailed).toBe(2);
    expect(body.completed).toBe(4);
    expect(typeof body.ranAt).toBe("string");
  });

  it("returns 500 when any cleanup operation throws", async () => {
    vi.mocked(expireOldSessions).mockRejectedValueOnce(new Error("DB down"));
    vi.mocked(expireIdleWaitingSessions).mockResolvedValueOnce(0);
    vi.mocked(failStuckRenderingSessions).mockResolvedValueOnce(0);
    vi.mocked(completeResultReadySessions).mockResolvedValueOnce(0);

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Cleanup failed");
  });

  it("returns 401 when secret is wrong", async () => {
    const original = process.env.CLEANUP_SECRET;
    process.env.CLEANUP_SECRET = "correct-secret";

    try {
      const response = await GET(makeRequest("wrong-secret"));
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe("Unauthorized");
    } finally {
      if (original === undefined) {
        delete process.env.CLEANUP_SECRET;
      } else {
        process.env.CLEANUP_SECRET = original;
      }
    }
  });
});
