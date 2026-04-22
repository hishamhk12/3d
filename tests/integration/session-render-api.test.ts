import { describe, expect, it, vi } from "vitest";
import { generateSessionToken } from "@/lib/room-preview/session-token";
import { RoomPreviewSessionTransitionError } from "@/lib/room-preview/session-machine";
import type { RoomPreviewSession } from "@/lib/room-preview/types";

const SESSION_ID = "render-test-session";

const readyToRenderSession: RoomPreviewSession = {
  id: SESSION_ID,
  status: "ready_to_render",
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T01:00:00.000Z",
  expiresAt: null,
  mobileConnected: true,
  selectedRoom: {
    source: "camera",
    imageUrl: "https://example.com/room.jpg",
  },
  selectedProduct: {
    id: "prod-1",
    barcode: null,
    name: "Oak Flooring",
    productType: "floor_material",
    imageUrl: "https://example.com/product.jpg",
  },
  renderResult: null,
};

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: vi.fn((fn: () => unknown) => { void fn(); }),
  };
});

vi.mock("@/lib/room-preview/session-service", () => ({
  startRenderSession: vi.fn(),
  isRoomPreviewSessionNotFoundError: vi.fn((e) => e?.code === "SESSION_NOT_FOUND"),
  isRoomPreviewSessionExpiredError: vi.fn((e) => e?.code === "SESSION_EXPIRED"),
  RoomPreviewSessionTransitionError,
}));

vi.mock("@/lib/room-preview/render-service", () => ({
  executeRenderPipeline: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/analytics/event-tracker", () => ({
  trackEvent: vi.fn(),
  getUserSessionIdForSession: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/room-preview/session-repository", () => ({
  getSessionById: vi.fn().mockResolvedValue(readyToRenderSession),
  getSessionScreenFields: vi.fn().mockResolvedValue({ screenId: null, lastRenderHash: null }),
  tryIncrementRenderCount: vi.fn().mockResolvedValue({ incremented: true, currentCount: 1 }),
  decrementRenderCount: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/room-preview/screen-repository", () => ({
  checkAndIncrementScreenBudget: vi.fn().mockResolvedValue({ allowed: true }),
  checkScreenCooldown: vi.fn().mockReturnValue({ limited: false }),
  decrementScreenBudget: vi.fn().mockResolvedValue(undefined),
  getActiveScreenById: vi.fn().mockResolvedValue(null),
  saveSessionRenderHash: vi.fn().mockResolvedValue(undefined),
  touchScreenLastRenderAt: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/room-preview/render-rate-limit", () => ({
  acquireRenderLock: vi.fn().mockResolvedValue({ acquired: true }),
  releaseRenderLock: vi.fn().mockResolvedValue(undefined),
  checkDeviceCooldown: vi.fn().mockResolvedValue({ limited: false, ttl: 0 }),
  setDeviceCooldown: vi.fn().mockResolvedValue(undefined),
  DEVICE_COOLDOWN_SECONDS: 30,
}));

const { POST } = await import(
  "@/app/api/room-preview/sessions/[sessionId]/render/route"
);
const { startRenderSession } = await import("@/lib/room-preview/session-service");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeContext(sessionId: string) {
  return {
    params: Promise.resolve({ sessionId }),
  } as unknown as RouteContext<"/api/room-preview/sessions/[sessionId]/render">;
}

function makeRequest(sessionId: string, withToken = true) {
  const headers: Record<string, string> = {};
  if (withToken) {
    headers["x-session-token"] = generateSessionToken(sessionId);
  }
  return new Request(
    `http://localhost/api/room-preview/sessions/${sessionId}/render`,
    { method: "POST", headers },
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/room-preview/sessions/[sessionId]/render", () => {
  it("returns 202 with ready_to_render session when render is accepted", async () => {
    vi.mocked(startRenderSession).mockResolvedValueOnce(readyToRenderSession);

    const response = await POST(makeRequest(SESSION_ID), makeContext(SESSION_ID));
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.status).toBe("ready_to_render");
  });

  it("returns 401 when session token is missing", async () => {
    const response = await POST(makeRequest(SESSION_ID, false), makeContext(SESSION_ID));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 when session token is wrong", async () => {
    const request = new Request("http://localhost/render", {
      method: "POST",
      headers: { "x-session-token": "wrong-token" },
    });
    const response = await POST(request, makeContext(SESSION_ID));

    expect(response.status).toBe(401);
  });

  it("returns 404 when session is not found", async () => {
    const notFoundError = Object.assign(new Error("Session not found"), {
      code: "SESSION_NOT_FOUND",
    });
    vi.mocked(startRenderSession).mockRejectedValueOnce(notFoundError);

    const response = await POST(makeRequest(SESSION_ID), makeContext(SESSION_ID));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.code).toBe("SESSION_NOT_FOUND");
  });

  it("returns 400 when session is in an invalid state for rendering", async () => {
    vi.mocked(startRenderSession).mockRejectedValueOnce(
      new RoomPreviewSessionTransitionError(
        "الرجاء اختيار منتج قبل البدء بالتصميم.",
        "room_selected",
      ),
    );

    const response = await POST(makeRequest(SESSION_ID), makeContext(SESSION_ID));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe("SESSION_INVALID_STATE");
  });

  it("returns 500 on unexpected errors", async () => {
    vi.mocked(startRenderSession).mockRejectedValueOnce(new Error("Unexpected"));

    const response = await POST(makeRequest(SESSION_ID), makeContext(SESSION_ID));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(typeof body.error).toBe("string");
  });
});
