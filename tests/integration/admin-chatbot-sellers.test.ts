import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// Fake Prisma known-error class so tests can simulate a unique-constraint (P2002)
// without loading the generated client engine. Defined via vi.hoisted so the
// (hoisted) vi.mock factory below can reference it.
const { FakeKnownError } = vi.hoisted(() => {
  class FakeKnownError extends Error {
    code: string;
    constructor(code: string) {
      super("known error");
      this.code = code;
    }
  }
  return { FakeKnownError };
});

vi.mock("@/lib/admin/require-admin", () => ({ requireAdminResponse: vi.fn() }));
vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    seller: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    showroom: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/generated/prisma", () => ({
  Prisma: { PrismaClientKnownRequestError: FakeKnownError },
}));
vi.mock("@/lib/logger", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { GET, POST } from "@/app/api/admin/chatbot/sellers/route";
import { PATCH } from "@/app/api/admin/chatbot/sellers/[id]/route";
import { requireAdminResponse } from "@/lib/admin/require-admin";
import { prisma } from "@/lib/server/prisma";
import { verifyPassword } from "@/lib/seller/password";

const authMock = requireAdminResponse as unknown as ReturnType<typeof vi.fn>;
const sellerDb = prisma.seller as unknown as Record<string, ReturnType<typeof vi.fn>>;
const showroomDb = prisma.showroom as unknown as Record<string, ReturnType<typeof vi.fn>>;

function reqJson(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const sellerRow = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  name: "Test Seller",
  sellerCode: "S-001",
  status: "disabled",
  tokenVersion: 0,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  showroom: { id: "sh1", code: "RIYADH", name: "Riyadh" },
  ...over,
});

function expectNoSensitiveFields(payload: unknown) {
  const text = JSON.stringify(payload);
  expect(text).not.toContain("passwordHash");
  expect(text).not.toContain("seller-pass-1");
  expect(text).not.toContain("new-pass-12");
  expect(text).not.toContain("INTERNAL_JWT_SECRET");
  expect(text).not.toContain("EXTERNAL_SELLER_JWT_SECRET");
  expect(text).not.toContain("SELLER_SESSION_SECRET");
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue(null); // authorized by default
});

describe("admin chatbot sellers - authorization", () => {
  it("GET returns 401 when there is no admin session", async () => {
    authMock.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    const res = await GET(reqJson("http://localhost/api/admin/chatbot/sellers", "GET"));
    expect(res.status).toBe(401);
    expect(sellerDb.findMany).not.toHaveBeenCalled();
  });

  it("POST returns 401 when there is no admin session", async () => {
    authMock.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    const res = await POST(reqJson("http://localhost/api/admin/chatbot/sellers", "POST", {}));
    expect(res.status).toBe(401);
    expect(sellerDb.create).not.toHaveBeenCalled();
  });

  it("PATCH returns 401 when there is no admin session", async () => {
    authMock.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    const res = await PATCH(reqJson("http://localhost/x", "PATCH", { action: "force_logout" }), {
      params: Promise.resolve({ id: "s1" }),
    });
    expect(res.status).toBe(401);
    expect(sellerDb.update).not.toHaveBeenCalled();
  });
});

