import { describe, expect, it, vi } from "vitest";

// Mock Prisma and Redis before importing the route handler
vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  },
}));

vi.mock("@/lib/redis", () => ({
  isRedisEnabled: vi.fn().mockReturnValue(false),
  getRedisPublisher: vi.fn(),
}));

// Lazy import so mocks are applied first
const { GET } = await import("@/app/api/health/route");
const { prisma } = await import("@/lib/server/prisma");
const { isRedisEnabled, getRedisPublisher } = await import("@/lib/redis");

describe("GET /api/health", () => {
  it("returns 200 and status ok when DB is healthy", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ "?column?": 1 }]);
    vi.mocked(isRedisEnabled).mockReturnValue(false);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.checks.database).toBe("ok");
    expect(body.checks.redis).toBeUndefined();
    expect(typeof body.ts).toBe("string");
  });

  it("returns 503 and status degraded when DB fails", async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(new Error("connection refused"));
    vi.mocked(isRedisEnabled).mockReturnValue(false);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.checks.database).toBe("error");
  });

  it("includes redis check when Redis is enabled and healthy", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([]);
    vi.mocked(isRedisEnabled).mockReturnValue(true);
    vi.mocked(getRedisPublisher).mockReturnValue({ ping: vi.fn().mockResolvedValue("PONG") } as never);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.checks.redis).toBe("ok");
  });

  it("returns 503 when Redis is enabled but fails", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([]);
    vi.mocked(isRedisEnabled).mockReturnValue(true);
    vi.mocked(getRedisPublisher).mockReturnValue({
      ping: vi.fn().mockRejectedValue(new Error("redis down")),
    } as never);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.checks.redis).toBe("error");
  });

  it("response body includes a valid ISO timestamp", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([]);
    vi.mocked(isRedisEnabled).mockReturnValue(false);

    const response = await GET();
    const body = await response.json();

    expect(() => new Date(body.ts)).not.toThrow();
    expect(new Date(body.ts).toISOString()).toBe(body.ts);
  });
});
