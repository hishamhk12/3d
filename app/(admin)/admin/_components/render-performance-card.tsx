"use client";

import { useCallback, useEffect, useState } from "react";
import type { RenderPerformanceResponse, RenderPerformanceEntry, RenderSpeedLabel } from "@/app/api/admin/render-performance/route";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmtMs(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1_000) return `${ms}ms`;
  return `${(ms / 1_000).toFixed(1)}s`;
}

function relTime(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1_000);
  if (s < 60) return `${s}s ago`;
  if (s < 3_600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3_600)}h ago`;
}

// ─── Speed badge ───────────────────────────────────────────────────────────────

const BADGE: Record<RenderSpeedLabel, { cls: string; label: string }> = {
  fast:    { cls: "bg-emerald-100 text-emerald-700",               label: "Fast"       },
  warning: { cls: "bg-amber-100 text-amber-700",                   label: "Warning"    },
  slow:    { cls: "bg-red-100 text-red-700 ring-1 ring-red-200",   label: "Slow"       },
  failed:  { cls: "bg-red-100 text-red-700",                       label: "Failed"     },
  pending: { cls: "bg-slate-100 text-slate-600 animate-pulse",     label: "In progress"},
};

function SpeedBadge({ label }: { label: RenderSpeedLabel }) {
  const { cls, label: text } = BADGE[label];
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${cls}`}>
      {text}
    </span>
  );
}

// ─── Row ───────────────────────────────────────────────────────────────────────

function JobRow({ job }: { job: RenderPerformanceEntry }) {
  return (
    <tr className={`transition-colors hover:bg-slate-50 ${job.speedLabel === "failed" ? "bg-red-50" : ""}`}>
      <td className="px-4 py-3 font-mono text-xs text-slate-500">{job.sessionIdShort}…</td>
      <td className="px-4 py-3"><SpeedBadge label={job.speedLabel} /></td>
      <td className="px-4 py-3 text-right tabular-nums text-xs font-semibold text-slate-700">
        {fmtMs(job.totalMs)}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-xs text-slate-500">{fmtMs(job.geminiMs)}</td>
      <td className="px-4 py-3 text-right tabular-nums text-xs text-slate-500">{fmtMs(job.imageLoadMs)}</td>
      <td className="px-4 py-3 text-right tabular-nums text-xs text-slate-500">{fmtMs(job.uploadMs)}</td>
      <td className="px-4 py-3 text-right tabular-nums text-xs text-slate-500">{fmtMs(job.setupMs)}</td>
      <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
        {relTime(job.startedAt)}
      </td>
      <td className="max-w-[180px] px-4 py-3 text-xs text-slate-400 truncate">
        {job.modelName ? (
          <span className="font-mono">{job.modelName.replace("gemini-", "")}</span>
        ) : "—"}
        {job.attempt && job.attempt > 1 ? (
          <span className="ml-1 text-amber-500">×{job.attempt}</span>
        ) : null}
      </td>
      {job.failureReason ? (
        <td className="max-w-[200px] px-4 py-3 text-xs text-red-600 truncate" title={job.failureReason}>
          {job.failureReason}
        </td>
      ) : (
        <td className="px-4 py-3" />
      )}
    </tr>
  );
}

// ─── Card ──────────────────────────────────────────────────────────────────────

const COLS = [
  { label: "Session",  align: "text-left"  },
  { label: "Speed",    align: "text-left"  },
  { label: "Total",    align: "text-right" },
  { label: "Gemini",   align: "text-right" },
  { label: "Images",   align: "text-right" },
  { label: "Upload",   align: "text-right" },
  { label: "Setup",    align: "text-right" },
  { label: "Started",  align: "text-left"  },
  { label: "Model",    align: "text-left"  },
  { label: "Failure",  align: "text-left"  },
];

export function RenderPerformanceCard() {
  const [data, setData]       = useState<RenderPerformanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/render-performance", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json() as RenderPerformanceResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const jobs = data?.jobs ?? [];

  // Summary stats
  const completed = jobs.filter((j) => j.status === "completed");
  const avgTotal  = completed.length
    ? Math.round(completed.reduce((s, j) => s + (j.totalMs ?? 0), 0) / completed.length)
    : null;
  const avgGemini = completed.filter((j) => j.geminiMs !== null).length
    ? Math.round(completed.filter((j) => j.geminiMs !== null).reduce((s, j) => s + (j.geminiMs ?? 0), 0) / completed.filter((j) => j.geminiMs !== null).length)
    : null;
  const slowCount = completed.filter((j) => (j.totalMs ?? 0) >= 30_000).length;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Render Performance</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Last {jobs.length} render jobs
            {data?.fetchedAt ? ` · fetched ${relTime(data.fetchedAt)}` : ""}
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {/* Summary bar */}
      {jobs.length > 0 && (
        <div className="flex gap-6 border-b border-slate-100 bg-white px-4 py-2.5">
          <div>
            <span className="text-xs text-slate-500">Avg total</span>
            <span className="ml-2 text-sm font-semibold text-slate-800">{fmtMs(avgTotal)}</span>
          </div>
          <div>
            <span className="text-xs text-slate-500">Avg Gemini</span>
            <span className="ml-2 text-sm font-semibold text-slate-800">{fmtMs(avgGemini)}</span>
          </div>
          <div>
            <span className="text-xs text-slate-500">Slow (&gt;30s)</span>
            <span className={`ml-2 text-sm font-semibold ${slowCount > 0 ? "text-amber-600" : "text-emerald-600"}`}>
              {slowCount}
            </span>
          </div>
        </div>
      )}

      {/* Table */}
      {error ? (
        <div className="px-6 py-8 text-center text-sm text-red-600">{error}</div>
      ) : loading && jobs.length === 0 ? (
        <div className="divide-y divide-slate-100">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex gap-4 px-4 py-3">
              <div className="h-3 w-16 animate-pulse rounded bg-slate-100" />
              <div className="h-3 w-12 animate-pulse rounded bg-slate-100" />
              <div className="h-3 w-10 animate-pulse rounded bg-slate-100" />
              <div className="ml-auto h-3 w-20 animate-pulse rounded bg-slate-100" />
            </div>
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="px-6 py-10 text-center text-sm text-slate-400">No render jobs yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                {COLS.map((c) => (
                  <th
                    key={c.label}
                    className={`px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-slate-400 ${c.align}`}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {jobs.map((job) => <JobRow key={job.renderJobId} job={job} />)}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 bg-slate-50 px-4 py-2">
        {(Object.entries(BADGE) as [RenderSpeedLabel, { cls: string; label: string }][]).map(([k, v]) => (
          <span key={k} className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${v.cls}`}>
            {v.label}
          </span>
        ))}
        <span className="text-xs text-slate-400 ml-auto">Fast &lt;30s · Warning 30–60s · Slow &gt;60s</span>
      </div>
    </div>
  );
}
