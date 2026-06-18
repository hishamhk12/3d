"use client";

import { useEffect, useState } from "react";
import { Button, Spinner } from "@fluentui/react-components";
import { apiGet, errorMessage } from "./client-api";

const METRICS_URL = "/api/admin/chatbot/metrics";
const HISTORY_URL = "/api/admin/chatbot/import/history";

type TopValue = { value: string; count: number };

type ActivitySeller = {
  sellerCode: string | null;
  sellerName: string | null;
  showroomCode: string | null;
  available: boolean;
};

type ActivityRow = {
  timestamp: string | null;
  externalActorId: string | null;
  productCode: string | null;
  warehouse: string | null;
  intent: string | null;
  seller: ActivitySeller;
};

type MetricsResponse = {
  status: "ready" | "degraded";
  questionsToday: number;
  questionsThisWeek: number;
  distinctExternalSellers: number;
  topProductCodes: TopValue[];
  topWarehouses: TopValue[];
  aiVsFallback: { ai: number; fallback: number };
  recentActivity: ActivityRow[];
  error?: string;
};

type ImportHistoryItem = {
  timestamp: string | null;
  filename: string | null;
  status: string | null;
  rowsImported: number | null;
  rowsFailed: number | null;
};

type HistoryResponse = {
  status: "ready" | "degraded";
  items: ImportHistoryItem[];
  error?: string;
};

export default function ActivityTab() {
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let ignore = false;
    (async () => {
      const [metricsResult, historyResult] = await Promise.all([
        apiGet<MetricsResponse>(METRICS_URL),
        apiGet<HistoryResponse>(HISTORY_URL),
      ]);
      if (ignore) return;

      if (!metricsResult.ok || !historyResult.ok) {
        setError(
          !metricsResult.ok
            ? errorMessage(metricsResult, "Could not load chatbot activity.")
            : errorMessage(historyResult, "Could not load import history."),
        );
      } else {
        setError(null);
      }

      setMetrics(metricsResult.ok ? metricsResult.data : degradedMetrics());
      setHistory(historyResult.ok ? historyResult.data : degradedHistory());
      setLoading(false);
    })();
    return () => {
      ignore = true;
    };
  }, [reloadKey]);

  const degraded = metrics?.status === "degraded" || history?.status === "degraded";

  function refresh() {
    setLoading(true);
    setError(null);
    setReloadKey((k) => k + 1);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Activity</h2>
          <p className="mt-1 text-xs text-slate-500">
            Safe seller-chat activity, aggregate metrics, and recent inventory imports.
          </p>
        </div>
        <Button size="small" appearance="secondary" onClick={refresh} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {degraded ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Some activity data is temporarily unavailable.
        </div>
      ) : null}

      {loading && !metrics && !history ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <Spinner size="tiny" label="Loading activity..." />
        </div>
      ) : null}

      {metrics ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <SummaryCard label="Questions today" value={metrics.questionsToday} />
            <SummaryCard label="Questions this week" value={metrics.questionsThisWeek} />
            <SummaryCard label="Active sellers" value={metrics.distinctExternalSellers} />
            <SummaryCard label="AI responses" value={metrics.aiVsFallback.ai} />
            <SummaryCard label="Fallback responses" value={metrics.aiVsFallback.fallback} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <TopList title="Top product codes" items={metrics.topProductCodes} empty="No product activity yet." />
            <TopList title="Top warehouses" items={metrics.topWarehouses} empty="No warehouse activity yet." />
          </div>

          <ActivityTable rows={metrics.recentActivity} />
        </>
      ) : null}

      {history ? <ImportHistoryTable items={history.items} /> : null}
    </div>
  );
}

function degradedMetrics(): MetricsResponse {
  return {
    status: "degraded",
    questionsToday: 0,
    questionsThisWeek: 0,
    distinctExternalSellers: 0,
    topProductCodes: [],
    topWarehouses: [],
    aiVsFallback: { ai: 0, fallback: 0 },
    recentActivity: [],
  };
}

function degradedHistory(): HistoryResponse {
  return { status: "degraded", items: [] };
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{formatNumber(value)}</p>
    </div>
  );
}

function TopList({ title, items, empty }: { title: string; items: TopValue[]; empty: string }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {items.map((item) => (
            <li key={item.value} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="font-mono font-medium text-slate-900">{item.value}</span>
              <span className="text-slate-500">{formatNumber(item.count)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ActivityTable({ rows }: { rows: ActivityRow[] }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-900">Recent seller activity</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Timestamp</th>
              <th className="px-4 py-3 font-medium">Seller</th>
              <th className="px-4 py-3 font-medium">Showroom</th>
              <th className="px-4 py-3 font-medium">Product</th>
              <th className="px-4 py-3 font-medium">Warehouse</th>
              <th className="px-4 py-3 font-medium">Intent</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No recent seller activity.
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => (
                <tr key={`${row.timestamp ?? "activity"}-${idx}`} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 text-slate-600">{formatDate(row.timestamp)}</td>
                  <td className="px-4 py-3">
                    {row.seller.available ? (
                      <div>
                        <p className="font-mono font-semibold text-slate-900">{row.seller.sellerCode}</p>
                        <p className="text-xs text-slate-500">{row.seller.sellerName}</p>
                      </div>
                    ) : (
                      <span className="text-slate-500">Unavailable seller</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-600">{row.seller.showroomCode ?? "-"}</td>
                  <td className="px-4 py-3 font-mono text-slate-700">{row.productCode ?? "-"}</td>
                  <td className="px-4 py-3 font-mono text-slate-700">{row.warehouse ?? "-"}</td>
                  <td className="px-4 py-3 text-slate-700">{row.intent ?? "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ImportHistoryTable({ items }: { items: ImportHistoryItem[] }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-900">Recent inventory imports</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Timestamp</th>
              <th className="px-4 py-3 font-medium">Filename</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Rows imported</th>
              <th className="px-4 py-3 font-medium">Rows failed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  No recent imports.
                </td>
              </tr>
            ) : (
              items.map((item, idx) => (
                <tr key={`${item.timestamp ?? "import"}-${idx}`} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 text-slate-600">{formatDate(item.timestamp)}</td>
                  <td className="px-4 py-3 text-slate-900">{item.filename ?? "-"}</td>
                  <td className="px-4 py-3 text-slate-700">{item.status ?? "-"}</td>
                  <td className="px-4 py-3 text-slate-700">{formatNullableNumber(item.rowsImported)}</td>
                  <td className="px-4 py-3 text-slate-700">{formatNullableNumber(item.rowsFailed)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatNumber(value: number): string {
  return value.toLocaleString();
}

function formatNullableNumber(value: number | null): string {
  return typeof value === "number" ? value.toLocaleString() : "-";
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}
