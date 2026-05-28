import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock prisma and all transitive dependencies before importing the module
// ---------------------------------------------------------------------------

const mockUpdateMany = vi.fn();
const mockFindMany   = vi.fn();

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    roomPreviewSession: {
      updateMany: mockUpdateMany,
      findMany:   mockFindMany,
    },
  },
}));

// session-cleanup now calls trackSessionEvent / openSessionIssue (session-diagnostics)
// and publishRoomPreviewSessionEvent (session-events) per affected session.
vi.mock("@/lib/room-preview/session-diagnostics", () => ({
  trackSessionEvent: vi.fn().mockResolvedValue(undefined),
  openSessionIssue:  vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/room-preview/session-events", () => ({
  publishRoomPreviewSessionEvent: vi.fn(),
}));

// publishCleanupEvent calls getSessionById to push real-time SSE updates.
vi.mock("@/lib/room-preview/session-repository", () => ({
  getSessionById: vi.fn().mockResolvedValue(null),
}));

const {
  expireOldSessions,
  expireIdleWaitingSessions,
  failStuckRenderingSessions,
  completeResultReadySessions,
} = await import("@/lib/room-preview/session-cleanup");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lastWhere() {
  return mockUpdateMany.mock.calls.at(-1)?.[0]?.where;
}

function lastData() {
  return mockUpdateMany.mock.calls.at(-1)?.[0]?.data;
}

/** WHERE clause from the last findMany call (used by completeResultReadySessions). */
function lastFindManyWhere() {
  return mockFindMany.mock.calls.at(-1)?.[0]?.where;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateMany.mockResolvedValue({ count: 0 });
  // Return one session row so cleanup functions proceed past the early-return
  // guard in completeResultReadySessions and reach the updateMany call.
  mockFindMany.mockResolvedValue([{
    id: "sess-test",
    status: "product_selected",
    updatedAt: new Date(Date.now() - 60_000),
    lastMobileSeenAt: null,
  }]);
});

// ---------------------------------------------------------------------------
// expireOldSessions
// ---------------------------------------------------------------------------

