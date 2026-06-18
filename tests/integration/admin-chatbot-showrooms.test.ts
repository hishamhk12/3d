import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

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
  prisma: { showroom: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn() } },
}));
vi.mock("@/lib/generated/prisma", () => ({
  Prisma: { PrismaClientKnownRequestError: FakeKnownError },
}));
vi.mock("@/lib/logger", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { GET, POST } from "@/app/api/admin/chatbot/showrooms/route";
import { PATCH } from "@/app/api/admin/chatbot/showrooms/[id]/route";
import * as showroomDetail from "@/app/api/admin/chatbot/showrooms/[id]/route";
import { requireAdminResponse } from "@/lib/admin/require-admin";
import { prisma } from "@/lib/server/prisma";

const authMock = requireAdminResponse as unknown as ReturnType<typeof vi.fn>;
const db = prisma.showroom as unknown as Record<string, ReturnType<typeof vi.fn>>;

function reqJson(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const showroomRow = (over: Record<string, unknown> = {}) => ({
  id: "sh1",
  code: "RIYADH",
  name: "Riyadh",
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  _count: { sellers: 3 },
  ...over,
});

function expectNoSensitiveFields(payload: unknown) {
  const text = JSON.stringify(payload);
  expect(text).not.toContain("passwordHash");
  expect(text).not.toContain("INTERNAL_JWT_SECRET");
  expect(text).not.toContain("EXTERNAL_SELLER_JWT_SECRET");
  expect(text).not.toContain("SELLER_SESSION_SECRET");
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue(null);
});

describe("admin chatbot showrooms", () => {
  it("GET returns 401 without an admin session", async () => {
    authMock.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    const res = await GET(reqJson("http://localhost/api/admin/chatbot/showrooms", "GET"));
    expect(res.status).toBe(401);
    expect(db.findMany).not.toHaveBeenCalled();
  });

  it("PATCH returns 401 without an admin session", async () => {
    authMock.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    const res = await PATCH(reqJson("http://localhost/x", "PATCH", { name: "Nope" }), {
      params: Promise.resolve({ id: "sh1" }),
    });
    expect(res.status).toBe(401);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("lists showrooms with seller counts", async () => {
    db.findMany.mockResolvedValue([showroomRow()]);
    const res = await GET(reqJson("http://localhost/api/admin/chatbot/showrooms", "GET"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expectNoSensitiveFields(body);
    expect(body.showrooms[0].sellerCount).toBe(3);
    expect(body.showrooms[0].code).toBe("RIYADH");
  });

  it("creates a showroom with a normalized code", async () => {
    db.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      showroomRow({ code: data.code, name: data.name, _count: { sellers: 0 } }),
    );
    const res = await POST(
      reqJson("http://localhost/api/admin/chatbot/showrooms", "POST", { name: "Jeddah", code: " jeddah " }),
    );
    expect(res.status).toBe(201);
    expectNoSensitiveFields(await res.json());
    expect(db.create.mock.calls[0][0].data.code).toBe("JEDDAH");
  });

  it("rejects a duplicate normalized code with 409", async () => {
    db.create.mockRejectedValue(new FakeKnownError("P2002"));
    const res = await POST(
      reqJson("http://localhost/api/admin/chatbot/showrooms", "POST", { name: "Dup", code: "RIYADH" }),
    );
    expect(res.status).toBe(409);
  });

  it("edits a showroom name and code", async () => {
    db.findUnique.mockResolvedValue({ id: "sh1" });
    db.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      showroomRow({ ...data }),
    );
    const res = await PATCH(
      reqJson("http://localhost/x", "PATCH", { name: "Riyadh Main", code: "riyadh-1" }),
      { params: Promise.resolve({ id: "sh1" }) },
    );
    expect(res.status).toBe(200);
    const data = db.update.mock.calls[0][0].data;
    expect(data.name).toBe("Riyadh Main");
    expect(data.code).toBe("RIYADH-1"); // normalized
  });

  it("exposes NO delete handler (no destructive route this phase)", () => {
    expect((showroomDetail as Record<string, unknown>).DELETE).toBeUndefined();
  });
});
