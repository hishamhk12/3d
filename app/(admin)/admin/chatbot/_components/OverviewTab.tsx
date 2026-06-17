"use client";

import { Button, Spinner } from "@fluentui/react-components";
import type { StatusState, StatusValue } from "./status-types";

const STATUS_LABEL: Record<StatusValue, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  unavailable: "Unavailable",
  disabled: "Disabled",
  not_configured: "Not configured",
};

const STATUS_DOT: Record<StatusValue, string> = {
  healthy: "bg-emerald-500",
  degraded: "bg-amber-500",
  unavailable: "bg-red-500",
  disabled: "bg-slate-400",
  not_configured: "bg-slate-400",
};

export default function OverviewTab({ state }: { state: StatusState }) {
  const { status, loading, error, refresh } = state;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Overview</h2>
          <p className="mt-1 text-xs text-slate-500">
            Current chatbot readiness and local seller-management counts.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {status ? (
            <span className="text-xs text-slate-400">
              Last checked {formatDateTime(status.checkedAt)}
            </span>
          ) : null}
          <Button size="small" appearance="secondary" onClick={refresh} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {loading && !status ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <Spinner size="tiny" label="Loading status..." />
        </div>
      ) : null}

      {status ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatusCard
            title="Chatbot API"
            value={status.fastapi.reachable ? "Reachable" : "Not reachable"}
            status={status.fastapi.status}
          />
          <StatusCard
            title="Inventory database"
            value={status.database.reachable === true ? "Reachable" : "Not reachable"}
            status={status.database.status}
          />
          <StatusCard
            title="Gemini"
            value={status.gemini.configured ? "Configured" : "Fallback only"}
            status={status.gemini.status}
          />
          <StatusCard
            title="Seller chat"
            value={status.features.sellerChat.enabled ? "Enabled" : "Disabled"}
            status={status.features.sellerChat.status}
          />
          <StatusCard
            title="Inventory records"
            value={formatNumber(status.inventory.rowCount)}
            status={status.inventory.status}
          />
          <StatusCard
            title="Last Excel update"
            value={formatNullableDate(status.imports.latestSuccessfulImportAt)}
            status={status.imports.status}
          />
          <StatusCard
            title="Sellers"
            value={formatNumber(status.local.sellerCount)}
            status={status.local.status}
          />
          <StatusCard
            title="Showrooms"
            value={formatNumber(status.local.showroomCount)}
            status={status.local.status}
          />
        </div>
      ) : null}
    </div>
  );
}

function StatusCard({
  title,
  value,
  status,
}: {
  title: string;
  value: string;
  status: StatusValue;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase text-slate-400">{title}</p>
        <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-slate-500">
          <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[status]}`} />
          {STATUS_LABEL[status]}
        </span>
      </div>
      <p className="mt-3 text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function formatNumber(value: number | null): string {
  return typeof value === "number" ? value.toLocaleString() : "Unavailable";
}

function formatNullableDate(value: string | null): string {
  if (!value) return "No successful import";
  return formatDateTime(value);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return date.toLocaleString();
}

