import "server-only";

import { prisma } from "@/lib/server/prisma";

// ─── Summary cards ────────────────────────────────────────────────────────────

export async function getUserAnalyticsSummary() {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [total, customerCount, employeeCount, thisWeekCount, convertedCount] =
    await Promise.all([
      prisma.userSession.count(),
      prisma.userSession.count({ where: { role: "customer" } }),
      prisma.userSession.count({ where: { role: "employee" } }),
      prisma.userSession.count({ where: { createdAt: { gte: weekAgo } } }),
      // Users who completed at least one successful render
      prisma.userSession.count({
        where: { events: { some: { eventType: "render_completed" } } },
      }),
    ]);

  const conversionRate =
    total > 0 ? Math.round((convertedCount / total) * 100) : null;

  return {
    total,
    customerCount,
    employeeCount,
    thisWeekCount,
    convertedCount,
    conversionRate,
  };
}

// ─── Users per day (last 14 days) ─────────────────────────────────────────────

export async function getUsersPerDay() {
  const rows = await prisma.$queryRaw<Array<{ date: Date; customers: bigint; employees: bigint }>>`
    SELECT
      DATE("createdAt")                                             AS date,
      COUNT(*) FILTER (WHERE role = 'customer')::int               AS customers,
      COUNT(*) FILTER (WHERE role = 'employee')::int               AS employees
    FROM "UserSession"
    WHERE "createdAt" >= NOW() - INTERVAL '14 days'
    GROUP BY DATE("createdAt")
    ORDER BY date ASC
  `;

  const map = new Map(
    rows.map((r) => [
      r.date.toISOString().slice(0, 10),
      { customers: Number(r.customers), employees: Number(r.employees) },
    ]),
  );

  // Fill all 14 days
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.now() - (13 - i) * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    const entry = map.get(key) ?? { customers: 0, employees: 0 };
    return {
      date: key,
      label: i % 2 === 0
        ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
        : "",
      ...entry,
      total: entry.customers + entry.employees,
    };
  });
}

// ─── User sessions table ──────────────────────────────────────────────────────

export type AdminUserSession = Awaited<ReturnType<typeof getAdminUserSessions>>[number];

export async function getAdminUserSessions(limit = 50) {
  const rows = await prisma.userSession.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      name: true,
      role: true,
      phone: true,
      employeeCode: true,
      createdAt: true,
      _count: { select: { events: true } },
      roomSession: {
        select: {
          id: true,
          status: true,
          renderCount: true,
        },
      },
    },
  });

  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
  }));
}

// ─── Journey events for a single user session ─────────────────────────────────

export async function getUserSessionEvents(userSessionId: string) {
  const rows = await prisma.event.findMany({
    where: { userSessionId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      eventType: true,
      sessionId: true,
      renderJobId: true,
      metadata: true,
      createdAt: true,
    },
  });

  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
  }));
}
