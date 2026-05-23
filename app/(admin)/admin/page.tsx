import { Suspense } from "react";
import { AdminHeader } from "./_components/admin-header";
import { AutoRefresh } from "./_components/auto-refresh";
import { DashboardCharts } from "./_components/dashboard-charts";
import { HealthBar } from "./_components/health-bar";
import { MarkStuckRenderJobsButton } from "./_components/mark-stuck-render-jobs-button";
import { RenderJobsFeed } from "./_components/render-jobs-feed";
import { SessionTable } from "./_components/session-table";

export const metadata = {
  title: "Admin Dashboard - Ibdaa 360",
};

function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div className="h-3 w-32 animate-pulse rounded bg-slate-200" />
      </div>
      <div className="divide-y divide-slate-100">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex gap-4 px-4 py-3">
            <div className="h-3 w-20 animate-pulse rounded bg-slate-200" />
            <div className="h-3 w-28 animate-pulse rounded bg-slate-200" />
            <div className="h-3 w-16 animate-pulse rounded bg-slate-200" />
            <div className="ml-auto h-3 w-24 animate-pulse rounded bg-slate-200" />
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricsSkeleton() {
  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="h-3 w-20 animate-pulse rounded bg-slate-200" />
          <div className="mt-4 h-8 w-12 animate-pulse rounded bg-slate-200" />
          <div className="mt-3 h-3 w-28 animate-pulse rounded bg-slate-200" />
        </div>
      ))}
    </section>
  );
}

function ChartsSkeleton() {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-80 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="h-4 w-44 animate-pulse rounded bg-slate-200" />
          <div className="mt-8 h-56 animate-pulse rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

export default function AdminHomePage() {
  return (
    <div className="min-h-screen bg-[#f6f8fb]">
      <AdminHeader />

      <main className="mx-auto max-w-7xl space-y-8 px-6 py-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Room Preview Operations</h1>
          <p className="mt-1 text-sm text-slate-500">
            Monitor live sessions, rendering health, diagnostics, and recent operational issues.
          </p>
        </div>

        <Suspense fallback={<MetricsSkeleton />}>
          <HealthBar />
        </Suspense>

        <Suspense fallback={<ChartsSkeleton />}>
          <DashboardCharts />
        </Suspense>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Recent sessions</h2>
            <span className="text-xs text-slate-500">Last 4 hours, active and recent</span>
          </div>
          <Suspense fallback={<TableSkeleton rows={6} />}>
            <SessionTable />
          </Suspense>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Render jobs</h2>
            <div className="flex items-center gap-3">
              <MarkStuckRenderJobsButton />
              <AutoRefresh intervalSeconds={10} />
            </div>
          </div>
          <Suspense fallback={<TableSkeleton rows={8} />}>
            <RenderJobsFeed />
          </Suspense>
        </section>
      </main>
    </div>
  );
}
