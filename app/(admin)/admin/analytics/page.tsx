import { Suspense } from "react";
import { AdminHeader } from "../_components/admin-header";
import { BarChart } from "../_components/bar-chart";
import {
  formatDayLabel,
  getRenderStatsPerDay,
  getSessionsByHour,
  getSessionsPerDay,
  getWeeklyComparison,
} from "@/lib/admin/analytics-queries";
import {
  getAdminUserSessions,
  getUserAnalyticsSummary,
  getUsersPerDay,
  type AdminUserSession,
} from "@/lib/admin/user-analytics-queries";

export const metadata = {
  title: "Analytics - Ibdaa 360 Admin",
};

function Trend({ current, previous }: { current: number; previous: number }) {
  if (previous === 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  const up = pct >= 0;
  return (
    <span className={`text-xs font-medium ${up ? "text-emerald-700" : "text-red-700"}`}>
      {up ? "up" : "down"} {Math.abs(pct)}%
    </span>
  );
}

function Panel({
  children,
  title,
  subtitle,
  metric,
}: {
  children: React.ReactNode;
  metric?: React.ReactNode;
  subtitle?: string;
  title: string;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
        </div>
        {metric ? <div className="text-right">{metric}</div> : null}
      </div>
      {children}
    </section>
  );
}

async function SummaryCards() {
  const w = await getWeeklyComparison();
  const cards = [
    {
      label: "Sessions (7d)",
      value: w.thisWeekSessions,
      note: `vs ${w.lastWeekSessions} previous week`,
      sub: <Trend current={w.thisWeekSessions} previous={w.lastWeekSessions} />,
    },
    {
      label: "Renders (7d)",
      value: w.thisWeekRenders,
      note: `vs ${w.lastWeekRenders} previous week`,
      sub: <Trend current={w.thisWeekRenders} previous={w.lastWeekRenders} />,
    },
    {
      label: "Success rate (7d)",
      value: w.successRate !== null ? `${w.successRate}%` : "-",
      note: w.thisWeekRenders > 0 ? `${w.thisWeekRenders - w.thisWeekFailed} / ${w.thisWeekRenders} jobs` : "No renders yet",
      warning: w.successRate !== null && w.successRate < 80,
    },
    {
      label: "Failed renders (7d)",
      value: w.thisWeekFailed,
      note: w.thisWeekRenders > 0 ? `of ${w.thisWeekRenders} total` : "No renders yet",
      warning: w.thisWeekFailed > 0,
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">{card.label}</p>
          <div className="mt-1 flex items-baseline gap-2">
            <p className={`text-2xl font-semibold tabular-nums ${card.warning ? "text-red-700" : "text-slate-950"}`}>
              {card.value}
            </p>
            {"sub" in card ? card.sub : null}
          </div>
          <p className="mt-1 text-xs text-slate-500">{card.note}</p>
        </div>
      ))}
    </div>
  );
}

async function SessionsChart() {
  const data = await getSessionsPerDay();
  const chartData = data.map((d, i) => ({
    label: i % 2 === 0 ? formatDayLabel(d.date) : "",
    value: d.count,
  }));
  const total = data.reduce((sum, item) => sum + item.count, 0);
  const peak = Math.max(...data.map((item) => item.count));

  return (
    <Panel
      metric={<><p className="text-xs text-slate-500">Total</p><p className="text-lg font-semibold tabular-nums text-slate-950">{total}</p></>}
      subtitle="Last 14 days"
      title="Sessions per day"
    >
      <BarChart color="bg-blue-600" data={chartData} height={110} />
      <p className="mt-3 text-xs text-slate-500">Peak: {peak} sessions in a day</p>
    </Panel>
  );
}

