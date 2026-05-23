"use client";

import { Card, Text } from "@fluentui/react-components";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SessionTimelineChartDatum } from "@/lib/admin/dashboard-charts";

export default function SessionTimelineChart({
  data,
}: {
  data: SessionTimelineChartDatum[];
}) {
  return (
    <Card className="border border-slate-200 shadow-sm" size="large">
      <div className="mb-4">
        <Text as="h2" size={500} weight="semibold">Sessions over time</Text>
        <Text as="p" className="mt-1 text-slate-500" size={200}>Created, completed, and failed sessions over the last 7 days.</Text>
      </div>
      <div className="h-72">
        <ResponsiveContainer height="100%" width="100%">
          <LineChart data={data} margin={{ bottom: 8, left: -16, right: 16, top: 8 }}>
            <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 12 }} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fill: "#64748b", fontSize: 12 }} tickLine={false} />
            <Tooltip />
            <Line dataKey="created" name="Created" stroke="#2563eb" strokeWidth={2} type="monotone" />
            <Line dataKey="completed" name="Completed" stroke="#059669" strokeWidth={2} type="monotone" />
            <Line dataKey="failed" name="Failed" stroke="#dc2626" strokeWidth={2} type="monotone" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
