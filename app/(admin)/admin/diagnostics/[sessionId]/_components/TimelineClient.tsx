"use client";

import { useState, useMemo } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TimelineEvent = {
  id: string;
  timestamp: string;
  source: string;
  eventType: string;
  level: string;
  statusBefore: string | null;
  statusAfter: string | null;
  code: string | null;
  message: string | null;
  metadata: unknown;
};

type FilterKey = "all" | "journey" | "server" | "screen" | "mobile" | "renderer" | "errors" | "render";

// ─── Constants ────────────────────────────────────────────────────────────────

const JOURNEY_EVENT_TYPES = new Set([
  "session_created", "qr_displayed", "qr_opened",
  "session_status_changed", "session_completed", "session_expired",
  "mobile_page_mounted", "mobile_page_unmounted",
  "mobile_js_error", "mobile_unhandled_rejection",
  "mobile_rapid_reload_detected", "mobile_excessive_polling_detected",
  "mobile_auto_connect_failed", "mobile_fetch_failed", "mobile_connected",
  "room_upload_started", "room_upload_completed", "room_upload_failed",
  "room_direct_upload_started", "room_direct_upload_confirmed", "room_direct_upload_failed",
  "product_selected", "product_changed",
  "render_start_clicked", "render_request_started", "render_request_accepted", "render_request_success", "render_request_failed",
  "render_started", "render_completed", "render_failed", "render_timeout",
  "render_timing_summary", "render_branch_resolved",
  "result_displayed_screen", "result_seen_mobile",
  "screen_completion_message_displayed", "screen_completed_redirect_to_home",
  "back_pressed", "mobile_tap_detected",
]);

const NOISY_EVENT_TYPES = new Set([
  "mobile_visibility_changed",
  "mobile_fetch_started",
  "screen_received_session_update",
  "render_diagnostics_snapshot",
  "mobile_visible_step_rendered",
]);

const EVENT_LABELS: Record<string, string> = {
  mobile_page_mounted:                    "Page Mounted",
  mobile_page_unmounted:                  "Page Unmounted",
  mobile_router_navigate:                 "Router Navigate",
  mobile_visibility_changed:              "Visibility Changed",
  mobile_page_hide:                       "Page Hide",
  mobile_page_show:                       "Page Show",
  mobile_rapid_reload_detected:           "Rapid Reload",
  mobile_excessive_polling_detected:      "Excessive Polling",
  mobile_js_error:                        "JS Error",
  mobile_unhandled_rejection:             "Unhandled Rejection",
  mobile_component_mounted:              "Component Mounted",
  mobile_hydration_complete:              "Hydration Complete",
  mobile_fetch_started:                   "Fetch Started",
  mobile_fetch_failed:                    "Fetch Failed",
  mobile_visible_step_rendered:           "Step Rendered",
  mobile_overlay_visible:                 "Overlay Visible",
  mobile_tap_detected:                    "Tap Detected",
  mobile_auto_connect_failed:             "Auto-Connect Failed",
  mobile_connected:                       "Mobile Connected",
  back_pressed:                           "Back Pressed",
  room_upload_started:                    "Room Upload Started",
  room_upload_completed:                  "Room Upload Completed",
  room_upload_failed:                     "Room Upload Failed",
  room_direct_upload_started:             "Direct Upload Started",
  room_direct_upload_confirmed:           "Direct Upload Confirmed",
  room_direct_upload_failed:              "Direct Upload Failed",
  product_selected:                       "Product Selected",
  product_changed:                        "Product Changed",
  mobile_page_loaded:                     "Mobile Page Loaded",
  screen_loaded:                          "Screen Loaded",
  screen_render_branch_changed:           "Render Branch Changed",
  screen_received_session_update:         "Session Update Received",
  screen_stale_detected:                  "Screen Stale",
  screen_polling_started:                 "Polling Started",
  sse_connected:                          "SSE Connected",
  sse_disconnected:                       "SSE Disconnected",
  sse_reconnected:                        "SSE Reconnected",
  fallback_polling_started:               "Fallback Polling Started",
  fallback_polling_stopped:               "Fallback Polling Stopped",
  session_created:                        "Session Created",
  session_status_changed:                 "Status Changed",
  session_issue_opened:                   "Issue Opened",
  session_issue_resolved:                 "Issue Resolved",
  session_completed:                      "Session Completed",
  session_expired:                        "Session Expired",
  qr_displayed:                           "QR Displayed",
  qr_opened:                              "QR Scanned",
  render_start_clicked:                   "Render Tapped",
  render_request_started:                 "Render Requested",
  render_request_accepted:                "Render Request Accepted",
  render_request_success:                 "Render Request Accepted",
  render_request_failed:                  "Render Failed",
  render_started:                         "Render Started",
  render_completed:                       "Render Completed",
  render_failed:                          "Render Failed",
  render_timeout:                         "Render Timeout",
  render_timing_summary:                  "Render Timing Summary",
  render_branch_resolved:                 "Render Branch Resolved",
  render_diagnostics_snapshot:            "Render Snapshot",
  result_displayed_screen:                "Result on Screen",
  result_seen_mobile:                     "Result on Mobile",
  screen_completion_message_displayed:    "Completion Message",
  screen_completed_redirect_to_home:      "Redirected Home",
  floor_polygon_missing_prompt_only_mode: "Floor Polygon Missing",
  gemini_retry_succeeded:                 "Gemini Retry Succeeded",
};

