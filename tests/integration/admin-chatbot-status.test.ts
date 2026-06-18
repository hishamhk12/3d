import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/admin/require-admin", () => ({ requireAdminResponse: vi.fn() }));
vi.mock("@/lib/admin/fastapi-internal", () => ({ internalAdminFetchJson: vi.fn() }));
vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    seller: { count: vi.fn() },
    showroom: { count: vi.fn() },
  },
}));
vi.mock("@/lib/seller/fastapi", () => ({ isSellerChatEnabled: vi.fn() }));

import { GET } from "@/app/api/admin/chatbot/status/route";
import { requireAdminResponse } from "@/lib/admin/require-admin";
import { internalAdminFetchJson } from "@/lib/admin/fastapi-internal";
import { prisma } from "@/lib/server/prisma";
import { isSellerChatEnabled } from "@/lib/seller/fastapi";

const authMock = requireAdminResponse as unknown as ReturnType<typeof vi.fn>;
const fastapiMock = internalAdminFetchJson as unknown as ReturnType<typeof vi.fn>;
const sellerCountMock = prisma.seller.count as unknown as ReturnType<typeof vi.fn>;
const showroomCountMock = prisma.showroom.count as unknown as ReturnType<typeof vi.fn>;
const sellerChatEnabledMock = isSellerChatEnabled as unknown as ReturnType<typeof vi.fn>;

const SECRET = "internal-admin-secret-32-bytes-long";
const FASTAPI_URL = "https://fastapi.internal.local";
const DB_URL = "postgres://private-db.internal/app";
const JWT = "eyJ.internal.jwt";

function safeText(body: unknown): string {
  return JSON.stringify(body);
}

function expectNoLeak(body: unknown) {
  const text = safeText(body);
  for (const forbidden of [
    SECRET,
    FASTAPI_URL,
    DB_URL,
    JWT,
    "Authorization",
    "Bearer ",
    "INTERNAL_JWT_SECRET",
    "CHATBOT_FASTAPI_URL",
    "DATABASE_URL",
    "Traceback",
    "SyntaxError",
    "stack",
  ]) {
    expect(text).not.toContain(forbidden);
  }
}

function upstreamOk() {
  fastapiMock.mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      service: { status: "ready", ready: true },
      database: { status: "ready", reachable: true },
      gemini: { status: "degraded", configured: false },
      inventory: { status: "ready", rowCount: 321 },
      imports: { status: "ready", latestSuccessfulImportAt: "2026-06-17T08:30:00" },
      dataSource: "excel",
      sap: { status: "not_configured", configured: false },
      features: {
        sellerChatEnabled: true,
        autocompleteEnabled: true,
        technicalDocumentsEnabled: false,
        voiceEnabled: false,
        webKnowledgeEnabled: false,
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue(null);
  sellerCountMock.mockResolvedValue(5);
  showroomCountMock.mockResolvedValue(2);
  sellerChatEnabledMock.mockReturnValue(true);
  upstreamOk();
});

describe("admin chatbot status route", () => {
  it("returns 401 for unauthenticated requests", async () => {
    authMock.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

    const res = await GET();

    expect(res.status).toBe(401);
    expect(fastapiMock).not.toHaveBeenCalled();
    expect(sellerCountMock).not.toHaveBeenCalled();
  });

  it("does not authorize seller cookies", async () => {
    authMock.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

    const res = await GET();

    expect(res.status).toBe(401);
    expect(fastapiMock).not.toHaveBeenCalled();
  });

  it("does not authorize customer cookies", async () => {
    authMock.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

    const res = await GET();

    expect(res.status).toBe(401);
    expect(fastapiMock).not.toHaveBeenCalled();
  });

  it("returns normalized safe status for a valid admin", async () => {
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(fastapiMock).toHaveBeenCalledTimes(1);
    expect(fastapiMock).toHaveBeenCalledWith("/internal/admin/chatbot-status");
    expect(body.fastapi).toEqual({ status: "healthy", reachable: true });
    expect(body.database).toEqual({ status: "healthy", reachable: true });
    expect(body.gemini).toEqual({ status: "degraded", configured: false });
    expect(body.inventory).toEqual({ status: "healthy", rowCount: 321 });
    expect(body.imports).toEqual({
      status: "healthy",
      latestSuccessfulImportAt: "2026-06-17T08:30:00",
    });
    expect(body.dataSource).toEqual({ status: "healthy", current: "excel" });
    expect(body.sap).toEqual({ status: "not_configured", configured: false });
    expect(body.local).toEqual({
      status: "healthy",
      sellerCount: 5,
      showroomCount: 2,
      sellerChatEnabled: true,
    });
    expect(body.features.sellerChat).toEqual({ status: "healthy", enabled: true });
    expect(body.features.autocomplete).toEqual({ status: "healthy", enabled: true });
    expectNoLeak(body);
  });

  it.each([401, 403])("maps FastAPI %s safely", async (status) => {
    fastapiMock.mockResolvedValue({
      ok: false,
      status,
      error: {
        code: "upstream",
        message: `raw ${status} ${FASTAPI_URL} ${SECRET} Authorization Bearer ${JWT}`,
      },
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.fastapi.status).toBe("degraded");
    expect(body.database.status).toBe("unavailable");
    expect(body.local.sellerCount).toBe(5);
    expectNoLeak(body);
  });

  it.each(["timeout", "network"])("maps FastAPI %s failure safely", async (code) => {
    fastapiMock.mockResolvedValue({
      ok: false,
      error: { code, message: `raw ${FASTAPI_URL} ${DB_URL} ${SECRET}` },
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.fastapi.status).toBe("unavailable");
    expect(body.inventory.rowCount).toBeNull();
    expect(body.local.showroomCount).toBe(2);
    expectNoLeak(body);
  });

  it("maps invalid JSON safely", async () => {
    fastapiMock.mockResolvedValue({
      ok: false,
      status: 200,
      error: { code: "invalid_json", message: `SyntaxError ${DB_URL} Traceback ${SECRET}` },
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.fastapi.status).toBe("unavailable");
    expect(body.imports.latestSuccessfulImportAt).toBeNull();
    expectNoLeak(body);
  });

  it("includes seller/showroom counts and seller chat disabled flag", async () => {
    sellerCountMock.mockResolvedValue(9);
    showroomCountMock.mockResolvedValue(4);
    sellerChatEnabledMock.mockReturnValue(false);

    const res = await GET();
    const body = await res.json();

    expect(body.local.sellerCount).toBe(9);
    expect(body.local.showroomCount).toBe(4);
    expect(body.local.sellerChatEnabled).toBe(false);
    expect(body.features.sellerChat).toEqual({ status: "disabled", enabled: false });
    expectNoLeak(body);
  });
});

