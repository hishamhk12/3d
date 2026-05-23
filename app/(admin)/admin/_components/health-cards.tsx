"use client";

import {
  Badge,
  Card,
  Text,
} from "@fluentui/react-components";
import type { getDashboardMetrics } from "@/lib/admin/session-dashboard";

type DashboardMetrics = Awaited<ReturnType<typeof getDashboardMetrics>>;

type HealthCard = {
  badge?: "brand" | "danger" | "important" | "informative" | "severe" | "success" | "subtle";
  label: string;
  note?: string;
  value: string | number;
};

export function HealthCards({ metrics }: { metrics: DashboardMetrics }) {
  const cards: HealthCard[] = [
    {
      label: "Live",
      value: metrics.liveCount,
      note: metrics.waitingCount > 0 ? `${metrics.waitingCount} waiting` : "Active sessions",
      badge: metrics.liveCount > 0 ? "informative" : "subtle",
    },
    {
      label: "Rendering",
      value: metrics.renderingCount,
      note: `${metrics.resultReadyCount} result-ready`,
      badge: metrics.renderingCount > 0 ? "important" : "subtle",
    },
    {
      label: "Completed",
      value: metrics.completedCount,
      note: `${metrics.successToday} today`,
      badge: "success",
    },
    {
      label: "Failed",
      value: metrics.failedCount,
      note: `${metrics.failedJobsLastHour} render jobs in 1h`,
      badge: metrics.failedCount > 0 ? "danger" : "subtle",
    },
    {
      label: "Expired",
      value: metrics.expiredCount,
      note: "Closed sessions",
      badge: "subtle",
    },
    {
      label: "Avg render",
      value: metrics.avgRenderSeconds !== null ? `${metrics.avgRenderSeconds}s` : "-",
      note: metrics.rendersToday > 0 ? `${metrics.rendersToday} renders today` : "No renders today",
      badge: "brand",
    },
  ];

  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
      {cards.map((card) => (
        <Card key={card.label} className="border border-slate-200 shadow-sm" size="medium">
          <div className="flex items-start justify-between gap-3">
            <Text className="text-slate-500" size={200} weight="semibold">
              {card.label}
            </Text>
            <Badge appearance="tint" color={card.badge} size="small">
              {card.label}
            </Badge>
          </div>
          <Text className="mt-2 tabular-nums text-slate-950" size={800} weight="semibold">
            {card.value}
          </Text>
          <Text className="text-slate-500" size={200}>{card.note}</Text>
        </Card>
      ))}
    </section>
  );
}