function eventLabel(type: string) {
  return EVENT_LABELS[type] ?? type;
}

function srcBadge(source: string) {
  const map: Record<string, string> = {
    mobile:   "bg-blue-50 text-blue-700 border border-blue-100",
    screen:   "bg-purple-50 text-purple-700 border border-purple-100",
    server:   "bg-slate-100 text-slate-700",
    renderer: "bg-emerald-50 text-emerald-700 border border-emerald-100",
  };
  return map[source] ?? "bg-slate-50 text-slate-600";
}

function levelBg(level: string) {
  if (level === "fatal") return "bg-red-100";
  if (level === "error") return "bg-red-50";
  if (level === "warning") return "bg-amber-50";
  return "";
}

function relMs(base: string, event: string) {
  const diff = new Date(event).getTime() - new Date(base).getTime();
  if (diff < 0) return "—";
  if (diff < 1000) return `+${diff}ms`;
  if (diff < 60_000) return `+${(diff / 1000).toFixed(1)}s`;
  return `+${Math.floor(diff / 60_000)}m${Math.round((diff % 60_000) / 1000)}s`;
}

function hms(iso: string) {
  return new Intl.DateTimeFormat("en", { timeStyle: "medium", hour12: false }).format(new Date(iso));
}

const FILTER_TABS: { key: FilterKey; label: string }[] = [
  { key: "all",      label: "All" },
  { key: "journey",  label: "Journey" },
  { key: "server",   label: "Server" },
  { key: "screen",   label: "Screen" },
  { key: "mobile",   label: "Mobile" },
  { key: "renderer", label: "Renderer" },
  { key: "errors",   label: "Errors" },
  { key: "render",   label: "Render" },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function TimelineClient({
  timeline,
  sessionStart,
}: {
  timeline: TimelineEvent[];
  sessionStart: string;
}) {
  const [filter, setFilter] = useState<FilterKey>("journey");
  const [hideNoise, setHideNoise] = useState(true);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const base = useMemo(
    () => (hideNoise ? timeline.filter((e) => !NOISY_EVENT_TYPES.has(e.eventType)) : timeline),
    [timeline, hideNoise],
  );

  const filtered = useMemo(() => {
    switch (filter) {
      case "journey":  return base.filter((e) => JOURNEY_EVENT_TYPES.has(e.eventType));
      case "server":   return base.filter((e) => e.source === "server");
      case "screen":   return base.filter((e) => e.source === "screen");
      case "mobile":   return base.filter((e) => e.source === "mobile");
      case "renderer": return base.filter((e) => e.source === "renderer");
      case "errors":   return base.filter((e) => e.level === "error" || e.level === "fatal" || e.level === "warning");
      case "render":   return base.filter((e) => e.eventType.includes("render"));
      default:         return base;
    }
  }, [base, filter]);

  const counts = useMemo(() => ({
    all:      base.length,
    journey:  base.filter((e) => JOURNEY_EVENT_TYPES.has(e.eventType)).length,
    server:   base.filter((e) => e.source === "server").length,
    screen:   base.filter((e) => e.source === "screen").length,
    mobile:   base.filter((e) => e.source === "mobile").length,
    renderer: base.filter((e) => e.source === "renderer").length,
    errors:   base.filter((e) => e.level === "error" || e.level === "fatal" || e.level === "warning").length,
    render:   base.filter((e) => e.eventType.includes("render")).length,
  }), [base]);

  return (
    <div>
      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTER_TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filter === key
                  ? "bg-slate-800 text-white"
                  : counts[key] > 0
                  ? "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  : "bg-slate-50 text-slate-400 cursor-default"
              }`}
            >
              {label}
              {counts[key] > 0 && (
                <span className="ml-1.5 opacity-60 tabular-nums">{counts[key]}</span>
              )}
            </button>
          ))}
        </div>
        <button
          onClick={() => setHideNoise((v) => !v)}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            hideNoise
              ? "bg-amber-50 text-amber-700 border border-amber-200"
              : "bg-slate-100 text-slate-500 hover:bg-slate-200"
          }`}
        >
          {hideNoise ? "Noise hidden" : "Show all"}
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[700px] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide text-slate-500 w-20">Time</th>
              <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide text-slate-500 w-16">+Δ</th>
              <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide text-slate-500 w-20">Source</th>
              <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide text-slate-500">Event</th>
              <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide text-slate-500 w-36">Status</th>
              <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide text-slate-500 w-48">Message</th>
              <th className="px-3 py-2 text-center text-[10px] uppercase tracking-wide text-slate-500 w-12">▶</th>
            </tr>
          </thead>
          {filtered.length === 0 ? (
            <tbody>
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-400">
                  No events match this filter.
                </td>
              </tr>
            </tbody>
          ) : (
            filtered.map((event) => (
              <tbody key={event.id}>
                <tr className={`border-t border-slate-100 ${levelBg(event.level)}`}>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-slate-400">
                    {hms(event.timestamp)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-slate-400">
                    {relMs(sessionStart, event.timestamp)}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${srcBadge(event.source)}`}>
                      {event.source}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={
                      event.level === "error" || event.level === "fatal"
                        ? "text-xs font-medium text-red-700"
                        : event.level === "warning"
                        ? "text-xs font-medium text-amber-700"
                        : "text-xs text-slate-800"
                    }>
                      {eventLabel(event.eventType)}
                    </span>
                    {event.code && (
                      <span className="ml-1.5 font-mono text-[10px] text-slate-400">{event.code}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-500">
                    {event.statusAfter ? (
                      <span>
                        {event.statusBefore && (
                          <span className="text-slate-400">{event.statusBefore} → </span>
                        )}
                        <span className="text-slate-700">{event.statusAfter}</span>
                      </span>
                    ) : event.statusBefore ? (
                      <span className="text-slate-400">{event.statusBefore}</span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="max-w-[12rem] truncate px-3 py-2 text-[11px] text-slate-500">
                    {event.message ?? ""}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {event.metadata != null && (
                      <button
                        onClick={() => toggleRow(event.id)}
                        aria-label={expandedRows.has(event.id) ? "Collapse" : "Expand"}
                        className="rounded px-1.5 py-0.5 font-mono text-[11px] text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                      >
                        {expandedRows.has(event.id) ? "▼" : "▶"}
                      </button>
                    )}
                  </td>
                </tr>
                {expandedRows.has(event.id) && (
                  <tr className="border-t border-slate-100 bg-slate-50">
                    <td colSpan={7} className="px-4 py-3">
                      <pre className="max-h-72 overflow-auto rounded-md border border-slate-200 bg-slate-950 p-3 text-[10px] leading-5 text-emerald-300 whitespace-pre-wrap">
                        {JSON.stringify(event.metadata, null, 2)}
                      </pre>
                    </td>
                  </tr>
                )}
              </tbody>
            ))
          )}
        </table>
      </div>
      <p className="mt-2 text-right font-mono text-[10px] text-slate-400">
        {filtered.length} / {timeline.length} events
      </p>
    </div>
  );
}
