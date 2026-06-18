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

export default function SettingsTab({ state }: { state: StatusState }) {
  const { status, loading, error, refresh } = state;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Settings &amp; Status</h2>
          <p className="mt-1 text-xs text-slate-500">
            Read-only integration state for the seller chatbot.
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

      {loading && !status ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <Spinner size="tiny" label="Loading status..." />
        </div>
      ) : null}

      {status ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <dl className="divide-y divide-slate-100">
            <SettingRow label="Data source" value="Excel" status={status.dataSource.status} />
            <SettingRow label="SAP" value="Not configured" status={status.sap.status} />
            <SettingRow
              label="Seller chat"
              value={status.features.sellerChat.enabled ? "Enabled" : "Disabled"}
              status={status.features.sellerChat.status}
            />
            <SettingRow
              label="Autocomplete"
              value={status.features.autocomplete.enabled ? "Enabled" : "Unavailable"}
              status={status.features.autocomplete.status}
            />
            <SettingRow
              label="Technical documents"
              value="Disabled"
              status={status.features.technicalDocuments.status}
            />
            <SettingRow label="Voice" value="Disabled" status={status.features.voice.status} />
            <SettingRow
              label="Web knowledge"
              value="Disabled"
              status={status.features.webKnowledge.status}
            />
          </dl>
        </div>
      ) : null}
    </div>
  );
}

function SettingRow({
  label,
  value,
  status,
}: {
  label: string;
  value: string;
  status: StatusValue;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 px-4 py-3 text-sm">
      <dt className="font-medium text-slate-700">{label}</dt>
      <dd className="text-slate-900">{value}</dd>
      <dd className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
        {STATUS_LABEL[status]}
      </dd>
    </div>
  );
}

