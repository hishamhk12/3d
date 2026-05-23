import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminHeader } from "../../_components/admin-header";
import { getSessionDiagnostics } from "@/lib/admin/session-diagnostics";

type SessionDiagnosticsPageProps = {
  params: Promise<{ sessionId: string }>;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function boolLabel(value: boolean) {
  return value ? "yes" : "no";
}

function dateTime(iso: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(iso));
}

function relativeMs(base: string, event: string) {
  const diff = new Date(event).getTime() - new Date(base).getTime();
  if (diff < 1000) return `+${diff}ms`;
  if (diff < 60_000) return `+${(diff / 1000).toFixed(1)}s`;
  return `+${Math.floor(diff / 60_000)}m${Math.round((diff % 60_000) / 1000)}s`;
}

function MetadataBlock({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-slate-400">-</span>;
  return (
    <pre className="max-h-40 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-2 text-[11px] leading-5 text-slate-600">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function countEvents(
  timeline: { eventType: string }[],
  eventType: string,
) {
  return timeline.filter((e) => e.eventType === eventType).length;
}

// ─── Event label + color mappings ────────────────────────────────────────────

const EVENT_LABELS: Record<string, string> = {
  // Mobile lifecycle (new)
  mobile_page_mounted:               "Page Mounted",
  mobile_page_unmounted:             "Page Unmounted",
  mobile_router_navigate:            "Router Navigate",
  mobile_visibility_changed:         "Visibility Changed",
  mobile_page_hide:                  "Page Hide (background)",
  mobile_page_show:                  "Page Show (foreground)",
  mobile_rapid_reload_detected:      "⚠ Rapid Reload",
  mobile_excessive_polling_detected: "⚠ Excessive Polling",
  mobile_js_error:                   "JS Error",
  mobile_unhandled_rejection:        "Unhandled Rejection",
  // Mobile — existing
  mobile_component_mounted:          "Component Mounted",
  mobile_hydration_complete:         "Hydration Complete",
  mobile_fetch_started:              "Fetch Started",
  mobile_fetch_failed:               "Fetch Failed",
  mobile_visible_step_rendered:      "Step Rendered",
  mobile_overlay_visible:            "Overlay Visible",
  mobile_tap_detected:               "Tap Detected",
  room_upload_started:               "Room Upload Started",
  room_upload_completed:             "Room Upload Completed",
  room_upload_failed:                "Room Upload Failed",
  product_selected:                  "Product Selected",
  mobile_page_loaded:                "Mobile Page Loaded",
  // Screen
  screen_loaded:                     "Screen Loaded",
  screen_render_branch_changed:      "Render Branch Changed",
  screen_received_session_update:    "Session Update Received",
  screen_stale_detected:             "Screen Stale",
  screen_polling_started:            "Polling Started",
  sse_connected:                     "SSE Connected",
  sse_disconnected:                  "SSE Disconnected",
  sse_reconnected:                   "SSE Reconnected",
  fallback_polling_started:          "Fallback Polling Started",
  fallback_polling_stopped:          "Fallback Polling Stopped",
  // Server
  session_created:                   "Session Created",
  session_status_changed:            "Status Changed",
  session_issue_opened:              "Issue Opened",
  session_issue_resolved:            "Issue Resolved",
  qr_displayed:                      "QR Displayed",
  qr_opened:                         "QR Scanned",
  render_started:                    "Render Started",
  render_completed:                  "Render Completed",
  render_failed:                     "Render Failed",
};

function eventLabel(type: string) {
  return EVENT_LABELS[type] ?? type;
}

// Row background per level
function rowBg(level: string) {
  if (level === "error" || level === "fatal") return "bg-red-50";
  if (level === "warning") return "bg-amber-50";
  return "";
}

// ─── Visual timeline strip ────────────────────────────────────────────────────

// Events that get a milestone dot in the visual strip
const MILESTONE_EVENT_TYPES = new Set([
  "session_created",
  "qr_displayed",
  "qr_opened",
  "mobile_page_mounted",
  "mobile_component_mounted",
  "mobile_hydration_complete",
  "mobile_page_hide",
  "mobile_page_show",
  "mobile_visibility_changed",
  "mobile_rapid_reload_detected",
  "mobile_excessive_polling_detected",
  "mobile_js_error",
  "mobile_unhandled_rejection",
  "mobile_page_unmounted",
  "mobile_router_navigate",
  "session_status_changed",
  "room_upload_started",
  "room_upload_completed",
  "product_selected",
  "render_started",
  "render_completed",
  "render_failed",
  "mobile_page_loaded",
]);

function milestoneDotColor(eventType: string, level: string) {
  if (level === "error" || level === "fatal") return "bg-red-500";
  if (level === "warning") return "bg-yellow-500";
  if (eventType.includes("mounted") || eventType.includes("completed") || eventType.includes("connected")) return "bg-emerald-500";
  if (eventType.includes("hide") || eventType.includes("unmount")) return "bg-orange-400";
  if (eventType.includes("status_changed")) return "bg-purple-400";
  if (eventType.includes("upload") || eventType.includes("render")) return "bg-blue-400";
  return "bg-gray-500";
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function SessionDiagnosticsPage({ params }: SessionDiagnosticsPageProps) {
  const { sessionId } = await params;
  const diagnostics = await getSessionDiagnostics(sessionId);

  if (!diagnostics) notFound();

  const { clientDiagnostics, issues, summary, timeline } = diagnostics;
  const openIssues     = issues.filter((issue) => issue.status === "open");
  const resolvedIssues = issues.filter((issue) => issue.status !== "open");

  // Mobile lifecycle summary counts
  const lc = {
    mounts:             countEvents(timeline, "mobile_page_mounted") + countEvents(timeline, "mobile_component_mounted"),
    unmounts:           countEvents(timeline, "mobile_page_unmounted"),
    pageHides:          countEvents(timeline, "mobile_page_hide"),
    pageBfcacheShows:   timeline.filter((e) => e.eventType === "mobile_page_show" && (e.metadata as Record<string,unknown> | null)?.persisted === true).length,
    rapidReloads:       countEvents(timeline, "mobile_rapid_reload_detected"),
    excessivePolling:   countEvents(timeline, "mobile_excessive_polling_detected"),
    jsErrors:           countEvents(timeline, "mobile_js_error"),
    unhandledRejections:countEvents(timeline, "mobile_unhandled_rejection"),
    routerNavigations:  countEvents(timeline, "mobile_router_navigate"),
    fetchStarts:        countEvents(timeline, "mobile_fetch_started"),
    fetchFails:         countEvents(timeline, "mobile_fetch_failed"),
    visibilityChanges:  countEvents(timeline, "mobile_visibility_changed"),
  };

  const milestones = timeline.filter((e) => MILESTONE_EVENT_TYPES.has(e.eventType));
  const sessionStart = timeline[0]?.timestamp ?? summary.id;

  return (
    <div className="min-h-screen bg-[#f6f8fb]">
      <AdminHeader />
      <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <Link href="/admin/diagnostics" className="text-sm text-slate-500 hover:text-slate-800">
              Diagnostics
            </Link>
            <h1 className="mt-2 font-mono text-lg font-semibold text-slate-950">{summary.id}</h1>
          </div>
          <span className="rounded-md bg-white px-3 py-1.5 text-sm text-slate-700 ring-1 ring-slate-200">{summary.status}</span>
        </div>

        {/* Summary */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-950">Summary</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["current status",  summary.status],
              ["current step",    summary.currentStep],
              ["product selected",boolLabel(summary.productSelected)],
              ["room uploaded",   boolLabel(summary.roomUploaded)],
              ["render started",  boolLabel(summary.renderStarted)],
              ["render completed",boolLabel(summary.renderCompleted)],
              ["screen connected",boolLabel(summary.screenConnected)],
              ["mobile connected",boolLabel(summary.mobileConnected)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
                <p className="mt-1 text-sm text-slate-800">{value}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Mobile lifecycle summary */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-950">Mobile Lifecycle Diagnostics</h2>
          <p className="mt-1 text-xs text-slate-500">
            Client-side signals captured by useMobileDiagnostics — zero = not yet observed or session predates this feature.
          </p>
          <div className="mt-4 grid gap-2 grid-cols-3 sm:grid-cols-4 lg:grid-cols-6">
            {[
              { label: "Mounts",           value: lc.mounts,              alert: lc.mounts > 2 },
              { label: "Unmounts",         value: lc.unmounts,            alert: lc.unmounts > 0 },
              { label: "Page Hides",       value: lc.pageHides,           alert: lc.pageHides > 0 },
              { label: "BFCache Restores", value: lc.pageBfcacheShows,    alert: lc.pageBfcacheShows > 0 },
              { label: "Rapid Reloads",    value: lc.rapidReloads,        alert: lc.rapidReloads > 0 },
              { label: "Excess Polling",   value: lc.excessivePolling,    alert: lc.excessivePolling > 0 },
              { label: "JS Errors",        value: lc.jsErrors,            alert: lc.jsErrors > 0 },
              { label: "Unhandled Rej.",   value: lc.unhandledRejections, alert: lc.unhandledRejections > 0 },
              { label: "Router Navs",      value: lc.routerNavigations,   alert: lc.routerNavigations > 0 },
              { label: "Fetch Starts",     value: lc.fetchStarts,         alert: false },
              { label: "Fetch Fails",      value: lc.fetchFails,          alert: lc.fetchFails > 1 },
              { label: "Visibility Chg.",  value: lc.visibilityChanges,   alert: false },
            ].map(({ label, value, alert }) => (
              <div
                key={label}
                className={`rounded-lg border px-3 py-2 ${
                  alert && value > 0
                    ? "border-amber-200 bg-amber-50"
                    : "border-slate-200 bg-slate-50"
                }`}
              >
                <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
                <p className={`mt-1 text-lg font-bold tabular-nums ${alert && value > 0 ? "text-amber-700" : "text-slate-700"}`}>
                  {value}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Issues */}
        <section className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
            <h2 className="text-sm font-semibold text-slate-950">Issues</h2>
            <div className="mt-4 space-y-5">
              <div>
                <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">Open</h3>
                <div className="mt-2 overflow-hidden rounded-lg border border-slate-200">
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {openIssues.map((issue) => (
                        <tr key={issue.id}>
                          <td className="px-3 py-3 text-xs text-slate-800">{issue.issueType}</td>
                          <td className="px-3 py-3 text-xs text-slate-600">{issue.severity}</td>
                          <td className="px-3 py-3 text-xs text-slate-500">{dateTime(issue.firstSeenAt)}</td>
                          <td className="px-3 py-3 text-xs text-slate-500">{dateTime(issue.lastSeenAt)}</td>
                          <td className="px-3 py-3 text-center text-xs text-slate-700">{issue.count}</td>
                          <td className="px-3 py-3 text-xs text-slate-600">{issue.recommendedAction ?? "-"}</td>
                        </tr>
                      ))}
                      {openIssues.length === 0 ? (
                        <tr>
                          <td className="px-3 py-6 text-center text-sm text-slate-500">No open issues.</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Resolved / Ignored
                </h3>
                <div className="mt-2 space-y-2">
                  {resolvedIssues.map((issue) => (
                    <div
                      key={issue.id}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600"
                    >
                      <span className="text-slate-800">{issue.issueType}</span>
                      <span className="ml-2 text-slate-500">{issue.status}</span>
                      <span className="ml-2">count {issue.count}</span>
                    </div>
                  ))}
                  {resolvedIssues.length === 0 ? (
                    <p className="text-sm text-slate-500">No resolved issues.</p>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          {/* Client diagnostics */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-950">Client Diagnostics</h2>
            <div className="mt-4 space-y-3 text-sm">
              {[
                ["last mobile event",  clientDiagnostics.lastMobileEvent?.eventType  ?? "-"],
                ["last screen event",  clientDiagnostics.lastScreenEvent?.eventType  ?? "-"],
                ["last render event",  clientDiagnostics.lastRenderEvent?.eventType  ?? "-"],
                ["last known problem", clientDiagnostics.lastKnownProblem            ?? "-"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
                  <p className="mt-1 break-words text-slate-800">{value}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Timeline */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-4 mb-4">
            <h2 className="text-sm font-semibold text-slate-950">Timeline</h2>
            <span className="text-xs text-slate-500">{timeline.length} events</span>
          </div>

          {/* Visual milestone strip */}
          {milestones.length > 0 && (
            <div className="mb-5 overflow-x-auto pb-1">
              <div className="flex items-start gap-0 min-w-max">
                {milestones.map((event, idx) => (
                  <div key={event.id} className="flex items-start">
                    <div className="flex flex-col items-center gap-1 px-2">
                      <div
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white ${milestoneDotColor(event.eventType, event.level)}`}
                        title={eventLabel(event.eventType)}
                      />
                      <p className="max-w-[72px] whitespace-nowrap text-center text-[9px] leading-tight text-slate-500">
                        {eventLabel(event.eventType)}
                      </p>
                      <p className="whitespace-nowrap text-[8px] text-slate-400">
                        {relativeMs(sessionStart, event.timestamp)}
                      </p>
                    </div>
                    {idx < milestones.length - 1 && (
                      <div className="mt-[5px] h-px w-6 shrink-0 bg-slate-200" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Legend */}
          <div className="mb-4 flex flex-wrap gap-3 text-[10px] text-slate-500">
            {[
              { color: "bg-emerald-500", label: "mounted / completed" },
              { color: "bg-blue-400",    label: "upload / render" },
              { color: "bg-purple-400",  label: "status changed" },
              { color: "bg-orange-400",  label: "page hide / unmount" },
              { color: "bg-yellow-500",  label: "warning" },
              { color: "bg-red-500",     label: "error / rapid reload" },
            ].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-1.5">
                <div className={`h-2 w-2 rounded-full ${color}`} />
                {label}
              </div>
            ))}
          </div>

          {/* Full event table */}
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs uppercase tracking-wide text-slate-500">Time</th>
                  <th className="px-3 py-2 text-left text-xs uppercase tracking-wide text-slate-500">+Δ</th>
                  <th className="px-3 py-2 text-left text-xs uppercase tracking-wide text-slate-500">Src</th>
                  <th className="px-3 py-2 text-left text-xs uppercase tracking-wide text-slate-500">Event</th>
                  <th className="px-3 py-2 text-left text-xs uppercase tracking-wide text-slate-500">Code</th>
                  <th className="px-3 py-2 text-left text-xs uppercase tracking-wide text-slate-500">Message</th>
                  <th className="px-3 py-2 text-left text-xs uppercase tracking-wide text-slate-500">Metadata</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {timeline.map((event) => (
                  <tr key={event.id} className={rowBg(event.level)}>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">
                      {dateTime(event.timestamp)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-400">
                      {relativeMs(sessionStart, event.timestamp)}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">{event.source}</td>
                    <td className="px-3 py-2 text-xs">
                      <span className={
                        event.level === "error" || event.level === "fatal"
                          ? "text-red-700"
                          : event.level === "warning"
                            ? "text-amber-700"
                            : "text-slate-800"
                      }>
                        {eventLabel(event.eventType)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">{event.code ?? "-"}</td>
                    <td className="max-w-xs px-3 py-2 text-xs text-slate-600">{event.message ?? "-"}</td>
                    <td className="px-3 py-2">
                      <MetadataBlock value={event.metadata} />
                    </td>
                  </tr>
                ))}
                {timeline.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-500">
                      No events recorded.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

      </main>
    </div>
  );
}
