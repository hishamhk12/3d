import { Suspense } from "react";
import { AdminHeader } from "../_components/admin-header";
import { BarChart } from "../_components/bar-chart";
import {
  getWeeklyComparison,
  getSessionsPerDay,
  getRenderStatsPerDay,
  getSessionsByHour,
  formatDayLabel,
} from "@/lib/admin/analytics-queries";
import {
  getUserAnalyticsSummary,
  getUsersPerDay,
  getAdminUserSessions,
  type AdminUserSession,
} from "@/lib/admin/user-analytics-queries";

export const metadata = {
  title: "Analytics — Ibdaa 360 Admin",
};

// ─── Trend indicator ──────────────────────────────────────────────────────────

function Trend({ current, previous }: { current: number; previous: number }) {
  if (previous === 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  const up = pct >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-medium ${
        up ? "text-green-400" : "text-red-400"
      }`}
    >
      {up ? "↑" : "↓"} {Math.abs(pct)}%
    </span>
  );
}

// ─── Summary cards ────────────────────────────────────────────────────────────

async function SummaryCards() {
  const w = await getWeeklyComparison();

  const cards = [
    {
      label: "Sessions (7d)",
      value: w.thisWeekSessions,
      sub: <Trend current={w.thisWeekSessions} previous={w.lastWeekSessions} />,
      note: `vs ${w.lastWeekSessions} prev week`,
    },
    {
      label: "Renders (7d)",
      value: w.thisWeekRenders,
      sub: <Trend current={w.thisWeekRenders} previous={w.lastWeekRenders} />,
      note: `vs ${w.lastWeekRenders} prev week`,
    },
    {
      label: "Success rate (7d)",
      value: w.successRate !== null ? `${w.successRate}%` : "—",
      sub: null,
      note:
        w.thisWeekRenders > 0
          ? `${w.thisWeekRenders - w.thisWeekFailed} / ${w.thisWeekRenders} jobs`
          : "No renders yet",
      highlight: w.successRate !== null && w.successRate < 80 ? "red" : undefined,
    },
    {
      label: "Failed renders (7d)",
      value: w.thisWeekFailed,
      sub: null,
      note: w.thisWeekRenders > 0 ? `of ${w.thisWeekRenders} total` : "",
      highlight: w.thisWeekFailed > 0 ? ("red" as const) : undefined,
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-xl border border-gray-800 bg-gray-900 px-5 py-4"
        >
          <p className="text-xs font-medium text-gray-500">{card.label}</p>
          <div className="mt-1 flex items-baseline gap-2">
            <p
              className={`text-2xl font-semibold tabular-nums ${
                card.highlight === "red" ? "text-red-400" : "text-white"
              }`}
            >
              {card.value}
            </p>
            {card.sub}
          </div>
          {card.note && <p className="mt-1 text-xs text-gray-600">{card.note}</p>}
        </div>
      ))}
    </div>
  );
}

// ─── Sessions per day chart ───────────────────────────────────────────────────

async function SessionsChart() {
  const data = await getSessionsPerDay();

  const chartData = data.map((d, i) => ({
    // Only show label every 2 days to avoid crowding
    label: i % 2 === 0 ? formatDayLabel(d.date) : "",
    value: d.count,
  }));

  const total = data.reduce((s, d) => s + d.count, 0);
  const peak = Math.max(...data.map((d) => d.count));

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-white">Sessions per day</h3>
          <p className="text-xs text-gray-500 mt-0.5">Last 14 days</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500">Total</p>
          <p className="text-lg font-semibold text-white tabular-nums">{total}</p>
        </div>
      </div>
      <BarChart data={chartData} height={100} color="bg-indigo-500" />
      <p className="mt-3 text-xs text-gray-600">Peak: {peak} sessions in a day</p>
    </div>
  );
}

// ─── Render success / failure chart ──────────────────────────────────────────

async function RendersChart() {
  const data = await getRenderStatsPerDay();

  const chartData = data.map((d, i) => ({
    label: i % 2 === 0 ? formatDayLabel(d.date) : "",
    value: d.completed,
    danger: d.failed,
  }));

  const totalCompleted = data.reduce((s, d) => s + d.completed, 0);
  const totalFailed = data.reduce((s, d) => s + d.failed, 0);
  const totalRenders = totalCompleted + totalFailed;
  const successRate =
    totalRenders > 0 ? Math.round((totalCompleted / totalRenders) * 100) : null;

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-white">Renders per day</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Completed
            {totalFailed > 0 && (
              <span className="text-red-500"> · red = failed</span>
            )}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500">Success rate</p>
          <p
            className={`text-lg font-semibold tabular-nums ${
              successRate !== null && successRate < 80 ? "text-red-400" : "text-white"
            }`}
          >
            {successRate !== null ? `${successRate}%` : "—"}
          </p>
        </div>
      </div>
      <BarChart
        data={chartData}
        height={100}
        color="bg-green-600"
        dangerColor="bg-red-500"
      />
      <p className="mt-3 text-xs text-gray-600">
        {totalCompleted} completed · {totalFailed} failed (14 days)
      </p>
    </div>
  );
}

// ─── Avg render time chart ────────────────────────────────────────────────────

async function RenderTimeChart() {
  const data = await getRenderStatsPerDay();

  const chartData = data.map((d, i) => ({
    label: i % 2 === 0 ? formatDayLabel(d.date) : "",
    value: d.avg_seconds,
  }));

  const days = data.filter((d) => d.avg_seconds > 0);
  const overall =
    days.length > 0
      ? Math.round(days.reduce((s, d) => s + d.avg_seconds, 0) / days.length)
      : null;

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-white">Avg render time</h3>
          <p className="text-xs text-gray-500 mt-0.5">Seconds per day</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500">14-day avg</p>
          <p
            className={`text-lg font-semibold tabular-nums ${
              overall !== null && overall > 30 ? "text-amber-400" : "text-white"
            }`}
          >
            {overall !== null ? `${overall}s` : "—"}
          </p>
        </div>
      </div>
      <BarChart
        data={chartData}
        height={100}
        color="bg-amber-500"
        unit="s"
      />
      <p className="mt-3 text-xs text-gray-600">Amber header = 14-day avg &gt; 30s</p>
    </div>
  );
}

// ─── Peak hours chart ─────────────────────────────────────────────────────────

async function PeakHoursChart() {
  const data = await getSessionsByHour();
  const peak = data.reduce((max, d) => (d.count > max.count ? d : max), data[0]);
  const total = data.reduce((s, d) => s + d.count, 0);

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-white">Activity by hour</h3>
          <p className="text-xs text-gray-500 mt-0.5">Last 7 days · local server time</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500">Peak hour</p>
          <p className="text-lg font-semibold text-white tabular-nums">
            {total > 0 ? `${String(peak.hour).padStart(2, "0")}:00` : "—"}
          </p>
        </div>
      </div>
      <BarChart
        data={data.map((d) => ({ label: d.label, value: d.count }))}
        height={100}
        color="bg-violet-500"
      />
      <p className="mt-3 text-xs text-gray-600">
        {total} sessions across 7 days · labels every 4 hours
      </p>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

// Pre-computed heights so Math.random() is never called during render.
// Values are fixed; the animate-pulse already provides visual variation.
const CHART_SKELETON_HEIGHTS = [68, 45, 82, 37, 91, 54, 73, 42, 88, 61, 78, 33, 95, 50];

function ChartSkeleton() {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <div className="flex justify-between mb-4">
        <div className="space-y-2">
          <div className="h-3 w-32 rounded bg-gray-800 animate-pulse" />
          <div className="h-2.5 w-20 rounded bg-gray-800 animate-pulse" />
        </div>
        <div className="h-7 w-10 rounded bg-gray-800 animate-pulse" />
      </div>
      <div className="flex items-end gap-px h-24">
        {CHART_SKELETON_HEIGHTS.map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-t-sm bg-gray-800 animate-pulse"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
    </div>
  );
}

function CardsSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-gray-800 bg-gray-900 px-5 py-4 space-y-2">
          <div className="h-2.5 w-24 rounded bg-gray-800 animate-pulse" />
          <div className="h-7 w-14 rounded bg-gray-800 animate-pulse" />
          <div className="h-2 w-20 rounded bg-gray-800 animate-pulse" />
        </div>
      ))}
    </div>
  );
}

// ─── User analytics ───────────────────────────────────────────────────────────

async function UserSummaryCards() {
  const u = await getUserAnalyticsSummary();

  const cards = [
    {
      label: "Total visitors",
      value: u.total,
      note: `${u.thisWeekCount} this week`,
    },
    {
      label: "Customers",
      value: u.customerCount,
      note: u.total > 0 ? `${Math.round((u.customerCount / u.total) * 100)}% of visitors` : "—",
      color: "text-blue-400",
    },
    {
      label: "Employees",
      value: u.employeeCount,
      note: u.total > 0 ? `${Math.round((u.employeeCount / u.total) * 100)}% of visitors` : "—",
      color: "text-indigo-400",
    },
    {
      label: "Render conversion",
      value: u.conversionRate !== null ? `${u.conversionRate}%` : "—",
      note: `${u.convertedCount} of ${u.total} rendered`,
      color:
        u.conversionRate !== null && u.conversionRate < 30
          ? "text-amber-400"
          : "text-green-400",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => (
        <div key={card.label} className="rounded-xl border border-gray-800 bg-gray-900 px-5 py-4">
          <p className="text-xs font-medium text-gray-500">{card.label}</p>
          <p className={`mt-1 text-2xl font-semibold tabular-nums ${card.color ?? "text-white"}`}>
            {card.value}
          </p>
          {card.note && <p className="mt-1 text-xs text-gray-600">{card.note}</p>}
        </div>
      ))}
    </div>
  );
}

async function UsersPerDayChart() {
  const data = await getUsersPerDay();

  const chartData = data.map((d) => ({
    label: d.label,
    value: d.customers,
    danger: d.employees, // reuse danger slot for employees (rendered in indigo below)
  }));

  const totalUsers = data.reduce((s, d) => s + d.total, 0);
  const peak = Math.max(...data.map((d) => d.total));

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-white">Visitors per day</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Blue = customers · indigo overlay = employees
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500">Total (14d)</p>
          <p className="text-lg font-semibold text-white tabular-nums">{totalUsers}</p>
        </div>
      </div>
      <BarChart
        data={chartData}
        height={100}
        color="bg-blue-500"
        dangerColor="bg-indigo-500"
      />
      <p className="mt-3 text-xs text-gray-600">Peak: {peak} visitors in a day</p>
    </div>
  );
}

// ─── User sessions table ──────────────────────────────────────────────────────

const ROLE_STYLES: Record<string, string> = {
  customer: "bg-blue-950 text-blue-300",
  employee: "bg-indigo-950 text-indigo-300",
};

const SESSION_STATUS_COLORS: Record<string, string> = {
  result_ready: "text-green-400",
  rendering: "text-amber-400",
  failed: "text-red-400",
  expired: "text-gray-600",
};

function relativeTime(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function UserSessionRow({ u }: { u: AdminUserSession }) {
  return (
    <tr className="hover:bg-gray-900/60 transition-colors">
      <td className="px-4 py-3">
        <div>
          <p className="text-sm font-medium text-white">{u.name}</p>
          <p className="text-xs text-gray-500 font-mono mt-0.5">{u.id.slice(0, 8)}…</p>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${ROLE_STYLES[u.role] ?? "bg-gray-800 text-gray-400"}`}>
          {u.role}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className="text-xs text-gray-400 font-mono">
          {u.role === "customer" ? (u.phone ?? "—") : (u.employeeCode ?? "—")}
        </span>
      </td>
      <td className="px-4 py-3 text-center">
        <span className="tabular-nums text-xs text-gray-400">{u._count.events}</span>
      </td>
      <td className="px-4 py-3">
        {u.roomSession ? (
          <div>
            <span className={`text-xs font-medium ${SESSION_STATUS_COLORS[u.roomSession.status] ?? "text-gray-400"}`}>
              {u.roomSession.status.replace(/_/g, " ")}
            </span>
            {u.roomSession.renderCount > 0 && (
              <span className="ml-1.5 text-xs text-gray-600">· {u.roomSession.renderCount} renders</span>
            )}
          </div>
        ) : (
          <span className="text-xs text-gray-700">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        <span className="text-xs text-gray-500 whitespace-nowrap">{relativeTime(u.createdAt)}</span>
      </td>
    </tr>
  );
}

async function UserSessionsTable() {
  const users = await getAdminUserSessions(50);

  if (users.length === 0) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-6 py-10 text-center">
        <p className="text-sm text-gray-500">No visitors yet — gate has not been used.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-800 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 bg-gray-900">
              {["Visitor", "Role", "Contact", "Events", "Session", "When"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/60 bg-gray-950">
            {users.map((u) => (
              <UserSessionRow key={u.id} u={u} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2.5 border-t border-gray-800 bg-gray-900/60">
        <span className="text-xs text-gray-600">Last {users.length} visitors</span>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  return (
    <div className="min-h-screen bg-gray-950">
      <AdminHeader />

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-10">
        {/* ── Render analytics ── */}
        <div className="space-y-8">
          <div>
            <h1 className="text-2xl font-semibold text-white">Analytics</h1>
            <p className="mt-1 text-sm text-gray-500">Usage trends and render pipeline health</p>
          </div>

          <Suspense fallback={<CardsSkeleton />}>
            <SummaryCards />
          </Suspense>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Suspense fallback={<ChartSkeleton />}>
              <SessionsChart />
            </Suspense>
            <Suspense fallback={<ChartSkeleton />}>
              <RendersChart />
            </Suspense>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Suspense fallback={<ChartSkeleton />}>
              <RenderTimeChart />
            </Suspense>
            <Suspense fallback={<ChartSkeleton />}>
              <PeakHoursChart />
            </Suspense>
          </div>
        </div>

        {/* ── Divider ── */}
        <div className="border-t border-gray-800" />

        {/* ── Visitor analytics ── */}
        <div className="space-y-8">
          <div>
            <h2 className="text-xl font-semibold text-white">Visitors</h2>
            <p className="mt-1 text-sm text-gray-500">
              Identified users who passed through the pre-access gate
            </p>
          </div>

          <Suspense fallback={<CardsSkeleton />}>
            <UserSummaryCards />
          </Suspense>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Suspense fallback={<ChartSkeleton />}>
              <UsersPerDayChart />
            </Suspense>
            {/* Placeholder for future funnel chart */}
            <div className="rounded-xl border border-dashed border-gray-800 bg-gray-900/20 p-5 flex items-center justify-center">
              <p className="text-xs text-gray-600 text-center">
                Conversion funnel chart<br />coming soon
              </p>
            </div>
          </div>

          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-white">Visitor Log</h3>
              <span className="text-xs text-gray-600">Last 50 visitors</span>
            </div>
            <Suspense fallback={<ChartSkeleton />}>
              <UserSessionsTable />
            </Suspense>
          </section>
        </div>
      </main>
    </div>
  );
}
