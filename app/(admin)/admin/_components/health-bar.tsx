import { getDashboardMetrics } from "@/lib/admin/session-dashboard";
import { HealthCards } from "./health-cards";

export async function HealthBar() {
  const metrics = await getDashboardMetrics();

  return <HealthCards metrics={metrics} />;
}
