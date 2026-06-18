import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/admin/require-admin", () => ({ requireAdminResponse: vi.fn() }));
vi.mock("@/lib/admin/fastapi-internal", () => ({ internalAdminFetchJson: vi.fn() }));
vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    seller: { findMany: vi.fn() },
  },
}));

import * as historyRoute from "@/app/api/admin/chatbot/import/history/route";
import * as metricsRoute from "@/app/api/admin/chatbot/metrics/route";
import { requireAdminResponse } from "@/lib/admin/require-admin";
import { internalAdminFetchJson } from "@/lib/admin/fastapi-internal";
import { prisma } from "@/lib/server/prisma";

const authMock = requireAdminResponse as unknown as ReturnType<typeof vi.fn>;
const fastapiMock = internalAdminFetchJson as unknown as ReturnType<typeof vi.fn>;
const sellerFindManyMock = prisma.seller.findMany as unknown as ReturnType<typeof vi.fn>;

const SECRET = "internal-admin-secret-32-bytes-long";
const FASTAPI_URL = "https://fastapi.internal.local";
const DB_URL = "postgres://private-db.internal/app";
const JWT = "eyJ.internal.jwt";

function expectNoLeak(body: unknown) {
  const text = JSON.stringify(body);
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
    "stack",
    "full question",
    "full answer",
    "confirmationId",
    "confirmation-secret",
  ]) {
    expect(text).not.toContain(forbidden);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue(null);
  sellerFindManyMock.mockResolvedValue([]);
});

describe("admin chatbot import history route", () => {
  it("requires admin session", async () => {
    authMock.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

    const res = await historyRoute.GET();

    expect(res.status).toBe(401);
    expect(fastapiMock).not.toHaveBeenCalled();
  });

  it("does not authorize seller/customer cookies", async () => {
    authMock.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

    expect((await historyRoute.GET()).status).toBe(401);
    expect(fastapiMock).not.toHaveBeenCalled();
  });

  it("returns safe import history fields only", async () => {
    fastapiMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        status: "ready",
        items: [
          {
            timestamp: "2026-06-17T09:00:00",
            filename: "inventory.xlsx",
            status: "success",
            rowsImported: 120,
            rowsFailed: 2,
            errorMessage: `raw ${FASTAPI_URL}`,
            confirmationId: "confirmation-secret",
          },
        ],
      },
    });

    const res = await historyRoute.GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(fastapiMock).toHaveBeenCalledWith("/internal/import/inventory/history");
    expect(body).toEqual({
      status: "ready",
      items: [
        {
          timestamp: "2026-06-17T09:00:00",
          filename: "inventory.xlsx",
          status: "success",
          rowsImported: 120,
          rowsFailed: 2,
        },
      ],
    });
    expectNoLeak(body);
  });

  it("maps unavailable FastAPI safely", async () => {
    fastapiMock.mockResolvedValue({
      ok: false,
      error: { code: "network", message: `${FASTAPI_URL} ${SECRET} Traceback stack` },
    });

    const res = await historyRoute.GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.items).toEqual([]);
    expect(body.error).toBe("Import history is temporarily unavailable.");
    expectNoLeak(body);
  });
});

describe("admin chatbot metrics route", () => {
  function upstreamMetrics() {
    fastapiMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        status: "ready",
        questionsToday: 4,
        questionsThisWeek: 11,
        distinctExternalSellers: 2,
        topProductCodes: [{ value: "P-100", count: 3 }],
        topWarehouses: [{ value: "RUH", count: 5 }],
        aiVsFallback: { ai: 7, fallback: 4 },
        recentActivity: [
          {
            timestamp: "2026-06-17T09:00:00",
            externalActorId: "3d-seller:seller-1",
            productCode: "P-100",
            warehouse: "RUH",
            intent: "ai:availability",
            question: `full question ${FASTAPI_URL}`,
            answer: `full answer ${DB_URL}`,
          },
          {
            timestamp: "2026-06-17T08:00:00",
            externalActorId: "3d-seller:deleted-seller",
            productCode: "P-200",
            warehouse: null,
            intent: "deterministic:price",
          },
        ],
      },
    });
  }

  it("requires admin session", async () => {
    authMock.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

    const res = await metricsRoute.GET();

    expect(res.status).toBe(401);
    expect(fastapiMock).not.toHaveBeenCalled();
  });

  it("does not authorize seller/customer cookies", async () => {
    authMock.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

    expect((await metricsRoute.GET()).status).toBe(401);
    expect(fastapiMock).not.toHaveBeenCalled();
  });

  it("returns aggregates, maps namespaced sellers, and omits question/answer", async () => {
    upstreamMetrics();
    sellerFindManyMock.mockResolvedValue([
      {
        id: "seller-1",
        sellerCode: "S-001",
        name: "Seller One",
        showroom: { code: "RIYADH" },
        passwordHash: "never",
      },
    ]);

    const res = await metricsRoute.GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(fastapiMock).toHaveBeenCalledWith("/internal/admin/chatbot-metrics");
    expect(sellerFindManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["seller-1", "deleted-seller"] } },
      select: {
        id: true,
        sellerCode: true,
        name: true,
        showroom: { select: { code: true } },
      },
    });
    expect(body.questionsToday).toBe(4);
    expect(body.questionsThisWeek).toBe(11);
    expect(body.distinctExternalSellers).toBe(2);
    expect(body.topProductCodes).toEqual([{ value: "P-100", count: 3 }]);
    expect(body.topWarehouses).toEqual([{ value: "RUH", count: 5 }]);
    expect(body.aiVsFallback).toEqual({ ai: 7, fallback: 4 });
    expect(body.recentActivity[0]).toEqual({
      timestamp: "2026-06-17T09:00:00",
      externalActorId: "3d-seller:seller-1",
      productCode: "P-100",
      warehouse: "RUH",
      intent: "ai:availability",
      seller: {
        sellerCode: "S-001",
        sellerName: "Seller One",
        showroomCode: "RIYADH",
        available: true,
      },
    });
    expect(body.recentActivity[1].seller).toEqual({
      sellerCode: null,
      sellerName: null,
      showroomCode: null,
      available: false,
    });
    expectNoLeak(body);
  });

  it("handles missing seller mapping safely", async () => {
    upstreamMetrics();
    sellerFindManyMock.mockResolvedValue([]);

    const res = await metricsRoute.GET();
    const body = await res.json();

    expect(body.recentActivity[0].seller.available).toBe(false);
    expect(body.recentActivity[0].seller.sellerCode).toBeNull();
    expectNoLeak(body);
  });

  it("maps unavailable FastAPI safely", async () => {
    fastapiMock.mockResolvedValue({
      ok: false,
      error: { code: "timeout", message: `${FASTAPI_URL} ${SECRET} ${JWT} ${DB_URL}` },
    });

    const res = await metricsRoute.GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.questionsToday).toBe(0);
    expect(body.recentActivity).toEqual([]);
    expect(body.error).toBe("Chatbot metrics are temporarily unavailable.");
    expectNoLeak(body);
  });
});
