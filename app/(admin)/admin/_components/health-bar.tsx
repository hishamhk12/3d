import { getDashboardMetrics } from "@/lib/admin/session-dashboard";
import { isTransientDbError, logAdminDataError } from "@/lib/admin/db-resilience";
import { HealthCards } from "./health-cards";
import { DataUnavailable } from "./data-unavailable";

export async function HealthBar() {
  try {
    const metrics = await getDashboardMetrics();
    return <HealthCards metrics={metrics} />;
  } catch (err) {
    if (!isTransientDbError(err)) throw err;
    logAdminDataError("health-bar", err);
    return <DataUnavailable title="Live metrics unavailable" />;
  }
}
