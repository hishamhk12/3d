import { getDashboardMetrics } from "@/lib/admin/session-dashboard";

function Stat({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string | number;
  sub?: string;
  highlight?: "red" | "amber" | "green" | "blue";
}) {
  const valueClass =
    highlight === "red"
      ? "text-red-400"
      : highlight === "amber"
        ? "text-amber-400"
        : highlight === "green"
          ? "text-green-400"
          : highlight === "blue"
            ? "text-blue-400"
            : "text-white";

  return (
    <div className="flex-1 min-w-0 px-5 py-4">
      <p className="text-xs font-medium text-gray-500 truncate">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${valueClass}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-600">{sub}</p>}
    </div>
  );
}

export async function HealthBar() {
  const m = await getDashboardMetrics();

  return (
    <div className="flex divide-x divide-gray-800 rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
      <Stat
        label="Live sessions"
        value={m.liveCount}
        sub={m.waitingCount > 0 ? `${m.waitingCount} waiting for mobile` : undefined}
        highlight={m.liveCount > 0 ? "blue" : undefined}
      />
      <Stat
        label="Rendering now"
        value={m.renderingCount}
        highlight={m.renderingCount > 0 ? "amber" : undefined}
      />
      <Stat
        label="Completed today"
        value={m.successToday}
        highlight={m.successToday > 0 ? "green" : undefined}
      />
      <Stat
        label="Render jobs failed (1h)"
        value={m.failedJobsLastHour}
        highlight={m.failedJobsLastHour > 0 ? "red" : undefined}
      />
      <Stat
        label="Avg render time"
        value={m.avgRenderSeconds !== null ? `${m.avgRenderSeconds}s` : "—"}
        sub={m.rendersToday > 0 ? `${m.rendersToday} renders today` : undefined}
      />
    </div>
  );
}
