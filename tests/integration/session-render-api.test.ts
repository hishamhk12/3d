import { describe, expect, it, vi, beforeEach } from "vitest";
import { generateSessionToken } from "@/lib/room-preview/session-token";
import { RoomPreviewSessionTransitionError } from "@/lib/room-preview/session-machine";
import type { RoomPreviewSession } from "@/lib/room-preview/types";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SESSION_ID = "render-test-session";

// Session in product_selected state — valid source for markReadyToRenderTransition.
// expiresAt must be a future timestamp; isEffectivelyExpired() treats null as expired.
const productSelectedSession: RoomPreviewSession = {
  id: SESSION_ID,
  status: "product_selected",
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T01:00:00.000Z",
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
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

const readyToRenderSession: RoomPreviewSession = {
  ...productSelectedSession,
  status: "ready_to_render",
};

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: vi.fn((fn: () => unknown) => { void fn(); }),
  };
});

vi.mock("@/lib/logger", () => ({
  getLogger: vi.fn().mockReturnValue({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

// session-diagnostics imports prisma at module load; must be mocked to avoid
// the DATABASE_URL check throwing before any test runs.
vi.mock("@/lib/room-preview/session-diagnostics", () => ({
  trackSessionEvent:       vi.fn().mockResolvedValue(undefined),
  openSessionIssue:        vi.fn().mockResolvedValue(undefined),
  resolveSessionIssue:     vi.fn().mockResolvedValue(undefined),
  diagnosticsErrorMetadata: vi.fn().mockReturnValue({ message: "err", name: "Error" }),
}));

vi.mock("@/lib/room-preview/session-events", () => ({
  publishRoomPreviewSessionEvent: vi.fn(),
}));

vi.mock("@/lib/room-preview/session-service", () => ({
  isRoomPreviewSessionNotFoundError: vi.fn((e) => e?.code === "SESSION_NOT_FOUND"),
  isRoomPreviewSessionExpiredError:  vi.fn((e) => e?.code === "SESSION_EXPIRED"),
  RoomPreviewSessionExpiredError: class extends Error {
    code = "SESSION_EXPIRED" as const;
    constructor() { super("Session expired"); this.name = "RoomPreviewSessionExpiredError"; }
  },
  RoomPreviewSessionNotFoundError: class extends Error {
    code = "SESSION_NOT_FOUND" as const;
    constructor() { super("Session not found"); this.name = "RoomPreviewSessionNotFoundError"; }
  },
  RoomPreviewSessionTransitionError,
}));

vi.mock("@/lib/room-preview/render-service", () => ({
  executeRenderPipeline: vi.fn().mockResolvedValue(undefined),
  recoverStuckRenderJob: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/analytics/event-tracker", () => ({
  trackEvent: vi.fn(),
  getUserSessionIdForSession: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/room-preview/session-repository", () => ({
  getSessionById:          vi.fn(),
  getSessionScreenFields:  vi.fn().mockResolvedValue({ screenId: null, lastRenderHash: null }),
  saveSessionState:        vi.fn(),
  tryIncrementRenderCount: vi.fn().mockResolvedValue({ incremented: true }),
  decrementRenderCount:    vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/room-preview/screen-repository", () => ({
  checkAndIncrementScreenBudget: vi.fn().mockResolvedValue({ allowed: true }),
  checkScreenCooldown:           vi.fn().mockReturnValue({ limited: false }),
  decrementScreenBudget:         vi.fn().mockResolvedValue(undefined),
  getActiveScreenById:           vi.fn().mockResolvedValue(null),
  saveSessionRenderHash:         vi.fn().mockResolvedValue(undefined),
  touchScreenLastRenderAt:       vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/room-preview/render-rate-limit", () => ({
  acquireRenderLock:   vi.fn().mockResolvedValue({ acquired: true }),
  releaseRenderLock:   vi.fn().mockResolvedValue(undefined),
  checkDeviceCooldown: vi.fn().mockResolvedValue({ limited: false }),
  setDeviceCooldown:   vi.fn().mockResolvedValue(undefined),
  DEVICE_COOLDOWN_SECONDS: 300,
}));

// ─── Import route and mocked helpers after mocks are registered ───────────────

const { POST } = await import(
  "@/app/api/room-preview/sessions/[sessionId]/render/route"
);
const {
  getSessionById,
  saveSessionState,
} = await import("@/lib/room-preview/session-repository");

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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionById).mockResolvedValue(productSelectedSession);
  vi.mocked(saveSessionState).mockImplementation(async (input) => ({
    ...productSelectedSession, ...input,
  }));
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/room-preview/sessions/[sessionId]/render", () => {
  it("returns 202 with ready_to_render session when render is accepted", async () => {
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
    vi.mocked(getSessionById).mockResolvedValue(null);

    const response = await POST(makeRequest(SESSION_ID), makeContext(SESSION_ID));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.code).toBe("SESSION_NOT_FOUND");
  });

  it("returns 400 when session is in an invalid state for rendering", async () => {
    // mobile_connected has no product selected — markReadyToRenderTransition throws.
    vi.mocked(getSessionById).mockResolvedValue({
      ...productSelectedSession,
      status: "mobile_connected" as const,
      selectedProduct: null,
    });

    const response = await POST(makeRequest(SESSION_ID), makeContext(SESSION_ID));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe("SESSION_INVALID_STATE");
  });

  it("returns 500 on unexpected errors", async () => {
    vi.mocked(saveSessionState).mockRejectedValue(new Error("Unexpected DB error"));

    const response = await POST(makeRequest(SESSION_ID), makeContext(SESSION_ID));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(typeof body.error).toBe("string");
  });
});
