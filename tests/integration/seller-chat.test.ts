import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the seller session + logger; the FastAPI helper (jose mint + fetch) runs
// for real, with `fetch` stubbed so we can inspect the outgoing request and
// simulate every upstream condition. getCurrentSeller stands in for the verified
// 3d session (it returns null for missing/disabled/stale sellers).
vi.mock("@/lib/seller/auth", () => ({
  getCurrentSeller: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { jwtVerify } from "jose";
import { POST } from "@/app/api/seller/chat/route";
import { getCurrentSeller } from "@/lib/seller/auth";

const getSeller = getCurrentSeller as unknown as ReturnType<typeof vi.fn>;

const FASTAPI_URL = "http://fastapi.internal:8001";
const EXTERNAL_SECRET = "external-seller-secret-0123456789abcdef-strong";
const SELLER = {
  id: "seller-123",
  name: "بائع تجريبي",
  sellerCode: "S-001",
  showroomId: "showroom-abc",
  showroomCode: "RIYADH",
};

function req(body: unknown, raw = false): Request {
  return new Request("http://localhost/api/seller/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

function upstreamOk(extra: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      answer: "المتوفر 45 قطعة في الرياض.",
      cards: [{ productCode: "CRPT050.006", warehouse: "Riyadh" }],
      mode: "deterministic",
      intent: "warehouse_stock_lookup",
      productCode: "CRPT050.006",
      warehouse: "Riyadh",
      debug: { provider: "none", fallbackReason: "no_api_key" },
      ...extra,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CHATBOT_FASTAPI_URL", FASTAPI_URL);
  vi.stubEnv("EXTERNAL_SELLER_JWT_SECRET", EXTERNAL_SECRET);
  vi.stubEnv("SELLER_CHAT_ENABLED", "");
  getSeller.mockResolvedValue(SELLER);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/seller/chat", () => {
  it("returns 401 when there is no active seller session", async () => {
    getSeller.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(req({ question: "كم باقي؟" }));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a disabled/stale seller (getCurrentSeller=null) as unauthorized", async () => {
    // auth.getCurrentSeller already returns null for disabled/stale accounts.
    getSeller.mockResolvedValue(null);
    const res = await POST(req({ question: "كم باقي؟" }));
    expect(res.status).toBe(401);
  });

  it("returns 503 when the feature flag is disabled (before touching the session)", async () => {
    vi.stubEnv("SELLER_CHAT_ENABLED", "false");
    const res = await POST(req({ question: "كم باقي؟" }));
    expect(res.status).toBe(503);
    expect(getSeller).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await POST(req("{not json", true));
    expect(res.status).toBe(400);
  });

  it("returns 400 for an empty question", async () => {
    const res = await POST(req({ question: "   " }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for an over-long question", async () => {
    const res = await POST(req({ question: "x".repeat(501) }));
    expect(res.status).toBe(400);
  });

  it("rejects browser-supplied identity fields (strict schema → 400)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(upstreamOk());
    vi.stubGlobal("fetch", fetchMock);
    for (const inject of [
      { sellerId: "evil" },
      { showroomId: "evil-showroom" },
      { actorType: "external_seller" },
      { role: "admin" },
    ]) {
      const res = await POST(req({ question: "كم باقي؟", ...inject }));
      expect(res.status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mints the external token from the SESSION seller, not the body, and forwards only {question, style}", async () => {
    const fetchMock = vi.fn().mockResolvedValue(upstreamOk());
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(req({ question: "  كم باقي من CRPT050.006؟  ", style: "precise" }));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${FASTAPI_URL}/internal/chat`);

    // Outgoing body carries ONLY the chat fields (identity never travels in body).
    const sentBody = JSON.parse(init.body);
    expect(sentBody).toEqual({ question: "كم باقي من CRPT050.006؟", style: "precise" });

    // The Authorization bearer is a valid external-seller token whose identity is
    // derived from the session seller.
    const authz: string = init.headers.Authorization;
    expect(authz.startsWith("Bearer ")).toBe(true);
    const token = authz.slice("Bearer ".length);
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(EXTERNAL_SECRET),
      { issuer: "3d-app", audience: "fastapi" },
    );
    expect(payload.sub).toBe(`3d-seller:${SELLER.id}`);
    expect(payload.actorType).toBe("external_seller");
    expect(payload.showroomId).toBe(SELLER.showroomId);
    expect(payload.role).toBeUndefined();
    expect(typeof payload.exp).toBe("number");
    expect((payload.exp as number) - (payload.iat as number)).toBeLessThanOrEqual(120);
  });

  it("returns the chatbot shape on success, with internal `debug` stripped", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(upstreamOk()));
    const res = await POST(req({ question: "كم باقي من CRPT050.006؟" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({
      answer: expect.any(String),
      mode: "deterministic",
      intent: "warehouse_stock_lookup",
      productCode: "CRPT050.006",
      warehouse: "Riyadh",
    });
    expect(Array.isArray(data.cards)).toBe(true);
    expect(data.debug).toBeUndefined(); // internal-only detail not exposed
  });

  it("maps FastAPI 401/403 to a safe 502 (no upstream details)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 })),
    );
    const res = await POST(req({ question: "كم باقي؟" }));
    expect(res.status).toBe(502);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("unauthorized");
    expect(text).not.toContain("401");
  });

  it("maps FastAPI 5xx to a safe 502", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("boom", { status: 500 })),
    );
    const res = await POST(req({ question: "كم باقي؟" }));
    expect(res.status).toBe(502);
  });

  it("maps a timeout (AbortError) to a safe 504", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" })),
    );
    const res = await POST(req({ question: "كم باقي؟" }));
    expect(res.status).toBe(504);
  });

  it("maps a network failure to a safe 503", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const res = await POST(req({ question: "كم باقي؟" }));
    expect(res.status).toBe(503);
  });

  it("maps an invalid upstream JSON body to a safe 502", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("not json at all", { status: 200 })),
    );
    const res = await POST(req({ question: "كم باقي؟" }));
    expect(res.status).toBe(502);
  });

  it("never leaks the FastAPI URL or the JWT secret in any response body", async () => {
    const cases: Response[] = [
      upstreamOk(),
      new Response("unauthorized", { status: 401 }),
      new Response("boom", { status: 500 }),
    ];
    for (const upstream of cases) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(upstream));
      const res = await POST(req({ question: "كم باقي؟" }));
      const text = JSON.stringify(await res.json());
      expect(text).not.toContain(EXTERNAL_SECRET);
      expect(text).not.toContain(FASTAPI_URL);
      expect(text.toLowerCase()).not.toContain("bearer");
    }
  });
});
