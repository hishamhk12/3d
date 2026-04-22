import { getDashboardSessions } from "@/lib/admin/session-dashboard";
import { SessionTabView } from "./session-tab-view";

export async function SessionTable() {
  const sessions = await getDashboardSessions();

  if (sessions.length === 0) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-6 py-12 text-center">
        <p className="text-sm text-gray-500">No sessions in the last 4 hours.</p>
      </div>
    );
  }

  return <SessionTabView sessions={sessions} />;
}