async function RendersChart() {
  const data = await getRenderStatsPerDay();
  const chartData = data.map((d, i) => ({
    label: i % 2 === 0 ? formatDayLabel(d.date) : "",
    value: d.completed,
    danger: d.failed,
  }));
  const completed = data.reduce((sum, item) => sum + item.completed, 0);
  const failed = data.reduce((sum, item) => sum + item.failed, 0);
  const total = completed + failed;
  const successRate = total > 0 ? Math.round((completed / total) * 100) : null;

  return (
    <Panel
      metric={<><p className="text-xs text-slate-500">Success rate</p><p className={`text-lg font-semibold tabular-nums ${successRate !== null && successRate < 80 ? "text-red-700" : "text-slate-950"}`}>{successRate !== null ? `${successRate}%` : "-"}</p></>}
      subtitle="Completed bars with failed overlay"
      title="Renders per day"
    >
      <BarChart color="bg-emerald-600" dangerColor="bg-red-500" data={chartData} height={110} />
      <p className="mt-3 text-xs text-slate-500">{completed} completed, {failed} failed in 14 days</p>
    </Panel>
  );
}

async function RenderTimeChart() {
  const data = await getRenderStatsPerDay();
  const chartData = data.map((d, i) => ({
    label: i % 2 === 0 ? formatDayLabel(d.date) : "",
    value: d.avg_seconds,
  }));
  const days = data.filter((item) => item.avg_seconds > 0);
  const overall = days.length > 0
    ? Math.round(days.reduce((sum, item) => sum + item.avg_seconds, 0) / days.length)
    : null;

  return (
    <Panel
      metric={<><p className="text-xs text-slate-500">14-day avg</p><p className={`text-lg font-semibold tabular-nums ${overall !== null && overall > 30 ? "text-amber-700" : "text-slate-950"}`}>{overall !== null ? `${overall}s` : "-"}</p></>}
      subtitle="Seconds per day"
      title="Average render time"
    >
      <BarChart color="bg-amber-500" data={chartData} height={110} unit="s" />
      <p className="mt-3 text-xs text-slate-500">Amber value means average render time is above 30s.</p>
    </Panel>
  );
}

async function PeakHoursChart() {
  const data = await getSessionsByHour();
  const peak = data.reduce((max, item) => (item.count > max.count ? item : max), data[0]);
  const total = data.reduce((sum, item) => sum + item.count, 0);

  return (
    <Panel
      metric={<><p className="text-xs text-slate-500">Peak hour</p><p className="text-lg font-semibold tabular-nums text-slate-950">{total > 0 ? `${String(peak.hour).padStart(2, "0")}:00` : "-"}</p></>}
      subtitle="Last 7 days, local server time"
      title="Activity by hour"
    >
      <BarChart color="bg-violet-500" data={data.map((item) => ({ label: item.label, value: item.count }))} height={110} />
      <p className="mt-3 text-xs text-slate-500">{total} sessions across 7 days.</p>
    </Panel>
  );
}

function ChartSkeleton() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="h-4 w-36 animate-pulse rounded bg-slate-200" />
      <div className="mt-8 h-28 animate-pulse rounded bg-slate-100" />
    </div>
  );
}

function CardsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <div className="h-3 w-24 animate-pulse rounded bg-slate-200" />
          <div className="mt-3 h-8 w-16 animate-pulse rounded bg-slate-200" />
          <div className="mt-3 h-3 w-28 animate-pulse rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

async function UserSummaryCards() {
  const u = await getUserAnalyticsSummary();
  const cards = [
    { label: "Total visitors", value: u.total, note: `${u.thisWeekCount} this week` },
    { label: "Customers", value: u.customerCount, note: u.total > 0 ? `${Math.round((u.customerCount / u.total) * 100)}% of visitors` : "-" },
    { label: "Employees", value: u.employeeCount, note: u.total > 0 ? `${Math.round((u.employeeCount / u.total) * 100)}% of visitors` : "-" },
    { label: "Render conversion", value: u.conversionRate !== null ? `${u.conversionRate}%` : "-", note: `${u.convertedCount} of ${u.total} rendered` },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">{card.label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">{card.value}</p>
          <p className="mt-1 text-xs text-slate-500">{card.note}</p>
        </div>
      ))}
    </div>
  );
}

