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
    <div className="min-h-screen bg-gray-950">
      <AdminHeader />
      <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-white">Session Diagnostics</h1>
            <p className="mt-1 text-sm text-gray-500">Persistent events, issues, stuck sessions, and recovery signals.</p>
          </div>
          <Link href="/admin" className="rounded-md border border-gray-800 px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-900 hover:text-white">
            Dashboard
          </Link>
        </div>

        <form className="grid gap-3 rounded-xl border border-gray-800 bg-gray-900/60 p-4 sm:grid-cols-2 lg:grid-cols-6">
          <label className="space-y-1">
            <span className="text-xs text-gray-500">Status</span>
            <select name="status" defaultValue={filters.status ?? ""} className="w-full rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-200">
              <option value="">Any</option>
              {ROOM_PREVIEW_SESSION_STATUSES.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-gray-500">From</span>
            <input name="dateFrom" type="date" defaultValue={filters.dateFrom ?? ""} className="w-full rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-200" />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-gray-500">To</span>
            <input name="dateTo" type="date" defaultValue={filters.dateTo ?? ""} className="w-full rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-200" />
          </label>
          <label className="flex items-end gap-2 rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-300">
            <input name="openIssues" value="1" type="checkbox" defaultChecked={filters.openIssues} className="mb-1" />
            Open issues
          </label>
          <label className="flex items-end gap-2 rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-300">
            <input name="stuck" value="1" type="checkbox" defaultChecked={filters.stuck} className="mb-1" />
            Stuck only
          </label>
          <div className="flex items-end gap-2">
            <button type="submit" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
              Filter
            </button>
            <Link href="/admin/diagnostics" className="rounded-md border border-gray-800 px-4 py-2 text-sm text-gray-400 hover:text-white">
              Clear
            </Link>
          </div>
        </form>

        <div className="overflow-hidden rounded-xl border border-gray-800">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-800 bg-gray-900">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Session</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Created</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Updated</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Step</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Last activity</th>
                <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">Issues</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/70 bg-gray-950">
              {sessions.map((session) => (
                <tr key={session.id} className={session.stuck ? "bg-red-950/10" : "hover:bg-gray-900/50"}>
                  <td className="px-4 py-3">
                    <Link href={`/admin/diagnostics/${session.id}`} className="font-mono text-xs text-indigo-300 hover:text-indigo-200">
                      {session.id.slice(0, 10)}...
                    </Link>
                    {session.stuck ? (
                      <span className="ml-2 rounded bg-red-950 px-1.5 py-0.5 text-xs text-red-300">stuck</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{relativeTime(session.createdAt)}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{relativeTime(session.updatedAt)}</td>
                  <td className="px-4 py-3 text-xs text-gray-300">{session.status}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{session.currentStep}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{relativeTime(session.lastActivity)}</td>
                  <td className="px-4 py-3 text-center text-xs text-gray-300">{session.openIssueCount}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{formatDuration(session.durationSeconds)}</td>
                </tr>
              ))}
              {sessions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-sm text-gray-500">No matching sessions.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
