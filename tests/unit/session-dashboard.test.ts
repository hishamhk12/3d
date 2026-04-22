import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock prisma before importing the module under test
// ---------------------------------------------------------------------------

const mockSessionCount = vi.fn();
const mockSessionFindMany = vi.fn();
const mockJobCount = vi.fn();
const mockJobFindMany = vi.fn();

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    roomPreviewSession: { count: mockSessionCount, findMany: mockSessionFindMany },
    renderJob: { count: mockJobCount, findMany: mockJobFindMany },
  },
}));

const { getDashboardMetrics, getDashboardSessions } = await import(
  "@/lib/admin/session-dashboard"
);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePrismaRow(overrides: Partial<{
  id: string;
  status: string;
  mobileConnected: boolean;
  renderCount: number;
  selectedProduct: null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
  _count: { renderJobs: number };
}> = {}) {
  return {
    id: "sess-1",
    status: "waiting_for_mobile",
    mobileConnected: false,
    renderCount: 0,
    selectedProduct: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour ahead
    _count: { renderJobs: 0 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSessionCount.mockResolvedValue(0);
  mockSessionFindMany.mockResolvedValue([]);
  mockJobCount.mockResolvedValue(0);
  mockJobFindMany.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// getDashboardMetrics — query filter structure
// ---------------------------------------------------------------------------

describe("getDashboardMetrics — live count filter", () => {
  it("uses expiresAt: { gt: now } for live count — not a null-inclusive OR", async () => {
    await getDashboardMetrics();

    // The first roomPreviewSession.count call is the live count query
    const firstCountCall = mockSessionCount.mock.calls[0]?.[0];
    expect(firstCountCall).toBeDefined();

    const where = firstCountCall.where;
    // Must have a direct expiresAt.gt filter
    expect(where.expiresAt?.gt).toBeInstanceOf(Date);
    // Must NOT use an OR that would let null expiresAt through
    expect(where.OR).toBeUndefined();
  });

  it("uses expiresAt: { gt: now } for waiting count — same logic as live", async () => {
    await getDashboardMetrics();

    // Second call is the waiting_for_mobile count
    const secondCountCall = mockSessionCount.mock.calls[1]?.[0];
    expect(secondCountCall).toBeDefined();

    const where = secondCountCall.where;
    expect(where.status).toBe("waiting_for_mobile");
    expect(where.expiresAt?.gt).toBeInstanceOf(Date);
    expect(where.OR).toBeUndefined();
  });

  it("returns zero live count when all sessions have null expiresAt", async () => {
    // Simulate: DB count returns 0 because expiresAt: { gt: now } filter excludes null rows
    mockSessionCount.mockResolvedValue(0);

    const metrics = await getDashboardMetrics();

    expect(metrics.liveCount).toBe(0);
    expect(metrics.waitingCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getDashboardSessions — group mapping
// ---------------------------------------------------------------------------

describe("getDashboardSessions — group and effectivelyExpired mapping", () => {
  it("live session with future expiresAt → group=live, effectivelyExpired=false", async () => {
    mockSessionFindMany.mockResolvedValueOnce([
      makePrismaRow({ expiresAt: new Date(Date.now() + 60_000) }),
    ]);

    const [session] = await getDashboardSessions();
    expect(session.group).toBe("live");
    expect(session.effectivelyExpired).toBe(false);
  });

  it("live session with past expiresAt → group=closed, effectivelyExpired=true", async () => {
    mockSessionFindMany.mockResolvedValueOnce([
      makePrismaRow({ expiresAt: new Date(Date.now() - 60_000) }),
    ]);

    const [session] = await getDashboardSessions();
    expect(session.group).toBe("closed");
    expect(session.effectivelyExpired).toBe(true);
  });

  it("live session with null expiresAt (legacy orphan) → group=closed, effectivelyExpired=true", async () => {
    mockSessionFindMany.mockResolvedValueOnce([
      makePrismaRow({ expiresAt: null }),
    ]);

    const [session] = await getDashboardSessions();
    expect(session.group).toBe("closed");
    expect(session.effectivelyExpired).toBe(true);
  });

  it("result_ready session with future expiresAt → group=success, effectivelyExpired=false", async () => {
    mockSessionFindMany.mockResolvedValueOnce([
      makePrismaRow({ status: "result_ready", expiresAt: new Date(Date.now() + 60_000) }),
    ]);

    const [session] = await getDashboardSessions();
    expect(session.group).toBe("success");
    expect(session.effectivelyExpired).toBe(false);
  });

  it("completed session → group=success regardless of expiresAt", async () => {
    mockSessionFindMany.mockResolvedValueOnce([
      makePrismaRow({ status: "completed", expiresAt: null }),
    ]);

    const [session] = await getDashboardSessions();
    expect(session.group).toBe("success");
  });

  it("expired session → group=closed", async () => {
    mockSessionFindMany.mockResolvedValueOnce([
      makePrismaRow({ status: "expired", expiresAt: new Date(Date.now() - 60_000) }),
    ]);

    const [session] = await getDashboardSessions();
    expect(session.group).toBe("closed");
  });

  it("failed session → group=problem", async () => {
    mockSessionFindMany.mockResolvedValueOnce([
      makePrismaRow({ status: "failed", expiresAt: null }),
    ]);

    const [session] = await getDashboardSessions();
    expect(session.group).toBe("problem");
  });

  it("live metric (group=live count) matches only non-expired live sessions", async () => {
    mockSessionFindMany.mockResolvedValueOnce([
      makePrismaRow({ id: "a", expiresAt: new Date(Date.now() + 60_000) }),          // live
      makePrismaRow({ id: "b", expiresAt: new Date(Date.now() - 60_000) }),          // overdue → closed
      makePrismaRow({ id: "c", expiresAt: null }),                                   // orphan → closed
      makePrismaRow({ id: "d", expiresAt: new Date(Date.now() + 30_000) }),          // live
    ]);

    const sessions = await getDashboardSessions();
    const liveCount = sessions.filter((s) => s.group === "live").length;
    const closedCount = sessions.filter((s) => s.group === "closed").length;

    expect(liveCount).toBe(2);
    expect(closedCount).toBe(2);
  });
});
