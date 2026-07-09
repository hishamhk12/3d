/**
 * Route handler safety tests for POST /api/room-preview/sessions/[sessionId]/render
 *
 * Tests behavior from the outside (status codes, response shapes) without
 * hitting the real database, Redis, or Gemini API.
 *
 * Note: the existing session-render-api.test.ts was written against an older
 * version of the route (which used startRenderSession). This file covers the
 * current implementation which directly calls session-repository, session-machine,
 * render-rate-limit, etc.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateSessionToken } from "@/lib/room-preview/session-token";
import { RoomPreviewSessionTransitionError } from "@/lib/room-preview/session-machine";
import type { RoomPreviewSession } from "@/lib/room-preview/types";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("next/server", async (orig) => {
  const actual = await orig<typeof import("next/server")>();
  return { ...actual, after: vi.fn((fn: () => unknown) => { void fn(); }) };
});

vi.mock("@/lib/logger", () => ({
  getLogger: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// Prevent transitive prisma import in session-diagnostics.
vi.mock("@/lib/room-preview/session-diagnostics", () => ({
  trackSessionEvent:       vi.fn().mockResolvedValue(undefined),
  openSessionIssue:        vi.fn().mockResolvedValue(undefined),
  resolveSessionIssue:     vi.fn().mockResolvedValue(undefined),
  diagnosticsErrorMetadata: vi.fn().mockReturnValue({ message: "err", name: "Error" }),
}));

// Prevent transitive prisma/redis imports in other dependencies.
vi.mock("@/lib/room-preview/session-events", () => ({
  publishRoomPreviewSessionEvent: vi.fn(),
}));

vi.mock("@/lib/analytics/event-tracker", () => ({
  trackEvent:                vi.fn().mockResolvedValue(undefined),
  getUserSessionIdForSession: vi.fn().mockResolvedValue(null),
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

vi.mock("@/lib/room-preview/session-repository", () => ({
  getSessionById:          vi.fn(),
  getSessionScreenFields:  vi.fn().mockResolvedValue({ screenId: null, lastRenderHash: null }),
  saveSessionState:        vi.fn(),
  tryIncrementRenderCount: vi.fn().mockResolvedValue({ incremented: true }),
  decrementRenderCount:    vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/room-preview/render-repository", () => ({
  createRenderJob: vi.fn(),
  updateRenderJob: vi.fn(),
  findStuckRenderJobForSession: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/room-preview/render-service", () => ({
  executeRenderPipeline: vi.fn().mockResolvedValue(undefined),
  recoverStuckRenderJob: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/room-preview/render-rate-limit", () => ({
  acquireRenderLock:    vi.fn().mockResolvedValue({ acquired: true }),
  releaseRenderLock:    vi.fn().mockResolvedValue(undefined),
  checkDeviceCooldown:  vi.fn().mockResolvedValue({ limited: false }),
  setDeviceCooldown:    vi.fn().mockResolvedValue(undefined),
  DEVICE_COOLDOWN_SECONDS: 300,
}));

vi.mock("@/lib/room-preview/screen-repository", () => ({
  checkAndIncrementScreenBudget: vi.fn().mockResolvedValue({ allowed: true }),
  checkScreenCooldown:           vi.fn().mockReturnValue({ limited: false }),
  decrementScreenBudget:         vi.fn().mockResolvedValue(undefined),
  getActiveScreenById:           vi.fn().mockResolvedValue(null),
  saveSessionRenderHash:         vi.fn().mockResolvedValue(undefined),
  touchScreenLastRenderAt:       vi.fn().mockResolvedValue(undefined),
}));

// ─── Import route after mocks ─────────────────────────────────────────────────

const { POST } = await import(
  "@/app/api/room-preview/sessions/[sessionId]/render/route"
);

const {
  getSessionById,
  saveSessionState,
  tryIncrementRenderCount,
} = await import("@/lib/room-preview/session-repository");

const { acquireRenderLock, checkDeviceCooldown } =
  await import("@/lib/room-preview/render-rate-limit");

const { executeRenderPipeline } = await import("@/lib/room-preview/render-service");

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SESSION_ID = "route-safety-session";

const productSelectedSession: RoomPreviewSession = {
  id: SESSION_ID,
  status: "product_selected",
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T01:00:00.000Z",
  // Must be a future timestamp — isEffectivelyExpired() returns true for null
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  mobileConnected: true,
  selectedRoom:    { source: "camera", imageUrl: "https://example.com/room.jpg" },
  selectedProduct: {
    id: "prod-1", barcode: null, name: "Oak Flooring",
    productType: "floor_material", imageUrl: "https://example.com/product.jpg",
  },
  renderResult: null,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function makeContext(sessionId: string) {
  return {
    params: Promise.resolve({ sessionId }),
  } as unknown as RouteContext<"/api/room-preview/sessions/[sessionId]/render">;
}

beforeEach(() => {
  vi.clearAllMocks();

  // Default happy path
  vi.mocked(getSessionById).mockResolvedValue(productSelectedSession);
  vi.mocked(saveSessionState).mockImplementation(async (input) => ({
    ...productSelectedSession, ...input,
  }));
  vi.mocked(tryIncrementRenderCount).mockResolvedValue({ incremented: true });
  vi.mocked(acquireRenderLock).mockResolvedValue({ acquired: true });
  vi.mocked(checkDeviceCooldown).mockResolvedValue({ limited: false });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/room-preview/sessions/[sessionId]/render", () => {

  describe("authentication", () => {
    it("returns 401 when session token header is missing", async () => {
      const res = await POST(makeRequest(SESSION_ID, false), makeContext(SESSION_ID));
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.code).toBe("UNAUTHORIZED");
    });

    it("returns 401 when session token does not match the sessionId", async () => {
      const request = new Request("http://localhost/render", {
        method: "POST",
        headers: { "x-session-token": generateSessionToken("different-session") },
      });
      const res = await POST(request, makeContext(SESSION_ID));
      expect(res.status).toBe(401);
    });
  });

  describe("session validation", () => {
    it("returns 404 when the session does not exist", async () => {
      vi.mocked(getSessionById).mockResolvedValue(null);

      const res = await POST(makeRequest(SESSION_ID), makeContext(SESSION_ID));
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.code).toBe("SESSION_NOT_FOUND");
    });

    it("returns 410 when the session is expired (expiresAt in the past)", async () => {
      const expiredSession = {
        ...productSelectedSession,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        status: "expired" as const,
      };
      vi.mocked(getSessionById).mockResolvedValue(expiredSession);

      const res = await POST(makeRequest(SESSION_ID), makeContext(SESSION_ID));
      const body = await res.json();

      expect(res.status).toBe(410);
      expect(body.code).toBe("SESSION_EXPIRED");
    });

    it("returns 400 when session is in an invalid state for markReadyToRenderTransition", async () => {
      // A session in "mobile_connected" (no product selected) can't transition.
      const invalidStateSession = {
        ...productSelectedSession,
        status: "mobile_connected" as const,
        selectedProduct: null,
      };
      vi.mocked(getSessionById).mockResolvedValue(invalidStateSession);

      const res = await POST(makeRequest(SESSION_ID), makeContext(SESSION_ID));
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.code).toBe("SESSION_INVALID_STATE");
    });

    it("accepts floor and wallpaper together and schedules the render pipeline", async () => {
      vi.mocked(getSessionById).mockResolvedValue({
        ...productSelectedSession,
        selectedProductsBySurface: {
          floor: productSelectedSession.selectedProduct!,
          walls: {
            id: "wallpaper-1",
            barcode: null,
            name: "Wallpaper",
            productType: "wall_material",
            category: "WALLPAPER",
            targetSurface: "walls",
            imageUrl: "https://example.com/wallpaper.jpg",
          },
        },
      });

      const res = await POST(makeRequest(SESSION_ID), makeContext(SESSION_ID));
      const body = await res.json();

      expect(res.status).toBe(202);
      expect(body.status).toBe("ready_to_render");
      expect(executeRenderPipeline).toHaveBeenCalledWith(SESSION_ID);
    });

    it("returns UNSUPPORTED_PRODUCT_COMBINATION for invalid two-product combinations", async () => {
      vi.mocked(getSessionById).mockResolvedValue({
        ...productSelectedSession,
        selectedProductsBySurface: {
          floor: {
            id: "bad-floor",
            barcode: null,
            name: "Bad floor",
            productType: "wall_material",
            category: "WALLPAPER",
            targetSurface: "floor",
            imageUrl: "https://example.com/bad-floor.jpg",
          },
          walls: {
            id: "wallpaper-1",
            barcode: null,
            name: "Wallpaper",
            productType: "wall_material",
            category: "WALLPAPER",
            targetSurface: "walls",
            imageUrl: "https://example.com/wallpaper.jpg",
          },
        },
      });

      const res = await POST(makeRequest(SESSION_ID), makeContext(SESSION_ID));
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.code).toBe("UNSUPPORTED_PRODUCT_COMBINATION");
      expect(executeRenderPipeline).not.toHaveBeenCalled();
    });
  });

  describe("rate limiting", () => {
    it("returns 429 when the render lock cannot be acquired (in-flight render)", async () => {
      vi.mocked(acquireRenderLock).mockResolvedValue({ acquired: false });

      const res = await POST(makeRequest(SESSION_ID), makeContext(SESSION_ID));
      const body = await res.json();

      expect(res.status).toBe(429);
      expect(typeof body.error).toBe("string");
    });

    it("returns 429 with RENDER_LIMIT_REACHED when session render count is at max", async () => {
      vi.mocked(tryIncrementRenderCount).mockResolvedValue(
        { incremented: false, currentCount: 2 } as Awaited<ReturnType<typeof tryIncrementRenderCount>>,
      );

      const res = await POST(makeRequest(SESSION_ID), makeContext(SESSION_ID));
      const body = await res.json();

      expect(res.status).toBe(429);
      expect(body.code).toBe("RENDER_LIMIT_REACHED");
    });

    it("returns 429 with RENDER_DEVICE_COOLDOWN when device is on cooldown", async () => {
      vi.mocked(checkDeviceCooldown).mockResolvedValue(
        { limited: true, ttl: 120 } as Awaited<ReturnType<typeof checkDeviceCooldown>>,
      );

      const res = await POST(makeRequest(SESSION_ID), makeContext(SESSION_ID));
      const body = await res.json();

      expect(res.status).toBe(429);
      expect(body.code).toBe("RENDER_DEVICE_COOLDOWN");
    });

    it("includes Retry-After header in all 429 responses", async () => {
      vi.mocked(acquireRenderLock).mockResolvedValue({ acquired: false });

      const res = await POST(makeRequest(SESSION_ID), makeContext(SESSION_ID));

      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBeTruthy();
    });
  });

  describe("successful render request", () => {
    it("returns 202 with the updated session in ready_to_render status", async () => {
      const res = await POST(makeRequest(SESSION_ID), makeContext(SESSION_ID));
      const body = await res.json();

      expect(res.status).toBe(202);
      expect(body.status).toBe("ready_to_render");
      expect(body.id).toBe(SESSION_ID);
    });

    it("schedules the render pipeline via executeRenderPipeline", async () => {
      await POST(makeRequest(SESSION_ID), makeContext(SESSION_ID));

      expect(executeRenderPipeline).toHaveBeenCalledWith(SESSION_ID);
    });

    it("returns 200 (dedup) if inputs are unchanged and result already exists", async () => {
      const { saveSessionRenderHash } = await import("@/lib/room-preview/screen-repository");
      const { getSessionScreenFields } = await import("@/lib/room-preview/session-repository");

      // Build the same hash the route would build for this session.
      const { createHash } = await import("node:crypto");
      const renderHash = createHash("sha256")
        .update(`${productSelectedSession.selectedRoom!.imageUrl}::${productSelectedSession.selectedProduct!.id}`)
        .digest("hex");

      vi.mocked(getSessionScreenFields).mockResolvedValue({
        screenId: null,
        lastRenderHash: renderHash,
      });

      // Session has a render result and is NOT in result_ready (won't skip dedup)
      vi.mocked(getSessionById).mockResolvedValue({
        ...productSelectedSession,
        // "completed" triggers dedup; "result_ready" would bypass it (customer re-render)
        status: "completed" as const,
        renderResult: {
          imageUrl: "https://cdn/old.png",
          kind: "composited_preview",
          jobId: "job-old",
          generatedAt: new Date().toISOString(),
          modelName: "gemini",
        },
      });

      const res = await POST(makeRequest(SESSION_ID), makeContext(SESSION_ID));

      expect(res.status).toBe(200);
      // executeRenderPipeline should NOT be called when dedup hits.
      expect(executeRenderPipeline).not.toHaveBeenCalled();
      void saveSessionRenderHash;
    });
  });

  describe("error recovery", () => {
    it("returns 500 on unexpected errors from saveSessionState", async () => {
      vi.mocked(saveSessionState).mockRejectedValue(new Error("DB write failed"));

      const res = await POST(makeRequest(SESSION_ID), makeContext(SESSION_ID));
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(typeof body.error).toBe("string");
    });
  });
});
