import IssueCodeChart from "@/components/admin/charts/IssueCodeChart";
import MobileConnectionChart from "@/components/admin/charts/MobileConnectionChart";
import RenderFailuresChart from "@/components/admin/charts/RenderFailuresChart";
import SessionStatusChart from "@/components/admin/charts/SessionStatusChart";
import SessionTimelineChart from "@/components/admin/charts/SessionTimelineChart";
import { getAdminDashboardChartData } from "@/lib/admin/dashboard-charts";
import { isTransientDbError, logAdminDataError } from "@/lib/admin/db-resilience";
import { DataUnavailable } from "./data-unavailable";

export async function DashboardCharts() {
  let chartData;
  try {
    chartData = await getAdminDashboardChartData();
  } catch (err) {
    if (!isTransientDbError(err)) throw err;
    logAdminDataError("dashboard-charts", err);
    return <DataUnavailable title="Dashboard charts unavailable" />;
  }

  return (
    <>
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <SessionStatusChart data={chartData.sessionStatusData} />
        <MobileConnectionChart data={chartData.mobileConnectionData} />
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <SessionTimelineChart data={chartData.sessionTimelineData} />
        <RenderFailuresChart data={chartData.renderFailuresData} />
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <IssueCodeChart data={chartData.issueCodeData} />
      </section>
    </>
  );
}