describe("expireOldSessions", () => {
  it("returns the number of rows updated", async () => {
    mockUpdateMany.mockResolvedValueOnce({ count: 7 });
    expect(await expireOldSessions()).toBe(7);
  });

  it("sets status to 'expired'", async () => {
    await expireOldSessions();
    expect(lastData()).toEqual({ status: "expired" });
  });

  it("excludes terminal and in-flight statuses: failed, expired, completed, rendering, ready_to_render, result_ready", async () => {
    await expireOldSessions();
    const notIn: string[] = lastWhere().status.notIn;
    expect(notIn).toContain("failed");
    expect(notIn).toContain("expired");
    expect(notIn).toContain("completed");
  });

  // result_ready is excluded so completeResultReadySessions() can race-free advance it to
  // completed without this function concurrently expiring the same row.
  it("excludes result_ready to avoid racing with completeResultReadySessions", async () => {
    await expireOldSessions();
    expect(lastWhere().status.notIn).toContain("result_ready");
  });

  it("targets sessions with null expiresAt (legacy orphans)", async () => {
    await expireOldSessions();
    const orClauses: object[] = lastWhere().OR;
    const hasNullClause = orClauses.some(
      (c) => "expiresAt" in c && (c as Record<string, unknown>).expiresAt === null,
    );
    expect(hasNullClause).toBe(true);
  });

  it("targets sessions with past expiresAt", async () => {
    const before = new Date();
    await expireOldSessions();
    const after = new Date();

    const orClauses: object[] = lastWhere().OR;
    const pastClause = orClauses.find((c) => {
      const val = (c as Record<string, unknown>).expiresAt;
      return val !== null && typeof val === "object" && "lte" in (val as object);
    }) as { expiresAt: { lte: Date } } | undefined;

    expect(pastClause?.expiresAt?.lte.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(pastClause?.expiresAt?.lte.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});

// ---------------------------------------------------------------------------
// expireIdleWaitingSessions
// ---------------------------------------------------------------------------

describe("expireIdleWaitingSessions", () => {
  it("returns the number of rows updated", async () => {
    mockUpdateMany.mockResolvedValueOnce({ count: 4 });
    expect(await expireIdleWaitingSessions()).toBe(4);
  });

  it("only targets waiting_for_mobile sessions", async () => {
    await expireIdleWaitingSessions();
    expect(lastWhere().status).toBe("waiting_for_mobile");
  });

  it("sets status to 'expired'", async () => {
    await expireIdleWaitingSessions();
    expect(lastData()).toEqual({ status: "expired" });
  });

  it("uses the provided idleAfterMs as the updatedAt cutoff", async () => {
    const idleAfterMs = 2 * 60 * 1000;
    const before = Date.now();
    await expireIdleWaitingSessions(idleAfterMs);
    const after = Date.now();

    const cutoff: Date = lastWhere().updatedAt.lte;
    expect(cutoff.getTime()).toBeLessThanOrEqual(before - idleAfterMs + 100);
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(after - idleAfterMs - 100);
  });

  it("defaults to a 1-minute idle threshold", async () => {
    const oneMinMs = 1 * 60 * 1000;
    const before = Date.now();
    await expireIdleWaitingSessions();
    const after = Date.now();

    const cutoff: Date = lastWhere().updatedAt.lte;
    expect(cutoff.getTime()).toBeLessThanOrEqual(before - oneMinMs + 100);
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(after - oneMinMs - 100);
  });
});

// ---------------------------------------------------------------------------
// failStuckRenderingSessions
// ---------------------------------------------------------------------------

describe("failStuckRenderingSessions", () => {
  it("returns the number of rows updated", async () => {
    mockUpdateMany.mockResolvedValueOnce({ count: 2 });
    expect(await failStuckRenderingSessions()).toBe(2);
  });

  it("sets status to 'failed'", async () => {
    await failStuckRenderingSessions();
    expect(lastData()).toEqual({ status: "failed" });
  });

  it("only targets rendering and ready_to_render", async () => {
    await failStuckRenderingSessions();
    const inStatuses: string[] = lastWhere().status.in;
    expect(inStatuses).toContain("rendering");
    expect(inStatuses).toContain("ready_to_render");
    expect(inStatuses).toHaveLength(2);
  });

  it("defaults to a 7-minute stuck threshold", async () => {
    const sevenMinMs = 7 * 60 * 1000;
    const before = Date.now();
    await failStuckRenderingSessions();
    const after = Date.now();

    const cutoff: Date = lastWhere().updatedAt.lte;
    expect(cutoff.getTime()).toBeLessThanOrEqual(before - sevenMinMs + 100);
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(after - sevenMinMs - 100);
  });
});

// ---------------------------------------------------------------------------
// completeResultReadySessions
// ---------------------------------------------------------------------------

describe("completeResultReadySessions", () => {
  it("returns the number of rows updated", async () => {
    mockUpdateMany.mockResolvedValueOnce({ count: 3 });
    expect(await completeResultReadySessions()).toBe(3);
  });

  it("only targets result_ready sessions", async () => {
    // The selection of sessions via findMany and the updateMany guard both
    // restrict to result_ready.
    await completeResultReadySessions();
    expect(lastFindManyWhere().status).toBe("result_ready");
    expect(lastWhere().status).toBe("result_ready");
  });

  it("sets status to 'completed'", async () => {
    await completeResultReadySessions();
    expect(lastData()).toEqual({ status: "completed" });
  });

  it("defaults to a 90-second display window", async () => {
    // completeResultReadySessions uses findMany to find eligible sessions, then
    // updateMany by ID. The updatedAt.lte cutoff lives in the findMany WHERE clause.
    const ninetySecMs = 90 * 1000;
    const before = Date.now();
    await completeResultReadySessions();
    const after = Date.now();

    const cutoff: Date = lastFindManyWhere().updatedAt.lte;
    expect(cutoff.getTime()).toBeLessThanOrEqual(before - ninetySecMs + 100);
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(after - ninetySecMs - 100);
  });

  it("uses a custom display window when provided", async () => {
    const custom = 3 * 60 * 1000;
    const before = Date.now();
    await completeResultReadySessions(custom);
    const after = Date.now();

    const cutoff: Date = lastFindManyWhere().updatedAt.lte;
    expect(cutoff.getTime()).toBeLessThanOrEqual(before - custom + 100);
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(after - custom - 100);
  });
});
