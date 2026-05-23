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

  const { clientDiagnostics, issues, summary, timeline, renderJobs } = diagnostics;
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

        {/* ── Render Diagnostics ──────────────────────────────────────────── */}
        <RenderDiagnosticsSection renderJobs={renderJobs} timeline={timeline} sessionId={sessionId} />

      </main>
    </div>
  );
}

// ─── Render Diagnostics helpers ───────────────────────────────────────────────

type RenderJobRaw = { id: string; status: string; input: unknown; result: unknown; createdAt: string; updatedAt: string };
type DiagSnapshotMeta = {
  renderJobId?: string;
  originalDimensions?:    { width: number; height: number } | null;
  geminiInputDimensions?: { width: number; height: number } | null;
  rawOutputDimensions?:   { width: number; height: number } | null;
  finalOutputDimensions?: { width: number; height: number } | null;
  resizedApplied?:             boolean;
  cropApplied?:                boolean;
  paddingApplied?:             boolean;
  normalizedApplied?:          boolean;
  fillApplied?:                boolean;
  containApplied?:             boolean;
  coverApplied?:               boolean;
  exifOrientationApplied?:     boolean;
  savedRaw?:                   boolean;
  promptVersion?:              string | null;
  modelName?:                  string | null;
  productName?:                string | null;
  floorPolygon?:               unknown;
  promptText?:                 string | null;
  outputImageUrl?:             string | null;
  artifactUrls?:               Record<string, string>;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function extractInput(job: RenderJobRaw) {
  if (!isRecord(job.input)) return null;
  const room    = isRecord(job.input["room"])    ? job.input["room"]    : null;
  const product = isRecord(job.input["product"]) ? job.input["product"] : null;
  return {
    roomImageUrl:    (room    && typeof room["imageUrl"]    === "string") ? room["imageUrl"]    : null,
    floorPolygon:    (room    && room["floorQuad"]          != null)      ? room["floorQuad"]    : null,
    productName:     (product && typeof product["name"]     === "string") ? product["name"]     : null,
    productImageUrl: (product && typeof product["imageUrl"] === "string") ? product["imageUrl"] : null,
  };
}

function extractResult(job: RenderJobRaw) {
  if (!isRecord(job.result)) return null;
  return {
    imageUrl:    typeof job.result["imageUrl"]    === "string" ? job.result["imageUrl"]    : null,
    modelName:   typeof job.result["modelName"]   === "string" ? job.result["modelName"]   : null,
    generatedAt: typeof job.result["generatedAt"] === "string" ? job.result["generatedAt"] : null,
  };
}

function extractSnapshot(
  timeline: { eventType: string; metadata: unknown }[],
  renderJobId: string,
): DiagSnapshotMeta | null {
  const events = timeline.filter(
    (e) => e.eventType === "render_diagnostics_snapshot" && isRecord(e.metadata),
  );
  // Match by renderJobId first; fall back to the latest snapshot
  const match =
    events.find((e) => isRecord(e.metadata) && (e.metadata as Record<string,unknown>)["renderJobId"] === renderJobId) ??
    events[events.length - 1];
  return match ? (match.metadata as DiagSnapshotMeta) : null;
}

function aspectRatio(w: number, h: number) {
  return h === 0 ? "—" : (w / h).toFixed(3);
}

function DimBadge({ drift }: { drift: number }) {
  if (drift === 0) return null;
  const pct = (drift * 100).toFixed(1);
  return (
    <span className="ml-1 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
      ⚠ {pct}% اختلاف أبعاد
    </span>
  );
}

function WarnBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
      ⚠ {label}
    </span>
  );
}

function FlagRow({ label, value }: { label: string; value: boolean | undefined }) {
  const v = value ?? false;
  return (
    <div className={`flex items-center justify-between rounded-lg border px-3 py-1.5 ${v ? "border-amber-200 bg-amber-50" : "border-slate-100 bg-white"}`}>
      <span className="text-xs text-slate-600 font-mono">{label}</span>
      <span className={`text-xs font-bold ${v ? "text-amber-700" : "text-slate-400"}`}>{v ? "yes" : "no"}</span>
    </div>
  );
}

// ─── Render Diagnostics Section ───────────────────────────────────────────────

