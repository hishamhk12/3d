import { Suspense } from "react";
import { AdminHeader } from "./_components/admin-header";
import { HealthBar } from "./_components/health-bar";
import { SessionTable } from "./_components/session-table";
import { RenderJobsFeed } from "./_components/render-jobs-feed";
import { AutoRefresh } from "./_components/auto-refresh";

export const metadata = {
  title: "Admin Dashboard — Ibdaa 360",
};

function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="rounded-xl border border-gray-800 overflow-hidden">
      <div className="border-b border-gray-800 bg-gray-900 px-4 py-3">
        <div className="h-3 w-32 rounded bg-gray-800 animate-pulse" />
      </div>
      <div className="divide-y divide-gray-800/60 bg-gray-950">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex gap-4 px-4 py-3">
            <div className="h-3 w-20 rounded bg-gray-800/60 animate-pulse" />
            <div className="h-3 w-28 rounded bg-gray-800/60 animate-pulse" />
            <div className="h-3 w-16 rounded bg-gray-800/60 animate-pulse" />
            <div className="h-3 w-24 rounded bg-gray-800/60 animate-pulse ml-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricsSkeleton() {
  return (
    <div className="flex divide-x divide-gray-800 rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex-1 px-5 py-4 space-y-2">
          <div className="h-2.5 w-20 rounded bg-gray-800 animate-pulse" />
          <div className="h-7 w-10 rounded bg-gray-800 animate-pulse" />
        </div>
      ))}
    </div>
  );
}

export default function AdminHomePage() {
  return (
    <div className="min-h-screen bg-gray-950">
      <AdminHeader />

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">

        <Suspense fallback={<MetricsSkeleton />}>
          <HealthBar />
        </Suspense>

        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-white">Session Monitor</h2>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-600">Last 4 hours · active &amp; recent</span>
            </div>
          </div>
          <Suspense fallback={<TableSkeleton rows={6} />}>
            <SessionTable />
          </Suspense>
        </section>

        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-white">Render Jobs</h2>
            <div className="flex items-center gap-3">
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
