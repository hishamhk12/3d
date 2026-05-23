"use client";

import { Card, Text } from "@fluentui/react-components";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { MobileConnectionDatum } from "@/lib/admin/dashboard-charts";

const COLORS = ["#2563eb", "#cbd5e1"];

export default function MobileConnectionChart({
  data,
}: {
  data: MobileConnectionDatum[];
}) {
  const chartData = data.length > 0 ? data : [{ name: "No sessions", count: 0 }];

  return (
    <Card className="border border-slate-200 shadow-sm" size="large">
      <div className="mb-3">
        <Text as="h2" size={500} weight="semibold">Mobile connection</Text>
        <Text as="p" className="mt-1 text-slate-500" size={200}>Live and recent sessions grouped by mobile connection state.</Text>
      </div>
      <div className="grid min-h-64 grid-cols-[1fr_auto] items-center gap-4">
        <div className="h-56">
          <ResponsiveContainer height="100%" width="100%">
            <PieChart>
              <Pie
                data={chartData}
                dataKey="count"
                innerRadius={58}
                nameKey="name"
                outerRadius={86}
                paddingAngle={2}
              >
                {chartData.map((entry, index) => (
                  <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-2 text-sm">
          {chartData.map((entry, index) => (
            <div key={entry.name} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-2 text-slate-600">
                <span
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: COLORS[index % COLORS.length] }}
                />
                {entry.name}
              </span>
              <span className="font-semibold tabular-nums text-slate-900">{entry.count}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
