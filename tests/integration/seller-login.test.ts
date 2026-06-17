import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// Mock the infra the login route depends on (DB, rate-limit, logger). The
// password (bcrypt) and session (jose) modules run for real.
vi.mock("@/lib/server/prisma", () => ({
  prisma: { seller: { findUnique: vi.fn() } },
}));
vi.mock("@/lib/ip-rate-limit", () => ({
  checkIpRateLimit: vi.fn().mockResolvedValue({ limited: false }),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));
vi.mock("@/lib/logger", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { POST } from "@/app/api/seller/auth/login/route";
import { prisma } from "@/lib/server/prisma";
import { checkIpRateLimit } from "@/lib/ip-rate-limit";
import { hashPassword } from "@/lib/seller/password";
import { SELLER_SESSION_COOKIE } from "@/lib/seller/session";

const findUnique = prisma.seller.findUnique as unknown as ReturnType<typeof vi.fn>;
const rateLimit = checkIpRateLimit as unknown as ReturnType<typeof vi.fn>;

let PASSWORD_HASH: string;
const PASSWORD = "seller-pass-1";

function post(body: unknown): Request {
  return new Request("http://localhost/api/seller/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const activeSeller = () => ({
  id: "s1",
  passwordHash: PASSWORD_HASH,
  status: "active" as const,
  tokenVersion: 0,
  showroom: { code: "RIYADH" },
});

beforeAll(async () => {
  PASSWORD_HASH = await hashPassword(PASSWORD);
});

beforeEach(() => {
  vi.clearAllMocks();
  rateLimit.mockResolvedValue({ limited: false });
});

const GENERIC = "بيانات الدخول غير صحيحة.";

describe("POST /api/seller/auth/login", () => {
  it("sets a seller_session cookie on valid credentials", async () => {
    findUnique.mockResolvedValue(activeSeller());
    const res = await POST(
      post({ sellerCode: "s001", showroomCode: "riyadh", password: PASSWORD }),
    );
    expect(res.status).toBe(200);
    // Lookup used the NORMALIZED (uppercased) seller code.
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sellerCode: "S001" } }),
    );
    const cookie = res.cookies.get(SELLER_SESSION_COOKIE);
    expect(cookie?.value).toBeTruthy();
    expect(cookie?.httpOnly).toBe(true);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, redirectTo: "/seller/chat" });
  });

  it("returns the SAME generic 401 for unknown seller", async () => {
    findUnique.mockResolvedValue(null);
    const res = await POST(
      post({ sellerCode: "nope", showroomCode: "riyadh", password: PASSWORD }),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe(GENERIC);
    expect(res.cookies.get(SELLER_SESSION_COOKIE)?.value).toBeFalsy();
  });

  it("returns the SAME generic 401 for wrong showroom relationship", async () => {
    findUnique.mockResolvedValue({ ...activeSeller(), showroom: { code: "JEDDAH" } });
    const res = await POST(
      post({ sellerCode: "s001", showroomCode: "riyadh", password: PASSWORD }),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe(GENERIC);
  });

  it("returns the SAME generic 401 for wrong password", async () => {
    findUnique.mockResolvedValue(activeSeller());
    const res = await POST(
      post({ sellerCode: "s001", showroomCode: "riyadh", password: "wrong-pass-9" }),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe(GENERIC);
  });

  it("returns 403 disabled only AFTER correct credentials + showroom match", async () => {
    findUnique.mockResolvedValue({ ...activeSeller(), status: "disabled" });
    const res = await POST(
      post({ sellerCode: "s001", showroomCode: "riyadh", password: PASSWORD }),
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.code).toBe("disabled");
    expect(res.cookies.get(SELLER_SESSION_COOKIE)?.value).toBeFalsy();
  });

  it("returns 429 when rate limited (and never hits the DB)", async () => {
    rateLimit.mockResolvedValue({ limited: true, retryAfterSeconds: 30 });
    const res = await POST(
      post({ sellerCode: "s001", showroomCode: "riyadh", password: PASSWORD }),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed input (e.g. short password)", async () => {
    const res = await POST(
      post({ sellerCode: "s001", showroomCode: "riyadh", password: "short" }),
    );
    expect(res.status).toBe(400);
    expect(findUnique).not.toHaveBeenCalled();
  });
});
