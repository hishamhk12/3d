"use client";

import {
  Card,
  Text,
} from "@fluentui/react-components";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SessionStatusChartDatum } from "@/lib/admin/dashboard-charts";

export default function SessionStatusChart({
  data,
}: {
  data: SessionStatusChartDatum[];
}) {
  return (
    <Card className="border border-slate-200 shadow-sm" size="large">
      <div className="mb-4">
        <Text as="h2" size={500} weight="semibold">Session status distribution</Text>
        <Text as="p" className="mt-1 text-slate-500" size={200}>Current status counts across existing sessions.</Text>
      </div>
      <div className="h-72">
        <ResponsiveContainer height="100%" width="100%">
          <BarChart data={data} margin={{ bottom: 16, left: -16, right: 8, top: 8 }}>
            <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="status" interval={0} tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fill: "#64748b", fontSize: 12 }} tickLine={false} />
            <Tooltip cursor={{ fill: "#f8fafc" }} />
            <Bar dataKey="count" fill="#2563eb" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