async function UsersPerDayChart() {
  const data = await getUsersPerDay();
  const chartData = data.map((item) => ({
    label: item.label,
    value: item.customers,
    danger: item.employees,
  }));
  const totalUsers = data.reduce((sum, item) => sum + item.total, 0);
  const peak = Math.max(...data.map((item) => item.total));

  return (
    <Panel
      metric={<><p className="text-xs text-slate-500">Total</p><p className="text-lg font-semibold tabular-nums text-slate-950">{totalUsers}</p></>}
      subtitle="Blue customers, violet employees"
      title="Visitors per day"
    >
      <BarChart color="bg-blue-500" dangerColor="bg-violet-500" data={chartData} height={110} />
      <p className="mt-3 text-xs text-slate-500">Peak: {peak} visitors in a day</p>
    </Panel>
  );
}

function relativeTime(iso: string) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function UserSessionRow({ user }: { user: AdminUserSession }) {
  return (
    <tr className="transition-colors hover:bg-slate-50">
      <td className="px-4 py-3">
        <p className="text-sm font-medium text-slate-950">{user.name}</p>
        <p className="mt-0.5 font-mono text-xs text-slate-500">{user.id.slice(0, 8)}...</p>
      </td>
      <td className="px-4 py-3">
        <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">{user.role}</span>
      </td>
      <td className="px-4 py-3 font-mono text-xs text-slate-500">
        {user.role === "customer" ? (user.phone ?? "-") : (user.employeeCode ?? "-")}
      </td>
      <td className="px-4 py-3 text-center text-xs tabular-nums text-slate-600">{user._count.events}</td>
      <td className="px-4 py-3 text-xs text-slate-600">
        {user.roomSession ? user.roomSession.status.replace(/_/g, " ") : "-"}
      </td>
      <td className="px-4 py-3 text-xs text-slate-500">{relativeTime(user.createdAt)}</td>
    </tr>
  );
}

async function UserSessionsTable() {
  const users = await getAdminUserSessions(50);

  if (users.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
        <p className="text-sm text-slate-500">No visitors yet. The gate has not been used.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              {["Visitor", "Role", "Contact", "Events", "Session", "When"].map((header) => (
                <th key={header} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {users.map((user) => <UserSessionRow key={user.id} user={user} />)}
          </tbody>
        </table>
      </div>
      <div className="border-t border-slate-200 bg-slate-50 px-4 py-2.5">
        <span className="text-xs text-slate-500">Last {users.length} visitors</span>
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  return (
    <div className="min-h-screen bg-[#f6f8fb]">
      <AdminHeader />

      <main className="mx-auto max-w-7xl space-y-10 px-6 py-8">
        <section className="space-y-8">
          <div>
            <h1 className="text-2xl font-semibold text-slate-950">Analytics</h1>
            <p className="mt-1 text-sm text-slate-500">Usage trends and render pipeline health.</p>
          </div>

          <Suspense fallback={<CardsSkeleton />}>
            <SummaryCards />
          </Suspense>

          <div className="grid gap-4 lg:grid-cols-2">
            <Suspense fallback={<ChartSkeleton />}><SessionsChart /></Suspense>
            <Suspense fallback={<ChartSkeleton />}><RendersChart /></Suspense>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Suspense fallback={<ChartSkeleton />}><RenderTimeChart /></Suspense>
            <Suspense fallback={<ChartSkeleton />}><PeakHoursChart /></Suspense>
          </div>
        </section>

        <div className="border-t border-slate-200" />

        <section className="space-y-8">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">Visitors</h2>
            <p className="mt-1 text-sm text-slate-500">Identified users who passed through the pre-access gate.</p>
          </div>

          <Suspense fallback={<CardsSkeleton />}>
            <UserSummaryCards />
          </Suspense>

          <div className="grid gap-4 lg:grid-cols-2">
            <Suspense fallback={<ChartSkeleton />}><UsersPerDayChart /></Suspense>
            <div className="flex min-h-52 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-5 shadow-sm">
              <p className="text-center text-xs text-slate-500">Conversion funnel chart<br />coming soon</p>
            </div>
          </div>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Visitor log</h3>
              <span className="text-xs text-slate-500">Last 50 visitors</span>
            </div>
            <Suspense fallback={<ChartSkeleton />}>
              <UserSessionsTable />
            </Suspense>
          </section>
        </section>
      </main>
    </div>
  );
}
