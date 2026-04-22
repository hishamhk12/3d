// Re-exports for backwards compatibility.
// New code should import directly from session-dashboard.ts.
export {
  getDashboardMetrics as getAdminHealthMetrics,
  getDashboardSessions as getAdminSessions,
  getAdminRenderJobs,
  type DashboardSession as AdminSession,
} from "./session-dashboard";
