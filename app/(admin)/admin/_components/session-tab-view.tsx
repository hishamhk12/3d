"use client";

import { useState } from "react";
import type { DashboardSession, SessionStatusGroup } from "@/lib/admin/session-dashboard";
import { forceExpireSession, forceResetSession } from "../actions";

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "live" | "success" | "closed" | "problem" | "all";

const TABS: { id: Tab; label: string; group?: SessionStatusGroup }[] = [
  { id: "live",    label: "Live",      group: "live" },
  { id: "success", label: "Completed", group: "success" },
  { id: "closed",  label: "Expired",   group: "closed" },
  { id: "problem", label: "Failed",    group: "problem" },
  { id: "all",     label: "All" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function countdown(isoString: string | null): string {
  if (!isoString) return "—";
  const diffMs = new Date(isoString).getTime() - Date.now();
  if (diffMs <= 0) return "expired";
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

function productName(selectedProduct: unknown): string {
  if (
    selectedProduct !== null &&
    typeof selectedProduct === "object" &&
    "name" in (selectedProduct as object) &&
    typeof (selectedProduct as Record<string, unknown>).name === "string"
  ) {
    return (selectedProduct as Record<string, string>).name;
  }
  return "—";
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  created:            "bg-gray-800 text-gray-400",
  waiting_for_mobile: "bg-gray-800 text-gray-300",
  mobile_connected:   "bg-blue-950 text-blue-300",
  room_selected:      "bg-indigo-950 text-indigo-300",
  product_selected:   "bg-violet-950 text-violet-300",
  ready_to_render:    "bg-yellow-950 text-yellow-300",
  rendering:          "bg-amber-950 text-amber-300 animate-pulse",
  result_ready:       "bg-green-950 text-green-300",
  completed:          "bg-teal-950 text-teal-300",
  failed:             "bg-red-950 text-red-300",
  expired:            "bg-gray-900 text-gray-600",
};

function StatusBadge({ status, effectivelyExpired }: { status: string; effectivelyExpired: boolean }) {
  const cls = STATUS_STYLES[status] ?? "bg-gray-800 text-gray-400";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
        {status.replace(/_/g, " ")}
      </span>
      {effectivelyExpired && status !== "expired" && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-orange-950 text-orange-400">
          overdue
        </span>
      )}
    </span>
  );
}

// ─── Row actions ──────────────────────────────────────────────────────────────

function SessionActions({ session }: { session: DashboardSession }) {
  if (session.status === "expired" || session.status === "completed") return null;

  return (
    <div className="flex items-center gap-1.5">
      {session.group !== "closed" && (
        <form action={forceExpireSession.bind(null, session.id)}>
          <button
            type="submit"
            className="px-2 py-1 rounded text-xs font-medium bg-gray-800 text-gray-400 hover:bg-red-950 hover:text-red-300 transition-colors"
          >
            Expire
          </button>
        </form>
      )}
      <form action={forceResetSession.bind(null, session.id)}>
        <button
          type="submit"
          className="px-2 py-1 rounded text-xs font-medium bg-gray-800 text-gray-400 hover:bg-indigo-950 hover:text-indigo-300 transition-colors"
        >
          Reset
        </button>
      </form>
    </div>
  );
}

// ─── Table ────────────────────────────────────────────────────────────────────

function SessionRow({ session, now }: { session: DashboardSession; now: number }) {
  return (
    <tr
      className={`hover:bg-gray-900/60 transition-colors ${
        session.status === "rendering" ? "bg-amber-950/10" :
        session.effectivelyExpired && session.group === "live" ? "bg-orange-950/5" : ""
      }`}
    >
      <td className="px-4 py-3">
        <span className="font-mono text-xs text-gray-400">
          {session.id.slice(0, 8)}…
        </span>
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={session.status} effectivelyExpired={session.effectivelyExpired} />
      </td>
      <td className="px-4 py-3 text-center">
        {session.mobileConnected ? (
          <span className="text-green-400 text-base" title="Connected">✓</span>
        ) : (
          <span className="text-gray-700 text-base" title="Not connected">—</span>
        )}
      </td>
      <td className="px-4 py-3 max-w-[140px]">
        <span className="text-gray-300 truncate block text-xs">
          {productName(session.selectedProduct)}
        </span>
      </td>
      <td className="px-4 py-3 text-center">
        <span className="tabular-nums text-gray-400 text-xs">{session.renderCount}</span>
      </td>
      <td className="px-4 py-3">
        <span className="text-gray-500 text-xs whitespace-nowrap">
          {relativeTime(session.createdAt)}
        </span>
      </td>
      <td className="px-4 py-3">
        <span
          className={`text-xs whitespace-nowrap ${
            session.expiresAt &&
            new Date(session.expiresAt).getTime() - now < 5 * 60 * 1000 &&
            session.group === "live"
              ? "text-red-400"
              : "text-gray-500"
          }`}
        >
          {session.group === "live" ? countdown(session.expiresAt) : "—"}
        </span>
      </td>
      <td className="px-4 py-3">
        <SessionActions session={session} />
      </td>
    </tr>
  );
}

function SessionTable({ sessions }: { sessions: DashboardSession[] }) {
  const now = Date.now();

  if (sessions.length === 0) {
    return (
      <div className="px-6 py-10 text-center">
        <p className="text-sm text-gray-600">No sessions in this category.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 bg-gray-900/60">
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Session</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Mobile</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Product</th>
            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Renders</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Expires</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800/60 bg-gray-950">
          {sessions.map((s) => (
            <SessionRow key={s.id} session={s} now={now} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Tabbed view ──────────────────────────────────────────────────────────────

export function SessionTabView({ sessions }: { sessions: DashboardSession[] }) {
  const [activeTab, setActiveTab] = useState<Tab>("live");

  const counts: Record<Tab, number> = {
    live:    sessions.filter((s) => s.group === "live").length,
    success: sessions.filter((s) => s.group === "success").length,
    closed:  sessions.filter((s) => s.group === "closed").length,
    problem: sessions.filter((s) => s.group === "problem").length,
    all:     sessions.length,
  };

  const visible =
    activeTab === "all"
      ? sessions
      : sessions.filter((s) => s.group === TABS.find((t) => t.id === activeTab)?.group);

  return (
    <div className="rounded-xl border border-gray-800 overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-gray-800 bg-gray-900">
        {TABS.map((tab) => {
          const count = counts[tab.id];
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-xs font-medium transition-colors border-b-2 -mb-px ${
                isActive
                  ? "border-indigo-500 text-white"
                  : "border-transparent text-gray-500 hover:text-gray-300"
              }`}
            >
              {tab.label}
              {count > 0 && (
                <span
                  className={`inline-flex items-center justify-center min-w-[18px] px-1 py-0.5 rounded-full text-xs ${
                    isActive
                      ? tab.id === "live"    ? "bg-blue-500/20 text-blue-300"
                      : tab.id === "success" ? "bg-green-500/20 text-green-300"
                      : tab.id === "closed"  ? "bg-gray-700 text-gray-400"
                      : tab.id === "problem" ? "bg-red-500/20 text-red-300"
                      : "bg-gray-700 text-gray-300"
                      : "bg-gray-800 text-gray-500"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Table */}
      <SessionTable sessions={visible} />

      {/* Footer */}
      <div className="px-4 py-2.5 border-t border-gray-800 bg-gray-900/60">
        <span className="text-xs text-gray-600">
          {visible.length} session{visible.length !== 1 ? "s" : ""}{" "}
          {activeTab === "all" ? "— last 4 hours" : `— ${TABS.find((t) => t.id === activeTab)?.label.toLowerCase()}`}
        </span>
      </div>
    </div>
  );
}