function RenderDiagnosticsSection({
  renderJobs,
  timeline,
  sessionId,
}: {
  renderJobs: RenderJobRaw[];
  timeline: { eventType: string; metadata: unknown; timestamp: string }[];
  sessionId: string;
}) {
  const latestJob = renderJobs[0] ?? null;

  return (
    <section className="rounded-xl border border-blue-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-950">Render Diagnostics</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Image pipeline stages, dimension mismatches, and debug artifacts for this session&apos;s render jobs.
          </p>
        </div>
        {renderJobs.length > 1 && (
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
            {renderJobs.length} jobs
          </span>
        )}
      </div>

      {!latestJob ? (
        <p className="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          لا توجد بيانات تشخيص للرندر بعد. شغّل رندر جديد مع تفعيل التشخيص.
        </p>
      ) : (
        <RenderJobDiag job={latestJob} timeline={timeline} sessionId={sessionId} />
      )}

      {renderJobs.length > 1 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-800">
            Show {renderJobs.length - 1} earlier job(s)
          </summary>
          <div className="mt-3 space-y-6">
            {renderJobs.slice(1).map((job) => (
              <RenderJobDiag key={job.id} job={job} timeline={timeline} sessionId={sessionId} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function RenderJobDiag({
  job,
  timeline,
  sessionId,
}: {
  job: RenderJobRaw;
  timeline: { eventType: string; metadata: unknown; timestamp: string }[];
  sessionId: string;
}) {
  const input    = extractInput(job);
  const result   = extractResult(job);
  const snap     = extractSnapshot(timeline, job.id);

  const orig  = snap?.originalDimensions;
  const gin   = snap?.geminiInputDimensions;
  const rout  = snap?.rawOutputDimensions;
  const fout  = snap?.finalOutputDimensions;

  function driftVs(a: { width: number; height: number } | null | undefined, b: { width: number; height: number } | null | undefined) {
    if (!a || !b || a.height === 0 || b.height === 0) return 0;
    const ar = a.width / a.height;
    const br = b.width / b.height;
    return Math.abs(ar - br) / ar;
  }

  const ginVsOrig  = driftVs(gin, orig);
  const routVsGin  = driftVs(rout, gin);
  const foutVsRout = driftVs(fout, rout);

  function jobEventHasFailureReason(reason: string) {
    return timeline.some(
      (e) =>
        e.eventType === "render_failed" &&
        isRecord(e.metadata) &&
        (e.metadata as Record<string, unknown>)["failureReason"] === reason &&
        (e.metadata as Record<string, unknown>)["renderJobId"] === job.id,
    );
  }

  const promptOnlyMode = timeline.some(
    (e) => e.eventType === "floor_polygon_missing_prompt_only_mode",
  );

  const warnings: string[] = [];
  if (!snap)                              warnings.push("لا يوجد render_diagnostics_snapshot — شغّل رندراً جديداً");
  if (jobEventHasFailureReason("output_aspect_ratio_mismatch"))
                                          warnings.push("سبب الفشل: output_aspect_ratio_mismatch — نسبة أبعاد ناتج Gemini مختلفة عن المدخل بعد المحاولة الثانية");
  if (!input?.floorPolygon && snap)       warnings.push(promptOnlyMode ? "floorPolygon مفقود — الرندر في وضع النص فقط (prompt-only)" : "floorPolygon مفقود");
  if (!input?.productName  && snap)       warnings.push("productName مفقود");
  if (!snap?.promptVersion && snap)       warnings.push("promptVersion مفقود");
  if (snap?.paddingApplied)               warnings.push("احتمال قص/تمديد — paddingApplied: true");
  if (snap?.cropApplied)                  warnings.push("احتمال قص — cropApplied: true");
  if (ginVsOrig  > 0.02)                  warnings.push(`اختلاف أبعاد — Gemini input vs original: ${(ginVsOrig * 100).toFixed(1)}%`);
  if (routVsGin  > 0.05)                  warnings.push(`اختلاف أبعاد — raw output vs Gemini input: ${(routVsGin * 100).toFixed(1)}%`);
  if (foutVsRout > 0.001)                 warnings.push(`تم حفظ الناتج الخام — final differs from raw output`);

  const statusColor =
    job.status === "completed" ? "bg-emerald-100 text-emerald-800"
    : job.status === "failed"  ? "bg-red-100 text-red-800"
    : "bg-slate-100 text-slate-700";

  const artifacts = snap?.artifactUrls ?? {};
  const artifactList: Array<{ key: string; label: string }> = [
    { key: "01-original-upload",   label: "01 · Original Upload" },
    { key: "02-gemini-input",      label: "02 · Gemini Input" },
    { key: "03-gemini-raw-output", label: "03 · Raw Gemini Output" },
    { key: "04-final-saved-output",label: "04 · Final Saved Output" },
    { key: "prompt",               label: "prompt.txt" },
    { key: "metadata",             label: "metadata.json" },
  ];
  // Inject direct link for 01 from room imageUrl if no artifact was saved
  if (!artifacts["01-original-upload"] && input?.roomImageUrl) {
    artifacts["01-original-upload"] = input.roomImageUrl;
  }

  return (
    <div className="space-y-4 pt-4 border-t border-slate-100 first:border-t-0 first:pt-0">

      {/* Job header */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-slate-800">{job.id}</span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusColor}`}>{job.status}</span>
        {result?.modelName && (
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700 font-medium">{result.modelName}</span>
        )}
        {snap?.promptVersion && (
          <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[11px] text-purple-700 font-medium">{snap.promptVersion}</span>
        )}
        <span className="text-[11px] text-slate-400">{dateTime(job.createdAt)}</span>
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-1">
          <p className="text-[11px] font-semibold text-red-700 uppercase tracking-wide">Warnings</p>
          {warnings.map((w, i) => (
            <p key={i} className="flex items-start gap-1.5 text-xs text-red-700">
              <span>⚠</span> {w}
            </p>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">

        {/* Metadata table */}
        <div>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Metadata</h3>
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-xs">
              <tbody className="divide-y divide-slate-100 bg-white">
                {([
                  ["sessionId",      sessionId],
                  ["renderJobId",    job.id],
                  ["status",         job.status],
                  ["model",          result?.modelName ?? snap?.modelName ?? "—"],
                  ["promptVersion",  snap?.promptVersion ?? "—"],
                  ["productName",    input?.productName ?? "—"],
                  ["createdAt",      dateTime(job.createdAt)],
                  ["updatedAt",      dateTime(job.updatedAt)],
                ] as [string, string][]).map(([k, v]) => (
                  <tr key={k}>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-500 w-36">{k}</td>
                    <td className="px-3 py-2 text-slate-800 break-all">{v}</td>
                  </tr>
                ))}
                {input?.productImageUrl && (
                  <tr>
                    <td className="px-3 py-2 font-mono text-slate-500">productImage</td>
                    <td className="px-3 py-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={input.productImageUrl} alt="" className="h-12 w-12 rounded object-contain bg-slate-100" />
                    </td>
                  </tr>
                )}
                {input?.roomImageUrl && (
                  <tr>
                    <td className="px-3 py-2 font-mono text-slate-500">roomImage</td>
                    <td className="px-3 py-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={input.roomImageUrl} alt="" className="h-20 rounded object-contain bg-slate-100" />
                    </td>
                  </tr>
                )}
                {result?.imageUrl && (
                  <tr>
                    <td className="px-3 py-2 font-mono text-slate-500">outputImage</td>
                    <td className="px-3 py-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={result.imageUrl} alt="" className="h-20 rounded object-contain bg-slate-100" />
                    </td>
                  </tr>
                )}
                <tr>
                  <td className="px-3 py-2 font-mono text-slate-500 align-top">floorPolygon</td>
                  <td className="px-3 py-2">
                    {input?.floorPolygon
                      ? <pre className="text-[10px] text-slate-700 leading-4">{JSON.stringify(input.floorPolygon, null, 2)}</pre>
                      : <WarnBadge label="floorPolygon مفقود" />}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Right column: dimensions + flags */}
        <div className="space-y-4">

          {/* Dimensions table */}
          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Image Pipeline Dimensions</h3>
            {!snap ? (
              <p className="rounded-lg bg-slate-50 px-3 py-4 text-xs text-slate-500 text-center">
                No snapshot yet — run a new render to populate this table.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50">
                    <tr>
                      {["Stage", "W", "H", "Aspect", "Notes"].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-[10px] uppercase tracking-wide text-slate-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {([
                      { label: "Original upload",    dim: orig,  drift: 0,          note: snap.resizedApplied ? "resize will apply" : "no resize needed" },
                      { label: "Gemini input",        dim: gin,   drift: ginVsOrig,  note: snap.resizedApplied ? "fit:inside resized" : "no resize applied" },
                      { label: "Raw Gemini output",   dim: rout,  drift: routVsGin,  note: snap.savedRaw ? "saved_raw (no transform)" : "" },
                      { label: "Final saved output",  dim: fout,  drift: foutVsRout, note: snap.outputImageUrl ? "→ storage" : "" },
                    ] as Array<{ label: string; dim: typeof orig; drift: number; note: string }>).map(({ label, dim, drift, note }) => (
                      <tr key={label}>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-700">{label}</td>
                        <td className="px-3 py-2 tabular-nums text-slate-800">{dim?.width ?? "—"}</td>
                        <td className="px-3 py-2 tabular-nums text-slate-800">{dim?.height ?? "—"}</td>
                        <td className="px-3 py-2 tabular-nums text-slate-600">
                          {dim ? aspectRatio(dim.width, dim.height) : "—"}
                          <DimBadge drift={drift} />
                        </td>
                        <td className="px-3 py-2 text-slate-400 text-[10px]">{note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Flags */}
          {snap && (
            <div>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Transform Flags</h3>
              <div className="space-y-1">
                <FlagRow label="resizedApplied"          value={snap.resizedApplied} />
                <FlagRow label="cropApplied"             value={snap.cropApplied} />
                <FlagRow label="paddingApplied"          value={snap.paddingApplied} />
                <FlagRow label="normalizedApplied"       value={snap.normalizedApplied} />
                <FlagRow label="fillApplied"             value={snap.fillApplied} />
                <FlagRow label="containApplied"         value={snap.containApplied} />
                <FlagRow label="coverApplied"            value={snap.coverApplied} />
                <FlagRow label="exifOrientationApplied"  value={snap.exifOrientationApplied} />
                <FlagRow label="savedRaw"                value={snap.savedRaw} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Prompt viewer */}
      {snap?.promptText && (
        <details className="mt-2">
          <summary className="cursor-pointer rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 list-none flex items-center justify-between">
            <span>Prompt <span className="ml-1.5 text-slate-400 font-normal">(version: {snap.promptVersion ?? "—"}, model: {snap.modelName ?? "—"})</span></span>
            <span className="text-slate-400">▼</span>
          </summary>
          <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-slate-200 bg-slate-950 p-4 text-[11px] leading-5 text-emerald-300 whitespace-pre-wrap">
            {snap.promptText}
          </pre>
        </details>
      )}

      {/* Debug artifact links */}
      {Object.keys(artifacts).length > 0 && (
        <div>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Debug Artifacts
            {!process.env.ROOM_PREVIEW_DEBUG_RENDER_ARTIFACTS && (
              <span className="ml-2 font-normal text-slate-400">(enable ROOM_PREVIEW_DEBUG_RENDER_ARTIFACTS=true to save all stages)</span>
            )}
          </h3>
          <div className="flex flex-wrap gap-2">
            {artifactList.map(({ key, label }) => {
              const url = artifacts[key];
              if (!url) return null;
              const isImage = key.startsWith("0") && !key.endsWith("txt");
              return (
                <a
                  key={key}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex flex-col items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2 text-[10px] text-slate-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                >
                  {isImage ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={url}
                      alt={label}
                      className="h-20 w-28 rounded object-contain bg-white border border-slate-200"
                      loading="lazy"
                    />
                  ) : (
                    <div className="h-20 w-28 rounded border border-slate-200 bg-white flex items-center justify-center text-slate-400">
                      <span className="text-lg">📄</span>
                    </div>
                  )}
                  <span className="font-mono text-center leading-tight">{label}</span>
                </a>
              );
            })}
          </div>
        </div>
      )}

      {/* No artifacts hint */}
      {Object.keys(artifacts).length === 0 && snap && (
        <p className="rounded-lg border border-dashed border-slate-200 px-4 py-3 text-xs text-slate-500">
          No debug artifacts saved.
          Set <code className="rounded bg-slate-100 px-1 font-mono text-slate-700">ROOM_PREVIEW_DEBUG_RENDER_ARTIFACTS=true</code> and re-run a render to save stage images and the prompt.
        </p>
      )}
    </div>
  );
}
