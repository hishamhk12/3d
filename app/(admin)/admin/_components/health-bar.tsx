import { getDashboardMetrics } from "@/lib/admin/session-dashboard";
import { isTransientDbError, logAdminDataError } from "@/lib/admin/db-resilience";
import { HealthCards } from "./health-cards";
import { DataUnavailable } from "./data-unavailable";

export async function HealthBar() {
  let metrics: Awaited<ReturnType<typeof getDashboardMetrics>> | null = null;
  try {
    metrics = await getDashboardMetrics();
  } catch (err) {
    if (!isTransientDbError(err)) throw err;
    logAdminDataError("health-bar", err);
  }
  if (!metrics) {
    return <DataUnavailable title="Live metrics unavailable" />;
  }
  return <HealthCards metrics={metrics} />;
}
