"use client";

import { useState } from "react";
import Link from "next/link";
import type { RenderErrorRecord, AttemptRow } from "@/lib/admin/render-errors-queries";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function msLabel(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function reasonClass(reason: string | null): string {
  if (!reason) return "bg-slate-100 text-slate-500";
  if (reason === "gemini_timeout") return "bg-amber-50 text-amber-700 ring-1 ring-amber-200";
  if (reason === "storage_upload_failed") return "bg-red-50 text-red-700 ring-1 ring-red-200";
  if (reason === "output_validation_failed") return "bg-orange-50 text-orange-700 ring-1 ring-orange-200";
  if (reason === "floor_not_visible" || reason === "material_unclear")
    return "bg-purple-50 text-purple-700 ring-1 ring-purple-200";
  return "bg-red-50 text-red-600 ring-1 ring-red-200";
}

function attemptStatusClass(status: string, abortedByTimeout: boolean): string {
  if (status === "timed_out" || abortedByTimeout) return "text-amber-400";
  if (status === "failed" || status === "error") return "text-red-400";
  if (status === "success") return "text-emerald-400";
  return "text-slate-400";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function AttemptsPanel({ rows }: { rows: AttemptRow[] }) {
  if (rows.length === 0) return <p className="text-xs text-slate-500">No attempt data</p>;
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-slate-700 text-[10px] uppercase tracking-wide text-slate-500">
          <th className="pb-1 pr-4 text-left font-medium">#</th>
          <th className="pb-1 pr-4 text-left font-medium">Model</th>
          <th className="pb-1 pr-4 text-left font-medium">Duration</th>
          <th className="pb-1 pr-4 text-left font-medium">Timeout</th>
          <th className="pb-1 text-left font-medium">Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.attempt}>
            <td className="py-0.5 pr-4 text-slate-400">{r.attempt}</td>
            <td className="py-0.5 pr-4 font-mono text-slate-300">{r.modelName ?? "—"}</td>
            <td className="py-0.5 pr-4 font-mono text-slate-300">{msLabel(r.durationMs)}</td>
            <td className="py-0.5 pr-4 font-mono text-slate-400">{msLabel(r.attemptTimeoutMs)}</td>
            <td className={`py-0.5 font-mono ${attemptStatusClass(r.status, r.abortedByTimeout)}`}>
              {r.abortedByTimeout && r.status !== "timed_out" ? "timed_out" : r.status}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function JsonPanel({ title, data }: { title: string; data: Record<string, unknown> | null }) {
  if (!data) return null;
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <pre className="max-h-48 overflow-auto rounded border border-slate-700 bg-slate-950 p-2 text-[10px] leading-4 text-emerald-300 whitespace-pre-wrap">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const HEADERS = [
  "Time", "Session", "Job", "Product",
  "Reason", "Branch", "Parallel", "Prompt Only",
  "Floor", "Total", "Gemini", "Attempts",
  "All TO", "All Failed", "Model", "Quality",
  "Prompt Ver", "Dimensions", "Snap", "Action",
  "",
];

export function RenderErrorsTable({ records }: { records: RenderErrorRecord[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (records.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white py-16 text-center text-sm text-slate-400 shadow-sm">
        No render errors found for the selected filters.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1600px] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              {HEADERS.map((h, i) => (
                <th
                  key={i}
                  className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>

          {records.map((r) => {
            const isOpen = expanded.has(r.jobId);
            const ts = new Date(r.createdAt);
            const timeStr = ts.toLocaleTimeString("en", { hour12: false });
            const dateStr = ts.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

            return (
              <tbody key={r.jobId}>
                <tr
                  className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                  onClick={() => toggle(r.jobId)}
                >
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="block font-mono text-[11px] text-slate-700">{timeStr}</span>
                    <span className="block font-mono text-[10px] text-slate-400">{dateStr}</span>
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/admin/diagnostics/${r.sessionId}`}
                      className="font-mono text-[11px] text-blue-600 hover:text-blue-800 hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.sessionId.slice(0, 10)}…
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-slate-400">
                    {r.jobId.slice(0, 8)}…
                  </td>
                  <td className="px-3 py-2 max-w-[7rem] truncate text-xs text-slate-700">
                    {r.productName ?? <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${reasonClass(r.failureReason)}`}>
                      {r.failureReason ?? "unknown"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">{r.branch ?? "—"}</td>
                  <td className="px-3 py-2 text-center text-xs">
                    {r.parallelEnabled === true
                      ? <span className="text-emerald-600 font-bold">✓</span>
                      : r.parallelEnabled === false
                      ? <span className="text-slate-400">✗</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-center text-xs">
                    {r.promptOnly ? <span className="text-amber-600 font-bold">✓</span> : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-center text-xs">
                    {r.floorPolygonProvided
                      ? <span className="text-emerald-600">✓</span>
                      : <span className="text-red-400">✗</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-[11px] text-slate-600">
                    {msLabel(r.totalMs)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-[11px] text-slate-600">
                    {msLabel(r.geminiMs)}
                  </td>
                  <td className="px-3 py-2 text-center font-mono text-[11px] text-slate-600">
                    {r.attemptsCount ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-center text-xs">
                    {r.allTimedOut ? <span className="text-amber-600 font-bold">✓</span> : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-center text-xs">
                    {r.allFailed ? <span className="text-red-600 font-bold">✓</span> : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-slate-500 max-w-[8rem] truncate">
                    {r.modelName ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-[11px] text-slate-500">{r.qualityMode ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-[10px] text-slate-400">{r.promptVersion ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-[10px] text-slate-500 whitespace-nowrap">
                    {r.inputWidth && r.inputHeight ? `${r.inputWidth}×${r.inputHeight}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-center text-xs">
                    {r.hasSnapshot
                      ? <span className="text-emerald-600">✓</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2 max-w-[11rem] text-[10px] text-slate-600" dir="rtl">
                    {r.recommendedAction}
                  </td>
                  <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => toggle(r.jobId)}
                      aria-label={isOpen ? "Collapse row" : "Expand row"}
                      className="rounded px-1.5 py-0.5 font-mono text-[11px] text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                    >
                      {isOpen ? "▼" : "▶"}
                    </button>
                  </td>
                </tr>

                {isOpen && (
                  <tr className="border-t border-slate-200 bg-slate-900">
                    <td colSpan={HEADERS.length} className="px-6 py-5">
                      <div className="grid gap-5 lg:grid-cols-2">
                        {/* Left: error info + attempts */}
                        <div className="space-y-4">
                          {r.errorMessage && (
                            <div>
                              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                Error Message
                              </p>
                              <p className="rounded border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-red-300">
                                {r.errorMessage}
                              </p>
                            </div>
                          )}
                          {r.errorCode && (
                            <div>
                              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                Error Code
                              </p>
                              <p className="font-mono text-xs text-red-400">{r.errorCode}</p>
                            </div>
                          )}

                          <div>
                            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                              Attempt Timings
                            </p>
                            <AttemptsPanel rows={r.attemptRows} />
                          </div>

                          {r.winnerAttemptId && (
                            <div>
                              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                Winner Attempt ID
                              </p>
                              <p className="font-mono text-[11px] text-emerald-400">{r.winnerAttemptId}</p>
                            </div>
                          )}

                          {r.rawEnableParallel && (
                            <div>
                              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                Raw Parallel Env
                              </p>
                              <p className="font-mono text-[11px] text-slate-400">{r.rawEnableParallel}</p>
                            </div>
                          )}
                        </div>

                        {/* Right: raw JSON panels */}
                        <div className="space-y-4">
                          <JsonPanel title="render_timing_summary" data={r.rawTimingSummary} />
                          <JsonPanel title="render_branch_resolved" data={r.rawBranchResolved} />
                          <JsonPanel title="render_diagnostics_snapshot" data={r.rawSnapshot} />
                        </div>
                      </div>

                      <div className="mt-4 border-t border-slate-700 pt-4 flex items-start gap-3">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 shrink-0 mt-0.5">
                          الإجراء الموصى به
                        </span>
                        <p className="text-sm text-amber-300 font-medium" dir="rtl">
                          {r.recommendedAction}
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            );
          })}
        </table>
      </div>
      <p className="border-t border-slate-100 px-4 py-2 text-right font-mono text-[10px] text-slate-400">
        {records.length} records
      </p>
    </div>
  );
}
