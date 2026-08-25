import { Suspense } from "react";
import { AdminHeader } from "../_components/admin-header";
import { BarChart } from "../_components/bar-chart";
import {
  getRenderErrors,
  computeRenderErrorSummary,
  computeReasonGroups,
  filterByReasonGroup,
  type RenderErrorFilters,
} from "@/lib/admin/render-errors-queries";
import { RenderErrorsTable } from "./_components/RenderErrorsTable";
import { ReasonFilterCards } from "./_components/ReasonFilterCards";
import Link from "next/link";

export const metadata = {
  title: "Render Errors Log - Ibdaa 360",
};

type PageProps = {
  searchParams: Promise<{
    dateFrom?: string;
    dateTo?: string;
    failureReason?: string;
    branch?: string;
    productSearch?: string;
    sessionSearch?: string;
    jobSearch?: string;
    reasonGroup?: string;
  }>;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function msLabel(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function pct(n: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((n / total) * 100)}%`;
}

// ─── Summary cards ────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: "red" | "amber" | "purple" | "slate";
}) {
  const accentClass =
    accent === "red"
      ? "text-red-600"
      : accent === "amber"
      ? "text-amber-600"
      : accent === "purple"
      ? "text-purple-600"
      : "text-slate-800";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1.5 text-2xl font-bold tabular-nums ${accentClass}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

const FAILURE_REASON_OPTIONS = [
  { value: "", label: "Any reason" },
  { value: "gemini_timeout", label: "gemini_timeout" },
  { value: "output_validation_failed", label: "output_validation_failed" },
  { value: "storage_upload_failed", label: "storage_upload_failed" },
  { value: "material_unclear", label: "material_unclear" },
  { value: "floor_not_visible", label: "floor_not_visible" },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function RenderErrorsPage({ searchParams }: PageProps) {
  const params = await searchParams;

  const filters: RenderErrorFilters = {
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    failureReason: params.failureReason || undefined,
    branch: params.branch || undefined,
    productSearch: params.productSearch || undefined,
    sessionSearch: params.sessionSearch || undefined,
    jobSearch: params.jobSearch || undefined,
  };

  const activeReasonGroup = params.reasonGroup || null;

  // Fetch all records matching form filters (date, failureReason, branch, etc.)
  // Counts and aggregation are derived from this full set.
  const allRecords = await getRenderErrors(filters);

  // Apply reason-group in-memory for the table only.
  const tableRecords = activeReasonGroup
    ? filterByReasonGroup(allRecords, activeReasonGroup)
    : allRecords;

  const summary = computeRenderErrorSummary(allRecords);
  const reasonGroups = computeReasonGroups(allRecords);

  // Chart: top 8 reasons by count
  const reasonChartData = Object.entries(summary.reasonCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([reason, count]) => ({
      label: reason.replace(/_/g, " ").slice(0, 12),
      value: count,
    }));

  // Chart: branch distribution
  const branchCounts: Record<string, number> = {};
  for (const r of allRecords) {
    const b = r.branch ?? "unknown";
    branchCounts[b] = (branchCounts[b] ?? 0) + 1;
  }
  const branchChartData = Object.entries(branchCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([branch, count]) => ({ label: branch, value: count }));

  // Chart: floor polygon vs prompt-only
  const floorChartData = [
    { label: "floor polygon", value: allRecords.filter((r) => r.floorPolygonProvided).length },
    { label: "prompt only",   value: allRecords.filter((r) => r.promptOnly).length },
    { label: "neither",       value: allRecords.filter((r) => !r.floorPolygonProvided && !r.promptOnly).length },
  ];

  const hasFilters =
    params.dateFrom ||
    params.dateTo ||
    params.failureReason ||
    params.branch ||
    params.productSearch ||
    params.sessionSearch ||
    params.jobSearch ||
    params.reasonGroup;

  return (
    <div className="min-h-screen bg-[#f6f8fb]">
      <AdminHeader />

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-950">سجل أخطاء الرندر</h1>
            <p className="mt-1 text-sm text-slate-500">
              Render Errors Log — failed render jobs with correlated diagnostics.
            </p>
          </div>
          <Link
            href="/admin/diagnostics"
            className="shrink-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
          >
            Diagnostics
          </Link>
        </div>

        {/* Filter form */}
        <form className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {/* Preserve active reason group when form is submitted */}
          {activeReasonGroup && (
            <input type="hidden" name="reasonGroup" value={activeReasonGroup} />
          )}
          <label className="space-y-1">
            <span className="text-xs text-slate-500">From</span>
            <input
              type="date"
              name="dateFrom"
              defaultValue={filters.dateFrom ?? ""}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-slate-500">To</span>
            <input
              type="date"
              name="dateTo"
              defaultValue={filters.dateTo ?? ""}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-slate-500">Failure reason</span>
            <select
              name="failureReason"
              defaultValue={filters.failureReason ?? ""}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
            >
              {FAILURE_REASON_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-slate-500">Branch</span>
            <select
              name="branch"
              defaultValue={filters.branch ?? ""}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
            >
              <option value="">Any</option>
              <option value="serial">serial</option>
              <option value="parallel">parallel</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-slate-500">Product</span>
            <input
              type="text"
              name="productSearch"
              defaultValue={filters.productSearch ?? ""}
              placeholder="Search…"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-slate-500">Session ID</span>
            <input
              type="text"
              name="sessionSearch"
              defaultValue={filters.sessionSearch ?? ""}
              placeholder="Partial ID…"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
            />
          </label>
          <div className="flex items-end gap-2">
            <button
              type="submit"
              className="flex-1 rounded-md bg-[#115ea3] px-4 py-2 text-sm font-medium text-white hover:bg-[#0f548c]"
            >
              Filter
            </button>
            {hasFilters && (
              <Link
                href="/admin/render-errors"
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Clear
              </Link>
            )}
          </div>
        </form>

        {/* Summary cards */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <SummaryCard
            label="Total Errors"
            value={summary.totalErrors}
            sub={filters.dateFrom ? undefined : "last 7 days"}
            accent="red"
          />
          <SummaryCard
            label="Gemini Timeouts"
            value={summary.geminiTimeouts}
            sub={pct(summary.geminiTimeouts, summary.totalErrors)}
            accent="amber"
          />
          <SummaryCard
            label="Parallel Failures"
            value={summary.parallelFailures}
            sub={pct(summary.parallelFailures, summary.totalErrors)}
            accent="amber"
          />
          <SummaryCard
            label="Prompt-Only"
            value={summary.promptOnlyFailures}
            sub={pct(summary.promptOnlyFailures, summary.totalErrors)}
            accent="purple"
          />
          <SummaryCard
            label="Missing Snapshots"
            value={summary.missingSnapshots}
            sub={pct(summary.missingSnapshots, summary.totalErrors)}
          />
          <SummaryCard
            label="Avg Duration"
            value={msLabel(summary.avgFailedMs)}
          />
          <SummaryCard
            label="Top Reason"
            value={summary.mostCommonReason}
            sub={
              summary.reasonCounts[summary.mostCommonReason]
                ? `${summary.reasonCounts[summary.mostCommonReason]} errors`
                : undefined
            }
            accent="red"
          />
        </div>

        {/* Reason-group aggregation */}
        {reasonGroups.length > 0 && (
          <Suspense>
            <ReasonFilterCards
              groups={reasonGroups}
              activeGroup={activeReasonGroup}
              totalRecords={allRecords.length}
            />
          </Suspense>
        )}

        {/* Charts */}
        {summary.totalErrors > 0 && (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="mb-4 text-sm font-medium text-slate-700">Errors by Reason</p>
              <BarChart data={reasonChartData} color="bg-red-500" height={100} />
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="mb-4 text-sm font-medium text-slate-700">Branch Distribution</p>
              <BarChart data={branchChartData} color="bg-indigo-500" height={100} />
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="mb-4 text-sm font-medium text-slate-700">Floor Detection</p>
              <BarChart
                data={floorChartData}
                color="bg-emerald-500"
                dangerColor="bg-amber-500"
                height={100}
              />
            </div>
          </div>
        )}

        {/* Active reason-group banner */}
        {activeReasonGroup && (
          <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-800">
            <span className="font-medium">Filtering by:</span>
            <span className="font-mono">{activeReasonGroup}</span>
            <span className="text-blue-500">·</span>
            <span className="tabular-nums">{tableRecords.length} of {allRecords.length} errors</span>
          </div>
        )}

        {/* Table */}
        <RenderErrorsTable records={tableRecords} />
      </main>
    </div>
  );
}
