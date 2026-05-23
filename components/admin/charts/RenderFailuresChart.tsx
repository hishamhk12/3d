"use client";

import { Card, Text } from "@fluentui/react-components";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { RenderFailuresChartDatum } from "@/lib/admin/dashboard-charts";

export default function RenderFailuresChart({
  data,
}: {
  data: RenderFailuresChartDatum[];
}) {
  return (
    <Card className="border border-slate-200 shadow-sm" size="large">
      <div className="mb-4">
        <Text as="h2" size={500} weight="semibold">Render failures</Text>
        <Text as="p" className="mt-1 text-slate-500" size={200}>Failed render jobs compared with total render jobs over the last 7 days.</Text>
      </div>
      <div className="h-64">
        <ResponsiveContainer height="100%" width="100%">
          <BarChart data={data} margin={{ bottom: 8, left: -16, right: 8, top: 8 }}>
            <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 12 }} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fill: "#64748b", fontSize: 12 }} tickLine={false} />
            <Tooltip cursor={{ fill: "#f8fafc" }} />
            <Bar dataKey="total" fill="#bfdbfe" name="Total" radius={[4, 4, 0, 0]} />
            <Bar dataKey="failed" fill="#dc2626" name="Failed" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
