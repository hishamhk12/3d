import { getDashboardSessions } from "@/lib/admin/session-dashboard";
import { isTransientDbError, logAdminDataError } from "@/lib/admin/db-resilience";
import { SessionTabView } from "./session-tab-view";
import { DataUnavailable } from "./data-unavailable";

export async function SessionTable() {
  let sessions;
  try {
    sessions = await getDashboardSessions();
  } catch (err) {
    if (!isTransientDbError(err)) throw err;
    logAdminDataError("session-table", err);
    return <DataUnavailable title="Recent sessions unavailable" />;
  }

  if (sessions.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
        <p className="text-sm text-slate-500">No sessions in the last 4 hours.</p>
      </div>
    );
  }

  return <SessionTabView sessions={sessions} />;
}
