import Link from "next/link";
import { AdminHeader } from "../_components/admin-header";
import { getDiagnosticsSessions, type DiagnosticsSessionFilters } from "@/lib/admin/session-diagnostics";
import { ROOM_PREVIEW_SESSION_STATUSES } from "@/lib/room-preview/types";

export const metadata = {
  title: "Diagnostics - Ibdaa 360",
};

type DiagnosticsPageProps = {
  searchParams: Promise<{
    dateFrom?: string;
    dateTo?: string;
    openIssues?: string;
    status?: string;
    stuck?: string;
  }>;
};

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function relativeTime(iso: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function statusBadgeClass(status: string) {
  if (status === "failed") return "bg-red-50 text-red-700 ring-red-200";
  if (status === "completed" || status === "result_ready") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (status === "rendering" || status === "ready_to_render") return "bg-amber-50 text-amber-700 ring-amber-200";
  if (status === "expired") return "bg-slate-100 text-slate-600 ring-slate-200";
  return "bg-blue-50 text-blue-700 ring-blue-200";
}

export default async function AdminDiagnosticsPage({ searchParams }: DiagnosticsPageProps) {
  const params = await searchParams;
  const filters: DiagnosticsSessionFilters = {
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    openIssues: params.openIssues === "1",
    status: params.status || undefined,
    stuck: params.stuck === "1",
  };
  const sessions = await getDiagnosticsSessions(filters);

  return (
    <div className="min-h-screen bg-[#f6f8fb]">
      <AdminHeader />
      <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-950">Session Diagnostics</h1>
            <p className="mt-1 text-sm text-slate-500">
              Persistent events, issues, stuck sessions, and recovery signals.
            </p>
          </div>
          <Link className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm hover:bg-slate-50" href="/admin">
            Dashboard
          </Link>
        </div>

        <form className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-6">
          <label className="space-y-1">
            <span className="text-xs text-slate-500">Status</span>
            <select className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800" defaultValue={filters.status ?? ""} name="status">
              <option value="">Any</option>
              {ROOM_PREVIEW_SESSION_STATUSES.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-slate-500">From</span>
            <input className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800" defaultValue={filters.dateFrom ?? ""} name="dateFrom" type="date" />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-slate-500">To</span>
            <input className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800" defaultValue={filters.dateTo ?? ""} name="dateTo" type="date" />
          </label>
          <label className="flex items-end gap-2 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <input className="mb-1" defaultChecked={filters.openIssues} name="openIssues" type="checkbox" value="1" />
            Open issues
          </label>
          <label className="flex items-end gap-2 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <input className="mb-1" defaultChecked={filters.stuck} name="stuck" type="checkbox" value="1" />
            Stuck only
          </label>
          <div className="flex items-end gap-2">
            <button className="rounded-md bg-[#115ea3] px-4 py-2 text-sm font-medium text-white hover:bg-[#0f548c]" type="submit">
              Filter
            </button>
            <Link className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50" href="/admin/diagnostics">
              Clear
            </Link>
          </div>
        </form>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  {["Session", "Created", "Updated", "Status", "Step", "Last activity", "Issues", "Duration"].map((header) => (
                    <th key={header} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {sessions.map((session) => (
                  <tr key={session.id} className={session.stuck ? "bg-red-50" : "hover:bg-slate-50"}>
                    <td className="px-4 py-3">
                      <Link className="font-mono text-xs text-blue-700 hover:text-blue-900" href={`/admin/diagnostics/${session.id}`}>
                        {session.id.slice(0, 10)}...
                      </Link>
                      {session.stuck ? (
                        <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">stuck</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{relativeTime(session.createdAt)}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{relativeTime(session.updatedAt)}</td>
                    <td className="px-4 py-3 text-xs">
                      <span className={`rounded px-2 py-0.5 ring-1 ${statusBadgeClass(session.status)}`}>
                        {session.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700">{session.currentStep}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{relativeTime(session.lastActivity)}</td>
                    <td className="px-4 py-3 text-center text-xs text-slate-700">{session.openIssueCount}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{formatDuration(session.durationSeconds)}</td>
                  </tr>
                ))}
                {sessions.length === 0 ? (
                  <tr>
                    <td className="px-6 py-12 text-center text-sm text-slate-500" colSpan={8}>
                      No matching sessions.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