describe("admin chatbot sellers - list", () => {
  it("returns only safe fields and builds the search/filter where clause", async () => {
    sellerDb.findMany.mockResolvedValue([sellerRow()]);
    const res = await GET(
      reqJson("http://localhost/api/admin/chatbot/sellers?q=S-001&showroomId=sh1&status=disabled", "GET"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expectNoSensitiveFields(body);
    expect(body.sellers[0].sellerCode).toBe("S-001");
    const where = sellerDb.findMany.mock.calls[0][0].where;
    expect(where.showroomId).toBe("sh1");
    expect(where.status).toBe("disabled");
    expect(where.OR).toBeTruthy();
  });
});

describe("admin chatbot sellers - create", () => {
  it("hashes the password, normalizes the code, defaults status disabled, returns no hash", async () => {
    showroomDb.findUnique.mockResolvedValue({ id: "sh1" });
    sellerDb.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      sellerRow({ sellerCode: data.sellerCode, status: data.status }),
    );
    const res = await POST(
      reqJson("http://localhost/api/admin/chatbot/sellers", "POST", {
        name: "New Seller",
        sellerCode: "  s-009 ",
        showroomId: "sh1",
        password: "seller-pass-1",
      }),
    );
    expect(res.status).toBe(201);
    const data = sellerDb.create.mock.calls[0][0].data;
    // normalized (trim + uppercase)
    expect(data.sellerCode).toBe("S-009");
    // default status
    expect(data.status).toBe("disabled");
    // plaintext never stored; hash verifies
    expect(data.passwordHash).not.toBe("seller-pass-1");
    expect(Object.keys(data)).not.toContain("password");
    expect(await verifyPassword("seller-pass-1", data.passwordHash as string)).toBe(true);
    const body = await res.json();
    expectNoSensitiveFields(body);
  });

  it("rejects a duplicate normalized seller code with 409", async () => {
    showroomDb.findUnique.mockResolvedValue({ id: "sh1" });
    sellerDb.create.mockRejectedValue(new FakeKnownError("P2002"));
    const res = await POST(
      reqJson("http://localhost/api/admin/chatbot/sellers", "POST", {
        name: "Dup",
        sellerCode: "S-001",
        showroomId: "sh1",
        password: "seller-pass-1",
      }),
    );
    expect(res.status).toBe(409);
  });

  it("rejects an invalid showroom with 400", async () => {
    showroomDb.findUnique.mockResolvedValue(null);
    const res = await POST(
      reqJson("http://localhost/api/admin/chatbot/sellers", "POST", {
        name: "X",
        sellerCode: "S-010",
        showroomId: "missing",
        password: "seller-pass-1",
      }),
    );
    expect(res.status).toBe(400);
    expect(sellerDb.create).not.toHaveBeenCalled();
  });

  it("can create an active seller only when explicitly selected", async () => {
    showroomDb.findUnique.mockResolvedValue({ id: "sh1" });
    sellerDb.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      sellerRow({ status: data.status }),
    );
    await POST(
      reqJson("http://localhost/api/admin/chatbot/sellers", "POST", {
        name: "Active One",
        sellerCode: "S-011",
        showroomId: "sh1",
        password: "seller-pass-1",
        status: "active",
      }),
    );
    expect(sellerDb.create.mock.calls[0][0].data.status).toBe("active");
  });
});

describe("admin chatbot sellers - actions (session invalidation)", () => {
  function ctx(id = "s1") {
    return { params: Promise.resolve({ id }) };
  }

  beforeEach(() => {
    sellerDb.findUnique.mockResolvedValue({ id: "s1" });
    sellerDb.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      sellerRow({ ...data }),
    );
  });

  it("disable sets status disabled AND bumps tokenVersion", async () => {
    const res = await PATCH(reqJson("http://localhost/x", "PATCH", { action: "disable" }), ctx());
    const data = sellerDb.update.mock.calls[0][0].data;
    expect(data.status).toBe("disabled");
    expect(data.tokenVersion).toEqual({ increment: 1 });
    expectNoSensitiveFields(await res.json());
  });

  it("reset_password bumps tokenVersion and stores a hash (not the plaintext)", async () => {
    await PATCH(
      reqJson("http://localhost/x", "PATCH", { action: "reset_password", password: "new-pass-12" }),
      ctx(),
    );
    const data = sellerDb.update.mock.calls[0][0].data;
    expect(data.tokenVersion).toEqual({ increment: 1 });
    expect(data.passwordHash).not.toBe("new-pass-12");
    expect(await verifyPassword("new-pass-12", data.passwordHash as string)).toBe(true);
  });

  it("force_logout bumps ONLY tokenVersion", async () => {
    await PATCH(reqJson("http://localhost/x", "PATCH", { action: "force_logout" }), ctx());
    const data = sellerDb.update.mock.calls[0][0].data;
    expect(data).toEqual({ tokenVersion: { increment: 1 } });
  });

  it("activate sets status active (no tokenVersion bump)", async () => {
    await PATCH(reqJson("http://localhost/x", "PATCH", { action: "activate" }), ctx());
    const data = sellerDb.update.mock.calls[0][0].data;
    expect(data.status).toBe("active");
    expect(data.tokenVersion).toBeUndefined();
  });

  it("changing showroom bumps tokenVersion", async () => {
    showroomDb.findUnique.mockResolvedValue({ id: "sh2" });
    await PATCH(
      reqJson("http://localhost/x", "PATCH", { action: "update_profile", showroomId: "sh2" }),
      ctx(),
    );
    const data = sellerDb.update.mock.calls[0][0].data;
    expect(data.tokenVersion).toEqual({ increment: 1 });
    expect(data.showroom).toEqual({ connect: { id: "sh2" } });
  });

  it("rejects a browser attempt to set tokenVersion/status directly (strict schema -> 400)", async () => {
    const res = await PATCH(
      reqJson("http://localhost/x", "PATCH", { action: "update_profile", tokenVersion: 99, status: "active" }),
      ctx(),
    );
    expect(res.status).toBe(400);
    expect(sellerDb.update).not.toHaveBeenCalled();
  });
});
