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
import type { IssueCodeChartDatum } from "@/lib/admin/dashboard-charts";

export default function IssueCodeChart({
  data,
}: {
  data: IssueCodeChartDatum[];
}) {
  const chartData = data.length > 0 ? data : [{ issueType: "No issues", count: 0 }];

  return (
    <Card className="border border-slate-200 shadow-sm" size="large">
      <div className="mb-4">
        <Text as="h2" size={500} weight="semibold">Recent issues by code</Text>
        <Text as="p" className="mt-1 text-slate-500" size={200}>Session issue counts from the last 7 days.</Text>
      </div>
      <div className="h-64">
        <ResponsiveContainer height="100%" width="100%">
          <BarChart data={chartData} layout="vertical" margin={{ bottom: 8, left: 64, right: 16, top: 8 }}>
            <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" horizontal={false} />
            <XAxis allowDecimals={false} tick={{ fill: "#64748b", fontSize: 12 }} tickLine={false} type="number" />
            <YAxis dataKey="issueType" tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} type="category" width={116} />
            <Tooltip cursor={{ fill: "#f8fafc" }} />
            <Bar dataKey="count" fill="#7c3aed" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
