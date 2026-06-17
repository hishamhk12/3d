import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/seller/auth", () => ({ getCurrentSeller: vi.fn() }));

import { jwtVerify } from "jose";
import { GET } from "@/app/api/seller/inventory/code-suggestions/route";
import { getCurrentSeller } from "@/lib/seller/auth";

const getSeller = getCurrentSeller as unknown as ReturnType<typeof vi.fn>;
const FASTAPI_URL = "http://fastapi.internal:8001";
const EXTERNAL_SECRET = "external-seller-secret-0123456789abcdef-strong";
const SELLER = {
  id: "seller-123",
  name: "بائع",
  sellerCode: "S-1",
  showroomId: "showroom-abc",
  showroomCode: "RIYADH",
};

function get(url: string): Request {
  return new Request(url, { method: "GET" });
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

describe("GET /api/seller/inventory/code-suggestions", () => {
  it("rejects an unauthenticated request with 401 (no upstream call)", async () => {
    getSeller.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await GET(get("http://localhost/api/seller/inventory/code-suggestions?q=CRPT"));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 503 when the feature flag is disabled", async () => {
    vi.stubEnv("SELLER_CHAT_ENABLED", "false");
    const res = await GET(get("http://localhost/api/seller/inventory/code-suggestions?q=CRPT"));
    expect(res.status).toBe(503);
  });

  it("returns [] for an empty query without calling FastAPI", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await GET(get("http://localhost/api/seller/inventory/code-suggestions?q="));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mints the external token from the SESSION and forwards only the typed q; identity query params are ignored", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ code: "CRPT050.006", label: "CRPT050.006" }]), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(
      get("http://localhost/api/seller/inventory/code-suggestions?q=CRPT&sellerId=evil&showroomId=x"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([{ code: "CRPT050.006", label: "CRPT050.006" }]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${FASTAPI_URL}/internal/inventory/code-suggestions?q=CRPT`);
    const token = (init.headers.Authorization as string).slice("Bearer ".length);
    const { payload } = await jwtVerify(token, new TextEncoder().encode(EXTERNAL_SECRET), {
      issuer: "3d-app",
      audience: "fastapi",
    });
    expect(payload.sub).toBe(`3d-seller:${SELLER.id}`);
    expect(payload.showroomId).toBe(SELLER.showroomId); // from session, NOT the ?showroomId=x
    expect(payload.actorType).toBe("external_seller");
  });

  it("returns CODE-ONLY items even if upstream sends extra fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([{ code: "X", label: "X", availableToSell: 99, secretField: "leak" }]),
          { status: 200 },
        ),
      ),
    );
    const res = await GET(get("http://localhost/api/seller/inventory/code-suggestions?q=X"));
    const body = await res.json();
    expect(body).toEqual([{ code: "X", label: "X" }]);
    expect(JSON.stringify(body)).not.toContain("leak");
  });

  it("degrades to [] on an upstream failure (never leaks detail)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 500 })));
    const res = await GET(get("http://localhost/api/seller/inventory/code-suggestions?q=CRPT"));
    expect(res.status).toBe(200);
    const text = JSON.stringify(await res.json());
    expect(text).toBe("[]");
    expect(text).not.toContain(EXTERNAL_SECRET);
    expect(text).not.toContain(FASTAPI_URL);
  });
});
