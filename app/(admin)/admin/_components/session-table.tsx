import { getDashboardSessions } from "@/lib/admin/session-dashboard";
import { SessionTabView } from "./session-tab-view";

export async function SessionTable() {
  const sessions = await getDashboardSessions();

  if (sessions.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
        <p className="text-sm text-slate-500">No sessions in the last 4 hours.</p>
      </div>
    );
  }

  return <SessionTabView sessions={sessions} />;
}
