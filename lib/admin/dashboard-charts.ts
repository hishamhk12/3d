import "server-only";

import { prisma } from "@/lib/server/prisma";
import { LIVE_STATUSES } from "@/lib/room-preview/session-status";

const LAST_7_DAYS = 7;

function dayKey(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toISOString().slice(0, 10);
}

function labelForDay(key: string) {
  return new Date(`${key}T00:00:00`).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
  });
}

function lastDays(days: number) {
  const result: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    result.push(dayKey(new Date(Date.now() - i * 24 * 60 * 60 * 1000)));
  }
  return result;
}

function countValue(value: bigint | number) {
  return Number(value);
}

export type SessionStatusChartDatum = {
  count: number;
  status: string;
};

export type SessionTimelineChartDatum = {
  completed: number;
  created: number;
  failed: number;
  label: string;
};

export type RenderFailuresChartDatum = {
  failed: number;
  label: string;
  total: number;
};

export type IssueCodeChartDatum = {
  count: number;
  issueType: string;
};

export type MobileConnectionDatum = {
  count: number;
  name: string;
};

export type AdminDashboardChartData = {
  issueCodeData: IssueCodeChartDatum[];
  mobileConnectionData: MobileConnectionDatum[];
  renderFailuresData: RenderFailuresChartDatum[];
  sessionStatusData: SessionStatusChartDatum[];
  sessionTimelineData: SessionTimelineChartDatum[];
};

export async function getAdminDashboardChartData(): Promise<AdminDashboardChartData> {
  const sevenDaysAgo = new Date(Date.now() - (LAST_7_DAYS - 1) * 24 * 60 * 60 * 1000);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  const [statusRows, mobileRows, sessionTimelineRows, renderRows, issueRows] = await Promise.all([
    prisma.roomPreviewSession.groupBy({
      by: ["status"],
      _count: { _all: true },
      orderBy: { _count: { status: "desc" } },
    }),
    prisma.roomPreviewSession.groupBy({
      by: ["mobileConnected"],
      _count: { _all: true },
      where: {
        OR: [
          { status: { in: [...LIVE_STATUSES] } },
          { createdAt: { gte: sevenDaysAgo } },
        ],
      },
    }),
    prisma.$queryRaw<
      Array<{ date: Date; created: bigint; completed: bigint; failed: bigint }>
    >`
      SELECT
        DATE("createdAt")::date AS date,
        COUNT(*)::int AS created,
        COUNT(*) FILTER (WHERE status IN ('completed', 'result_ready'))::int AS completed,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
      FROM "RoomPreviewSession"
      WHERE "createdAt" >= ${sevenDaysAgo}
      GROUP BY DATE("createdAt")
      ORDER BY date ASC
    `,
    prisma.$queryRaw<
      Array<{ date: Date; total: bigint; failed: bigint }>
    >`
      SELECT
        DATE("createdAt")::date AS date,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
      FROM "RenderJob"
      WHERE "createdAt" >= ${sevenDaysAgo}
      GROUP BY DATE("createdAt")
      ORDER BY date ASC
    `,
    prisma.sessionIssue.groupBy({
      by: ["issueType"],
      _sum: { count: true },
      where: { lastSeenAt: { gte: sevenDaysAgo } },
      orderBy: { _sum: { count: "desc" } },
      take: 8,
    }),
  ]);

  const sessionTimelineMap = new Map(
    sessionTimelineRows.map((row) => [
      dayKey(row.date),
      {
        completed: countValue(row.completed),
        created: countValue(row.created),
        failed: countValue(row.failed),
      },
    ]),
  );

  const renderMap = new Map(
    renderRows.map((row) => [
      dayKey(row.date),
      {
        failed: countValue(row.failed),
        total: countValue(row.total),
      },
    ]),
  );

  const days = lastDays(LAST_7_DAYS);

  return {
    sessionStatusData: statusRows.map((row) => ({
      status: row.status.replace(/_/g, " "),
      count: row._count._all,
    })),
    mobileConnectionData: mobileRows.map((row) => ({
      name: row.mobileConnected ? "Mobile connected" : "Not connected",
      count: row._count._all,
    })),
    sessionTimelineData: days.map((date) => ({
      label: labelForDay(date),
      created: sessionTimelineMap.get(date)?.created ?? 0,
      completed: sessionTimelineMap.get(date)?.completed ?? 0,
      failed: sessionTimelineMap.get(date)?.failed ?? 0,
    })),
    renderFailuresData: days.map((date) => ({
      label: labelForDay(date),
      total: renderMap.get(date)?.total ?? 0,
      failed: renderMap.get(date)?.failed ?? 0,
    })),
    issueCodeData: issueRows.map((row) => ({
      issueType: row.issueType.replace(/_/g, " "),
      count: row._sum.count ?? 0,
    })),
  };
}
