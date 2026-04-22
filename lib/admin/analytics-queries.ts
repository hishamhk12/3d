import "server-only";

import { prisma } from "@/lib/server/prisma";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Fill in zeros for days with no activity so charts are always 14 bars wide. */
function fillDateRange(
  data: Array<{ date: string; [key: string]: unknown }>,
  days: number,
  defaults: Record<string, number>,
): Array<{ date: string } & Record<string, number>> {
  const map = new Map(data.map((d) => [d.date, d]));
  const result = [];

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    const row = map.get(key) ?? { date: key };
    result.push({
      date: key,
      ...Object.fromEntries(
        Object.keys(defaults).map((k) => [k, Number((row as Record<string, unknown>)[k] ?? defaults[k])]),
      ),
    });
  }

  return result as Array<{ date: string } & Record<string, number>>;
}

/** Format a date string "YYYY-MM-DD" → short label "Apr 1" */
export function formatDayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─── Weekly comparison (summary cards) ───────────────────────────────────────

export async function getWeeklyComparison() {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const [
    thisWeekSessions,
    lastWeekSessions,
    thisWeekRenders,
    lastWeekRenders,
    thisWeekCompleted,
    thisWeekFailed,
  ] = await Promise.all([
    prisma.roomPreviewSession.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.roomPreviewSession.count({ where: { createdAt: { gte: twoWeeksAgo, lt: weekAgo } } }),
    prisma.renderJob.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.renderJob.count({ where: { createdAt: { gte: twoWeeksAgo, lt: weekAgo } } }),
    prisma.renderJob.count({ where: { status: "completed", createdAt: { gte: weekAgo } } }),
    prisma.renderJob.count({ where: { status: "failed", createdAt: { gte: weekAgo } } }),
  ]);

  const successRate =
    thisWeekRenders > 0 ? Math.round((thisWeekCompleted / thisWeekRenders) * 100) : null;

  return {
    thisWeekSessions,
    lastWeekSessions,
    thisWeekRenders,
    lastWeekRenders,
    successRate,
    thisWeekFailed,
  };
}

// ─── Sessions per day (14 days) ───────────────────────────────────────────────

export async function getSessionsPerDay() {
  // COUNT returns BigInt from PostgreSQL — cast to ::int in the query.
  const rows = await prisma.$queryRaw<Array<{ date: Date; count: bigint }>>`
    SELECT
      DATE("createdAt")       AS date,
      COUNT(*)::int           AS count
    FROM "RoomPreviewSession"
    WHERE "createdAt" >= NOW() - INTERVAL '14 days'
    GROUP BY DATE("createdAt")
    ORDER BY date ASC
  `;

  const data = rows.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    count: Number(r.count),
  }));

  return fillDateRange(data, 14, { count: 0 });
}

// ─── Render stats per day (14 days) ──────────────────────────────────────────

export async function getRenderStatsPerDay() {
  const rows = await prisma.$queryRaw<
    Array<{
      date: Date;
      total: bigint;
      completed: bigint;
      failed: bigint;
      avg_seconds: number | null;
    }>
  >`
    SELECT
      DATE("createdAt")                                                        AS date,
      COUNT(*)::int                                                            AS total,
      COUNT(*) FILTER (WHERE status = 'completed')::int                       AS completed,
      COUNT(*) FILTER (WHERE status = 'failed')::int                          AS failed,
      AVG(
        EXTRACT(EPOCH FROM ("updatedAt" - "createdAt"))
      ) FILTER (WHERE status = 'completed')                                    AS avg_seconds
    FROM "RenderJob"
    WHERE "createdAt" >= NOW() - INTERVAL '14 days'
    GROUP BY DATE("createdAt")
    ORDER BY date ASC
  `;

  const data = rows.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    total: Number(r.total),
    completed: Number(r.completed),
    failed: Number(r.failed),
    avg_seconds: r.avg_seconds !== null ? Math.round(Number(r.avg_seconds)) : 0,
  }));

  return fillDateRange(data, 14, { total: 0, completed: 0, failed: 0, avg_seconds: 0 });
}

// ─── Peak hours (last 7 days) ─────────────────────────────────────────────────

export async function getSessionsByHour() {
  const rows = await prisma.$queryRaw<Array<{ hour: number; count: bigint }>>`
    SELECT
      EXTRACT(HOUR FROM "createdAt")::int   AS hour,
      COUNT(*)::int                          AS count
    FROM "RoomPreviewSession"
    WHERE "createdAt" >= NOW() - INTERVAL '7 days'
    GROUP BY EXTRACT(HOUR FROM "createdAt")
    ORDER BY hour ASC
  `;

  const map = new Map(rows.map((r) => [Number(r.hour), Number(r.count)]));

  // Return all 24 hours, zero-filling missing ones.
  return Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    label: h % 4 === 0 ? `${String(h).padStart(2, "0")}:00` : "",
    count: map.get(h) ?? 0,
  }));
}
