import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateSessionToken } from "@/lib/room-preview/session-token";
import { RoomPreviewSessionTransitionError } from "@/lib/room-preview/session-machine";
import type { RoomPreviewSession } from "@/lib/room-preview/types";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SESSION_ID = "retry-test-session";

// A session whose CURRENT selected product is WALL_CLADDING — the exact shape
// that live E2E testing found broken (POST /mobile/request-retry with no
// productId/barcode falls back to the session's own selected product via
// resolveRetryProduct, which used to allow-list only floor_material/wall_material).
const wallCladdingSession: RoomPreviewSession = {
  id: SESSION_ID,
  status: "failed",
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T01:00:00.000Z",
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  mobileConnected: true,
  selectedRoom: { source: "camera", imageUrl: "https://example.com/room.jpg" },
  selectedProduct: {
    id: "PWM02.020",
    barcode: "PWM02.020",
    name: "Oak Wall Panel",
    productType: "wall_cladding",
    category: "WALL_CLADDING",
    targetSurface: "walls",
    imageUrl: "https://example.com/wall-cladding.jpg",
  },
  selectedProductsBySurface: {
    walls: {
      id: "PWM02.020",
      barcode: "PWM02.020",
      name: "Oak Wall Panel",
      productType: "wall_cladding",
      category: "WALL_CLADDING",
      targetSurface: "walls",
      imageUrl: "https://example.com/wall-cladding.jpg",
    },
  },
  renderResult: null,
};

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/logger", () => ({
  getLogger: vi.fn().mockReturnValue({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

vi.mock("@/lib/room-preview/session-diagnostics", () => ({
  trackSessionEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/room-preview/session-repository", () => ({
  getSessionById: vi.fn(),
}));

vi.mock("@/lib/room-preview/session-service", () => ({
  isRoomPreviewSessionNotFoundError: vi.fn((e) => e?.code === "SESSION_NOT_FOUND"),
  isRoomPreviewSessionExpiredError:  vi.fn((e) => e?.code === "SESSION_EXPIRED"),
  RoomPreviewSessionTransitionError,
  selectProductForSession: vi.fn(),
}));

// ─── Import route and mocked helpers after mocks are registered ───────────────

const { POST } = await import("@/app/api/room-preview/mobile/request-retry/route");
const { getSessionById } = await import("@/lib/room-preview/session-repository");
const { selectProductForSession } = await import("@/lib/room-preview/session-service");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(body: unknown, withToken = true) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (withToken) {
    headers["x-session-token"] = generateSessionToken(SESSION_ID);
  }
  return new Request("http://localhost/api/room-preview/mobile/request-retry", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionById).mockResolvedValue(wallCladdingSession);
  vi.mocked(selectProductForSession).mockResolvedValue({
    session: { ...wallCladdingSession, status: "product_selected" },
  } as never);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/room-preview/mobile/request-retry", () => {
  it("REGRESSION: accepts a retry when the session's current product is WALL_CLADDING (was rejected as PRODUCT_NOT_FOUND before the fix)", async () => {
    // No productId/barcode in the body — forces resolveRetryProduct's
    // "use the session's current selected product" branch, which used to
    // filter out productType "wall_cladding".
    const response = await POST(makeRequest({ sessionId: SESSION_ID }));
    const bodyJson = await response.json();

    expect(response.status).toBe(200);
    expect(bodyJson.ok).toBe(true);
    expect(selectProductForSession).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({ id: "PWM02.020", productType: "wall_cladding" }),
    );
  });

  it("still rejects when there is truly no selected product on the session", async () => {
    vi.mocked(getSessionById).mockResolvedValue({
      ...wallCladdingSession,
      selectedProduct: null,
      selectedProductsBySurface: undefined,
    });

    const response = await POST(makeRequest({ sessionId: SESSION_ID }));
    const bodyJson = await response.json();

    expect(response.status).toBe(404);
    expect(bodyJson.code).toBe("PRODUCT_NOT_FOUND");
  });
});
