import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminHeader } from "../../_components/admin-header";
import { getSessionDiagnostics } from "@/lib/admin/session-diagnostics";
import { TimelineClient } from "./_components/TimelineClient";
import type { TimelineEvent } from "./_components/TimelineClient";

type SessionDiagnosticsPageProps = {
  params: Promise<{ sessionId: string }>;
};

// ─── Formatters ───────────────────────────────────────────────────────────────

function dateTime(iso: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(iso));
}

function formatDuration(ms: number): string {
  if (ms < 0) return "—";
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1_000);
  return `${m}m ${s}s`;
}

function relativeMs(base: string, event: string) {
  const diff = new Date(event).getTime() - new Date(base).getTime();
  return formatDuration(diff);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

// ─── Data helpers ─────────────────────────────────────────────────────────────

type TEvent = { eventType: string; timestamp: string; metadata: unknown; level: string; source: string; statusAfter: string | null };

function findEvent(timeline: TEvent[], eventType: string): TEvent | null {
  return timeline.find((e) => e.eventType === eventType) ?? null;
}

function hasEvent(timeline: TEvent[], eventType: string): boolean {
  return timeline.some((e) => e.eventType === eventType);
}

function findStatusChange(timeline: TEvent[], toStatus: string): TEvent | null {
  return timeline.find((e) => e.eventType === "session_status_changed" && e.statusAfter === toStatus) ?? null;
}

function countEvents(timeline: TEvent[], eventType: string): number {
  return timeline.filter((e) => e.eventType === eventType).length;
}

// ─── Render timing extraction ─────────────────────────────────────────────────

type AttemptTiming = {
  attempt: number;
  modelName: string;
  durationMs: number;
  status: string;
  retryReason?: string;
  attemptTimeoutMs?: number;
  abortedByTimeout?: boolean;
};

type ProviderTiming = {
  renderJobId?: string;
  totalProviderMs?: number;
  imageLoadMs?: number;
  geminiMs?: number;
  uploadMs?: number;
  validationMs?: number;
  attemptCount?: number;
  retried?: boolean;
  retryReason?: string | null;
  qualityMode?: string;
  promptVersion?: string;
  promptLength?: number;
  inputDimensions?: { width: number; height: number };
  outputDimensions?: { width: number; height: number };
  modelName?: string;
  attemptTimings?: AttemptTiming[];
  firstAttemptTimeoutMs?: number;
  retryAttemptTimeoutMs?: number;
  envConfig?: Record<string, unknown>;
};

type ServiceTiming = {
  renderJobId?: string;
  status?: string;
  totalMs?: number;
  setupMs?: number;
  providerMs?: number;
  saveMs?: number;
};

function extractTimings(timeline: TEvent[]): { provider: ProviderTiming | null; service: ServiceTiming | null } {
  const summaries = timeline.filter((e) => e.eventType === "render_timing_summary" && isRecord(e.metadata));
  const providerEvent = [...summaries].reverse().find((e) => isRecord(e.metadata) && "totalProviderMs" in e.metadata);
  const serviceEvent  = [...summaries].reverse().find((e) => isRecord(e.metadata) && "totalMs" in e.metadata);
  return {
    provider: providerEvent ? (providerEvent.metadata as ProviderTiming) : null,
    service:  serviceEvent  ? (serviceEvent.metadata  as ServiceTiming)  : null,
  };
}

// ─── Health status ────────────────────────────────────────────────────────────

type HealthStatus = "healthy" | "completed_issues" | "failed" | "expired" | "rendering" | "stuck" | "warning" | "active";

type IssueRow = { status: string; issueType: string; severity: string; count: number };

function deriveHealth(
  sessionStatus: string,
  issues: IssueRow[],
): { status: HealthStatus; label: string; message: string } {
  const open   = issues.filter((i) => i.status === "open");
  const stuck  = open.filter((i) => ["SESSION_STUCK", "RENDER_TIMEOUT", "ROOM_UPLOAD_STUCK", "MOBILE_OPENED_NO_PROGRESS"].includes(i.issueType));
  const critical = open.filter((i) => i.severity === "critical");

  if (sessionStatus === "failed")
    return { status: "failed",   label: "Failed",   message: "Render or session failed. Check issues and timeline for the failure reason." };
  if (sessionStatus === "expired")
    return { status: "expired",  label: "Expired",  message: "Session expired before completion. The 8-minute timer starts at creation, not at customer scan." };
  if (sessionStatus === "completed" && open.length === 0)
    return { status: "healthy",  label: "Healthy",  message: "Session completed successfully. The customer received their render result." };
  if (sessionStatus === "completed")
    return { status: "completed_issues", label: "Completed", message: `Session completed but has ${open.length} open issue(s). Review the issues section.` };
  if (stuck.length > 0 || critical.length > 0)
    return { status: "stuck",    label: "Stuck",    message: `Session is stuck: ${(stuck[0] ?? critical[0]).issueType}. An operation hasn't progressed within the expected time.` };
  if (sessionStatus === "rendering" || sessionStatus === "ready_to_render")
    return { status: "rendering", label: "Rendering", message: "Gemini is currently processing this floor replacement. Results typically arrive in 25–90 seconds." };
  if (open.length > 0)
    return { status: "warning",  label: "Warning",  message: `${open.length} open issue(s) detected. Session may still complete.` };
  return { status: "active",   label: "Active",   message: "Session is active and progressing normally." };
}

// ─── Journey steps ────────────────────────────────────────────────────────────

type StepState = "done" | "failed" | "active" | "pending";

type JourneyStep = {
  id: string;
  label: string;
  timestamp: string | null;
  state: StepState;
};

function buildJourneySteps(
  summary: { status: string; mobileConnected: boolean; roomUploaded: boolean; productSelected: boolean; renderStarted: boolean; renderCompleted: boolean; createdAt: string },
  timeline: TEvent[],
  sessionStatus: string,
): JourneyStep[] {
  const isFailed  = sessionStatus === "failed";
  const isExpired = sessionStatus === "expired";

  function ts(event: TEvent | null) {
    return event?.timestamp ?? null;
  }

  const created      = findEvent(timeline, "session_created");
  const qrDisplayed  = findEvent(timeline, "qr_displayed");
  const qrScanned    = findEvent(timeline, "qr_opened");
  const mobileConn   = findStatusChange(timeline, "mobile_connected");
  const roomUploaded = findEvent(timeline, "room_upload_completed");
  const productSel   = findEvent(timeline, "product_selected");
  const renderReq    = findEvent(timeline, "render_start_clicked") ?? findEvent(timeline, "render_request_started");
  const renderStart  = findStatusChange(timeline, "rendering") ?? findEvent(timeline, "render_started");
  const renderDone   = findEvent(timeline, "render_request_accepted") ?? findEvent(timeline, "render_request_success") ?? findStatusChange(timeline, "result_ready");
  const resultScreen = findEvent(timeline, "result_displayed_screen");
  const resultMobile = findEvent(timeline, "result_seen_mobile");
  const completion   = findEvent(timeline, "screen_completion_message_displayed");
  const redirected   = findEvent(timeline, "screen_completed_redirect_to_home");

  function stepState(done: boolean, eventForFail?: boolean): StepState {
    if (done) return "done";
    if ((isFailed || isExpired) && eventForFail) return "failed";
    return "pending";
  }

  const steps: JourneyStep[] = [
    { id: "created",        label: "Session Created",    timestamp: created?.timestamp ?? summary.createdAt, state: "done" },
    { id: "qr_displayed",   label: "QR Displayed",       timestamp: ts(qrDisplayed),  state: stepState(!!qrDisplayed) },
    { id: "qr_scanned",     label: "QR Scanned",         timestamp: ts(qrScanned),    state: stepState(!!qrScanned) },
    { id: "mobile_conn",    label: "Mobile Connected",   timestamp: ts(mobileConn),   state: stepState(!!mobileConn || summary.mobileConnected) },
    { id: "room_uploaded",  label: "Room Uploaded",      timestamp: ts(roomUploaded), state: stepState(!!roomUploaded || summary.roomUploaded, isFailed || isExpired) },
    { id: "product_sel",    label: "Product Selected",   timestamp: ts(productSel),   state: stepState(!!productSel || summary.productSelected, isFailed || isExpired) },
    { id: "render_req",     label: "Render Requested",   timestamp: ts(renderReq),    state: stepState(!!renderReq || summary.renderStarted) },
    { id: "render_start",   label: "Render Started",     timestamp: ts(renderStart),  state: stepState(!!renderStart || summary.renderStarted) },
    { id: "render_done",    label: "Render Completed",   timestamp: ts(renderDone),   state: stepState(!!renderDone || summary.renderCompleted, isFailed) },
    { id: "result_screen",  label: "Result on Screen",   timestamp: ts(resultScreen), state: stepState(!!resultScreen) },
    { id: "result_mobile",  label: "Result on Mobile",   timestamp: ts(resultMobile), state: stepState(!!resultMobile) },
    { id: "completion_msg", label: "Completion Message", timestamp: ts(completion),   state: stepState(!!completion) },
    { id: "redirected",     label: "Redirected Home",    timestamp: ts(redirected),   state: stepState(!!redirected) },
  ];

  // Mark first pending step as "active" on live sessions
  const terminalStatuses = ["completed", "failed", "expired"];
  if (!terminalStatuses.includes(sessionStatus)) {
    const firstPending = steps.find((s) => s.state === "pending");
    if (firstPending) firstPending.state = "active";
  }

  return steps;
}

// ─── Timing milestones ────────────────────────────────────────────────────────

type TimingRow = { label: string; from: string | null; to: string | null; description: string };

function buildTimingRows(
  summary: { createdAt: string },
  timeline: TEvent[],
): TimingRow[] {
  const createdAt  = findEvent(timeline, "session_created")?.timestamp ?? summary.createdAt;
  const qrShown    = findEvent(timeline, "qr_displayed")?.timestamp        ?? null;
  const qrScanned  = findEvent(timeline, "qr_opened")?.timestamp            ?? null;
  const connected  = findStatusChange(timeline, "mobile_connected")?.timestamp ?? null;
  const uploaded   = findEvent(timeline, "room_upload_completed")?.timestamp   ?? null;
  const selected   = findEvent(timeline, "product_selected")?.timestamp        ?? null;
  const renderReq  = (findEvent(timeline, "render_start_clicked") ?? findEvent(timeline, "render_request_started"))?.timestamp ?? null;
  const rendering  = findStatusChange(timeline, "rendering")?.timestamp        ?? null;
  const resultReady = findStatusChange(timeline, "result_ready")?.timestamp    ?? null;
  const lastEvent  = timeline.at(-1)?.timestamp                                ?? null;

  return [
    { label: "Created → QR shown",       from: createdAt, to: qrShown,    description: "Session setup" },
    { label: "QR shown → customer scan", from: qrShown,   to: qrScanned,  description: "Time QR was visible before scan" },
    { label: "Scan → mobile connected",  from: qrScanned, to: connected,  description: "Gate + navigation time" },
    { label: "Connected → room uploaded",from: connected,  to: uploaded,   description: "Room photo upload" },
    { label: "Room → product selected",  from: uploaded,   to: selected,   description: "Product selection" },
    { label: "Product → render request", from: selected,   to: renderReq,  description: "Time before tapping render" },
    { label: "Request → render started", from: renderReq,  to: rendering,  description: "Queue + setup overhead" },
    { label: "Render started → result",  from: rendering,  to: resultReady, description: "Gemini processing time" },
    { label: "Total (created → end)",    from: createdAt,  to: lastEvent,  description: "Full session duration" },
  ];
}

// ─── Why slow insights ────────────────────────────────────────────────────────

type SlowInsight = { label: string; detail: string; severity: "info" | "warn" | "critical" };

function deriveSlowInsights(provider: ProviderTiming | null, timeline: TEvent[]): SlowInsight[] {
  if (!provider) return [];
  const insights: SlowInsight[] = [];

  if (provider.retried && provider.retryReason === "timeout") {
    const first = provider.firstAttemptTimeoutMs ?? "?";
    const retry = provider.retryAttemptTimeoutMs ?? "?";
    insights.push({
      label: "First Gemini call timed out",
      detail: `Attempt 1 hit the ${formatDuration(typeof first === "number" ? first : 0)} timeout and was aborted. Retry added ~${formatDuration(typeof retry === "number" ? retry : 0)} to the total.`,
      severity: "critical",
    });
  }

  if (provider.retried && provider.retryReason === "aspect_ratio_mismatch") {
    insights.push({
      label: "Gemini returned wrong dimensions",
      detail: "Output aspect ratio differed from input. A stricter prompt retry was triggered, adding a full Gemini call to the total.",
      severity: "warn",
    });
  }

  const floorPolygonMissing = hasEvent(timeline, "floor_polygon_missing_prompt_only_mode");
  if (floorPolygonMissing) {
    insights.push({
      label: "No floor polygon — prompt-only mode",
      detail: "Without pixel coordinates, Gemini must estimate the floor region from scene geometry. This is the most computationally expensive path.",
      severity: "warn",
    });
  }

  if (provider.qualityMode && provider.qualityMode !== "fast") {
    insights.push({
      label: `Quality mode: "${provider.qualityMode}"`,
      detail: `Fast mode uses a smaller image (1024px) and shorter prompt (~800 chars vs ~2400 chars). Set ROOM_PREVIEW_RENDER_QUALITY=fast to reduce Gemini load.`,
      severity: "info",
    });
  }

  if (provider.totalProviderMs && provider.totalProviderMs > 100_000 && !provider.retried) {
    insights.push({
      label: "Gemini call was slow without retry",
      detail: `Provider took ${formatDuration(provider.totalProviderMs)} without a retry. This suggests Gemini server-side latency rather than a timeout-retry cycle.`,
      severity: "warn",
    });
  }

  if (provider.attemptTimings?.some((t) => t.abortedByTimeout)) {
    insights.push({
      label: "Timeout abort confirmed",
      detail: "At least one attempt was cut short by our AbortController. Note: Gemini's server continues processing the aborted request — two concurrent jobs may run during the retry window.",
      severity: "info",
    });
  }

  return insights;
}

// ─── HealthBanner ─────────────────────────────────────────────────────────────

function HealthBanner({ sessionStatus, issues }: { sessionStatus: string; issues: IssueRow[] }) {
  const health = deriveHealth(sessionStatus, issues);

  const cfg: Record<HealthStatus, { bg: string; border: string; dot: string; text: string }> = {
    healthy:          { bg: "bg-emerald-50",  border: "border-emerald-200", dot: "bg-emerald-500",  text: "text-emerald-800" },
    completed_issues: { bg: "bg-amber-50",    border: "border-amber-200",   dot: "bg-amber-500",    text: "text-amber-800" },
    failed:           { bg: "bg-red-50",      border: "border-red-200",     dot: "bg-red-500",      text: "text-red-800" },
    expired:          { bg: "bg-slate-100",   border: "border-slate-300",   dot: "bg-slate-400",    text: "text-slate-700" },
    rendering:        { bg: "bg-blue-50",     border: "border-blue-200",    dot: "bg-blue-500",     text: "text-blue-800" },
    stuck:            { bg: "bg-orange-50",   border: "border-orange-200",  dot: "bg-orange-500",   text: "text-orange-800" },
    warning:          { bg: "bg-amber-50",    border: "border-amber-200",   dot: "bg-amber-400",    text: "text-amber-800" },
    active:           { bg: "bg-blue-50",     border: "border-blue-200",    dot: "bg-blue-400",     text: "text-blue-800" },
  };

  const c = cfg[health.status];

  return (
    <div className={`flex items-center gap-4 rounded-xl border ${c.border} ${c.bg} px-5 py-4 shadow-sm`}>
      <div className={`h-3 w-3 shrink-0 rounded-full ${c.dot} ${health.status === "rendering" ? "animate-pulse" : ""}`} />
      <div className="min-w-0">
        <span className={`text-sm font-semibold ${c.text}`}>{health.label}</span>
        <p className={`mt-0.5 text-xs ${c.text} opacity-80`}>{health.message}</p>
      </div>
    </div>
  );
}

// ─── JourneyStepper ───────────────────────────────────────────────────────────

function JourneyStepper({ steps, sessionStart }: { steps: JourneyStep[]; sessionStart: string }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold text-slate-950">Session Journey</h2>
      <div className="overflow-x-auto pb-2">
        <div className="flex min-w-max gap-0">
          {steps.map((step, idx) => {
            const dotCls =
              step.state === "done"    ? "bg-emerald-500 ring-emerald-100"
              : step.state === "active"  ? "bg-blue-500 ring-blue-100 animate-pulse"
              : step.state === "failed"  ? "bg-red-500 ring-red-100"
              :                            "bg-slate-200 ring-slate-50";

            const labelCls =
              step.state === "done"   ? "text-slate-700"
              : step.state === "active" ? "text-blue-700 font-semibold"
              : step.state === "failed" ? "text-red-600"
              :                           "text-slate-400";

            const icon =
              step.state === "done"   ? "✓"
              : step.state === "failed" ? "✗"
              : step.state === "active" ? "●"
              :                           "○";

            const delta = step.timestamp && idx > 0 && steps[idx - 1].timestamp
              ? relativeMs(steps[idx - 1].timestamp!, step.timestamp)
              : null;

            return (
              <div key={step.id} className="flex items-start">
                <div className="flex w-20 flex-col items-center gap-1 px-1">
                  <div className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white ring-4 ${dotCls}`}>
                    {icon}
                  </div>
                  <p className={`max-w-[72px] text-center text-[9px] leading-tight ${labelCls}`}>
                    {step.label}
                  </p>
                  {step.timestamp && (
                    <p className="text-center text-[8px] text-slate-400 whitespace-nowrap">
                      {new Date(step.timestamp).toLocaleTimeString("en", { hour12: false, timeStyle: "medium" })}
                    </p>
                  )}
                  {delta && (
                    <p className="text-center text-[8px] text-slate-400">{delta}</p>
                  )}
                </div>
                {idx < steps.length - 1 && (
                  <div className="mt-[11px] h-px w-4 shrink-0 bg-slate-200" />
                )}
              </div>
            );
          })}
        </div>
      </div>
      {/* unused, kept for semantics */}
      <p className="mt-2 text-[10px] text-slate-400">
        Session start: {dateTime(sessionStart)}
      </p>
    </section>
  );
}

// ─── SessionTimingCard ────────────────────────────────────────────────────────

function SessionTimingCard({ rows }: { rows: TimingRow[] }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-slate-950">Session Timing</h2>
      <div className="space-y-1">
        {rows.map((row) => {
          const ms = row.from && row.to
            ? new Date(row.to).getTime() - new Date(row.from).getTime()
            : null;
          const dur = ms !== null ? formatDuration(ms) : "—";
          const isTotal = row.label.startsWith("Total");
          const isLong  = ms !== null && ms > 60_000;
          return (
            <div
              key={row.label}
              className={`flex items-center justify-between rounded-lg px-3 py-2 ${
                isTotal ? "border border-slate-200 bg-slate-50" : ""
              }`}
            >
              <span className={`text-xs ${isTotal ? "font-semibold text-slate-800" : "text-slate-600"}`}>
                {row.label}
              </span>
              <span className={`font-mono text-xs tabular-nums ${
                ms === null ? "text-slate-400"
                : isTotal   ? "font-bold text-slate-900"
                : isLong    ? "font-semibold text-amber-700"
                :             "text-slate-700"
              }`}>
                {dur}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── RenderPerformanceCard ────────────────────────────────────────────────────

function RenderPerformanceCard({
  provider,
  service,
}: {
  provider: ProviderTiming | null;
  service: ServiceTiming | null;
}) {
  if (!provider && !service) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-950">Render Performance</h2>
        <p className="text-sm text-slate-400">No render timing data yet.</p>
      </div>
    );
  }

  const totalMs = service?.totalMs ?? provider?.totalProviderMs ?? 0;
  const totalColor =
    totalMs < 45_000  ? "text-emerald-700 bg-emerald-50 border-emerald-200"
    : totalMs < 100_000 ? "text-amber-700 bg-amber-50 border-amber-200"
    :                     "text-red-700 bg-red-50 border-red-200";

  const stages: { label: string; ms: number | null | undefined; note?: string }[] = [
    { label: "Setup (DB + slot claim)",  ms: service?.setupMs },
    { label: "Image load + encode",      ms: provider?.imageLoadMs },
    { label: "Gemini API call",          ms: provider?.geminiMs,    note: provider?.attemptCount && provider.attemptCount > 1 ? `${provider.attemptCount} attempts` : undefined },
    { label: "Output validation",        ms: provider?.validationMs },
    { label: "Provider upload (PNG→R2)", ms: provider?.uploadMs },
    { label: "Save + SSE publish",       ms: service?.saveMs },
  ];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-950">Render Performance</h2>
        <div className={`rounded-lg border px-3 py-1.5 text-center ${totalColor}`}>
          <p className="text-[10px] uppercase tracking-wide opacity-70">Total</p>
          <p className="font-mono text-lg font-bold tabular-nums">{formatDuration(totalMs)}</p>
        </div>
      </div>

      {/* Stage breakdown */}
      <div className="mb-4 space-y-1">
        {stages.map(({ label, ms, note }) => {
          if (ms == null || ms <= 0) return null;
          const pct = totalMs > 0 ? Math.round((ms / totalMs) * 100) : 0;
          const barColor =
            label.includes("Gemini") ? "bg-blue-400"
            : label.includes("upload") || label.includes("Upload") ? "bg-emerald-400"
            : "bg-slate-300";
          return (
            <div key={label}>
              <div className="mb-0.5 flex items-center justify-between">
                <span className="text-xs text-slate-600">
                  {label}
                  {note && <span className="ml-1.5 text-[10px] text-slate-400">({note})</span>}
                </span>
                <span className="font-mono text-xs tabular-nums text-slate-700">{formatDuration(ms)}</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Attempt table */}
      {provider?.attemptTimings && provider.attemptTimings.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Gemini Attempts</h3>
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-xs">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  {["#", "Model", "Duration", "Timeout Budget", "Status"].map((h) => (
                    <th key={h} className="px-3 py-1.5 text-left text-[10px] uppercase tracking-wide text-slate-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {provider.attemptTimings.map((t) => {
                  const rowColor =
                    t.status === "succeeded"              ? ""
                    : t.abortedByTimeout                    ? "bg-red-50"
                    : t.status === "aspect_ratio_mismatch"  ? "bg-amber-50"
                    : t.status.includes("error")            ? "bg-amber-50"
                    :                                         "";
                  const statusColor =
                    t.status === "succeeded"              ? "text-emerald-700 bg-emerald-50"
                    : t.abortedByTimeout                    ? "text-red-700 bg-red-100"
                    : t.status === "aspect_ratio_mismatch"  ? "text-amber-700 bg-amber-50"
                    :                                         "text-slate-600 bg-slate-100";
                  return (
                    <tr key={t.attempt} className={rowColor}>
                      <td className="px-3 py-2 text-slate-500">{t.attempt}</td>
                      <td className="px-3 py-2 font-mono text-slate-600">{t.modelName}</td>
                      <td className="px-3 py-2 font-mono tabular-nums text-slate-800">{formatDuration(t.durationMs)}</td>
                      <td className="px-3 py-2 font-mono tabular-nums text-slate-500">
                        {t.attemptTimeoutMs ? formatDuration(t.attemptTimeoutMs) : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusColor}`}>
                          {t.abortedByTimeout ? "timed out" : t.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Config */}
      {provider && (
        <div className="mt-3 flex flex-wrap gap-2">
          {provider.qualityMode && (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] text-slate-600">
              quality: {provider.qualityMode}
            </span>
          )}
          {provider.promptVersion && (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] text-slate-600">
              {provider.promptVersion}
            </span>
          )}
          {provider.inputDimensions && (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-[10px] text-slate-600">
              input: {provider.inputDimensions.width}×{provider.inputDimensions.height}
            </span>
          )}
          {provider.firstAttemptTimeoutMs && (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-[10px] text-slate-600">
              t₁: {formatDuration(provider.firstAttemptTimeoutMs)}
            </span>
          )}
          {provider.retryAttemptTimeoutMs && (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-[10px] text-slate-600">
              t₂: {formatDuration(provider.retryAttemptTimeoutMs)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── WhySlowCard ──────────────────────────────────────────────────────────────

function WhySlowCard({ insights }: { insights: SlowInsight[] }) {
  if (insights.length === 0) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-slate-950">Why was this slow?</h2>
      <div className="space-y-2">
        {insights.map((ins, i) => {
          const color =
            ins.severity === "critical" ? "border-red-200 bg-red-50"
            : ins.severity === "warn"    ? "border-amber-200 bg-amber-50"
            :                             "border-slate-200 bg-slate-50";
          const dot =
            ins.severity === "critical" ? "bg-red-500"
            : ins.severity === "warn"    ? "bg-amber-500"
            :                             "bg-slate-400";
          return (
            <div key={i} className={`flex gap-3 rounded-lg border px-3 py-2.5 ${color}`}>
              <div className={`mt-1 h-2 w-2 shrink-0 rounded-full ${dot}`} />
              <div>
                <p className="text-xs font-semibold text-slate-800">{ins.label}</p>
                <p className="mt-0.5 text-[11px] text-slate-600">{ins.detail}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── ScreenUxCard ─────────────────────────────────────────────────────────────

function ScreenUxCard({ timeline }: { timeline: TEvent[] }) {
  const screenEvents = timeline.filter((e) => e.source === "screen");
  const sseConn   = countEvents(timeline, "sse_connected");
  const sseDisc   = countEvents(timeline, "sse_disconnected");
  const fallback  = hasEvent(timeline, "fallback_polling_started");
  const stale     = hasEvent(timeline, "screen_stale_detected");
  const resultSeen  = findEvent(timeline, "result_displayed_screen");
  const completion  = findEvent(timeline, "screen_completion_message_displayed");
  const redirected  = findEvent(timeline, "screen_completed_redirect_to_home");

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-slate-950">Screen UX</h2>
      <div className="space-y-1 text-xs">
        <UxRow label="Screen events"     value={String(screenEvents.length)} />
        <UxRow label="SSE connections"   value={String(sseConn)}  alert={sseDisc > 1} />
        <UxRow label="SSE disconnects"   value={String(sseDisc)}  alert={sseDisc > 0} />
        <UxRow label="Fallback polling"  value={fallback ? "yes" : "no"} alert={fallback} />
        <UxRow label="Screen stale"      value={stale ? "detected" : "no"} alert={stale} />
        <UxRow label="Result on screen"  value={resultSeen   ? new Date(resultSeen.timestamp).toLocaleTimeString() : "—"} />
        <UxRow label="Completion shown"  value={completion   ? new Date(completion.timestamp).toLocaleTimeString() : "—"} />
        <UxRow label="Redirected home"   value={redirected   ? new Date(redirected.timestamp).toLocaleTimeString() : "—"} />
      </div>
    </div>
  );
}

// ─── MobileUxCard ─────────────────────────────────────────────────────────────

function MobileUxCard({ timeline }: { timeline: TEvent[] }) {
  const mounts       = countEvents(timeline, "mobile_page_mounted") + countEvents(timeline, "mobile_component_mounted");
  const unmounts     = countEvents(timeline, "mobile_page_unmounted");
  const hides        = countEvents(timeline, "mobile_page_hide");
  const rapidReloads = countEvents(timeline, "mobile_rapid_reload_detected");
  const excessPoll   = countEvents(timeline, "mobile_excessive_polling_detected");
  const jsErrors     = countEvents(timeline, "mobile_js_error");
  const rejections   = countEvents(timeline, "mobile_unhandled_rejection");
  const fetchFails   = countEvents(timeline, "mobile_fetch_failed");
  const routerNavs   = countEvents(timeline, "mobile_router_navigate");
  const resultSeen   = findEvent(timeline, "result_seen_mobile");

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-slate-950">Mobile UX</h2>
      <div className="space-y-1 text-xs">
        <UxRow label="Mounts"         value={String(mounts)}       alert={mounts > 2} />
        <UxRow label="Unmounts"       value={String(unmounts)}     alert={unmounts > 0} />
        <UxRow label="Page hides"     value={String(hides)}        alert={hides > 0} />
        <UxRow label="Rapid reloads"  value={String(rapidReloads)} alert={rapidReloads > 0} />
        <UxRow label="Excess polling" value={String(excessPoll)}   alert={excessPoll > 0} />
        <UxRow label="JS errors"      value={String(jsErrors)}     alert={jsErrors > 0} />
        <UxRow label="Rejections"     value={String(rejections)}   alert={rejections > 0} />
        <UxRow label="Fetch fails"    value={String(fetchFails)}   alert={fetchFails > 1} />
        <UxRow label="Router navs"    value={String(routerNavs)} />
        <UxRow label="Result seen"    value={resultSeen ? new Date(resultSeen.timestamp).toLocaleTimeString() : "—"} />
      </div>
    </div>
  );
}

function UxRow({
  label,
  value,
  alert = false,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between rounded-lg px-3 py-1.5 ${alert ? "bg-amber-50" : "bg-slate-50"}`}>
      <span className="text-slate-600">{label}</span>
      <span className={`font-mono tabular-nums ${alert ? "font-semibold text-amber-700" : "text-slate-800"}`}>{value}</span>
    </div>
  );
}

// ─── IssuesSection ────────────────────────────────────────────────────────────

type FullIssue = {
  id: string;
  issueType: string;
  severity: string;
  status: string;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  recommendedAction: string | null;
  adminMessage: string | null;
};

function IssuesSection({ issues }: { issues: FullIssue[] }) {
  const open     = issues.filter((i) => i.status === "open");
  const resolved = issues.filter((i) => i.status === "resolved");
  const ignored  = issues.filter((i) => i.status === "ignored");

  function severityBadge(sev: string) {
    if (sev === "critical") return "bg-red-100 text-red-800 border border-red-200";
    if (sev === "high")     return "bg-orange-100 text-orange-800 border border-orange-200";
    if (sev === "medium")   return "bg-amber-100 text-amber-800 border border-amber-200";
    return "bg-slate-100 text-slate-600";
  }

  function IssueTable({ rows, emptyText }: { rows: FullIssue[]; emptyText: string }) {
    if (rows.length === 0) {
      return <p className="px-3 py-4 text-center text-sm text-slate-400">{emptyText}</p>;
    }
    return (
      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-xs">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              {["Type", "Sev.", "First seen", "Last seen", "#", "Action"].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-[10px] uppercase tracking-wide text-slate-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {rows.map((issue) => (
              <tr key={issue.id}>
                <td className="px-3 py-2.5">
                  <span className="font-mono text-slate-800">{issue.issueType}</span>
                  {issue.adminMessage && (
                    <p className="mt-0.5 text-[10px] text-slate-500">{issue.adminMessage}</p>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${severityBadge(issue.severity)}`}>
                    {issue.severity}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-slate-500">{dateTime(issue.firstSeenAt)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-slate-500">{dateTime(issue.lastSeenAt)}</td>
                <td className="px-3 py-2.5 text-center font-mono tabular-nums text-slate-700">{issue.count}</td>
                <td className="max-w-xs px-3 py-2.5 text-slate-600">{issue.recommendedAction ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold text-slate-950">
        Issues
        {open.length > 0 && (
          <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">
            {open.length} open
          </span>
        )}
      </h2>

      <div className="space-y-4">
        {open.length > 0 && (
          <div>
            <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-red-600">Open</h3>
            <IssueTable rows={open} emptyText="No open issues." />
          </div>
        )}
        {resolved.length > 0 && (
          <details>
            <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-800">
              {resolved.length} resolved issue(s) ▼
            </summary>
            <div className="mt-2">
              <IssueTable rows={resolved} emptyText="None." />
            </div>
          </details>
        )}
        {ignored.length > 0 && (
          <details>
            <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-800">
              {ignored.length} ignored issue(s) ▼
            </summary>
            <div className="mt-2">
              <IssueTable rows={ignored} emptyText="None." />
            </div>
          </details>
        )}
        {issues.length === 0 && (
          <p className="text-center text-sm text-slate-400">No issues recorded.</p>
        )}
      </div>
    </section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function SessionDiagnosticsPage({ params }: SessionDiagnosticsPageProps) {
  const { sessionId } = await params;
  const diagnostics = await getSessionDiagnostics(sessionId);

  if (!diagnostics) notFound();

  const { clientDiagnostics, issues, summary, timeline, renderJobs } = diagnostics;

  const sessionStart = timeline[0]?.timestamp ?? summary.createdAt;
  const steps        = buildJourneySteps(summary, timeline, summary.status);
  const timingRows   = buildTimingRows(summary, timeline);
  const { provider, service } = extractTimings(timeline);
  const slowInsights = deriveSlowInsights(provider, timeline);

  // Timeline events cast for the client component
  const timelineEvents = timeline as TimelineEvent[];

  return (
    <div className="min-h-screen bg-[#f6f8fb]">
      <AdminHeader />
      <main className="mx-auto max-w-7xl space-y-5 px-6 py-8">

        {/* ── Header ────────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <Link href="/admin/diagnostics" className="text-sm text-slate-500 hover:text-slate-800">
              ← Diagnostics
            </Link>
            <h1 className="mt-1.5 font-mono text-base font-semibold text-slate-950">{summary.id}</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
              {summary.status}
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-500">
              {dateTime(summary.createdAt)}
            </span>
          </div>
        </div>

        {/* ── Health Banner ─────────────────────────────────────────────────── */}
        <HealthBanner
          sessionStatus={summary.status}
          issues={issues.map((i) => ({ status: i.status, issueType: i.issueType, severity: i.severity, count: i.count }))}
        />

        {/* ── Journey Stepper ───────────────────────────────────────────────── */}
        <JourneyStepper steps={steps} sessionStart={sessionStart} />

        {/* ── Three-column UX row ───────────────────────────────────────────── */}
        <div className="grid gap-5 lg:grid-cols-3">
          <SessionTimingCard rows={timingRows} />
          <ScreenUxCard timeline={timeline} />
          <MobileUxCard timeline={timeline} />
        </div>

        {/* ── Render Performance ────────────────────────────────────────────── */}
        {summary.renderStarted && (
          <div className="grid gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <RenderPerformanceCard provider={provider} service={service} />
            </div>
            <WhySlowCard insights={slowInsights} />
          </div>
        )}

        {/* ── Issues ────────────────────────────────────────────────────────── */}
        <IssuesSection issues={issues as FullIssue[]} />

        {/* ── Client Diagnostics summary row ───────────────────────────────── */}
        <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {([
            ["Last mobile event",  clientDiagnostics.lastMobileEvent?.eventType  ?? "—"],
            ["Last screen event",  clientDiagnostics.lastScreenEvent?.eventType  ?? "—"],
            ["Last render event",  clientDiagnostics.lastRenderEvent?.eventType  ?? "—"],
            ["Last known problem", clientDiagnostics.lastKnownProblem            ?? "none"],
          ] as [string, string][]).map(([label, value]) => (
            <div key={label} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
              <p className="mt-1 break-words text-xs text-slate-800">{value}</p>
            </div>
          ))}
        </section>

        {/* ── Timeline ──────────────────────────────────────────────────────── */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-sm font-semibold text-slate-950">Timeline</h2>
            <span className="font-mono text-xs text-slate-500">{timeline.length} events</span>
          </div>
          <TimelineClient timeline={timelineEvents} sessionStart={sessionStart} />
        </section>

        {/* ── Render Diagnostics ────────────────────────────────────────────── */}
        <RenderDiagnosticsSection renderJobs={renderJobs} timeline={timeline} sessionId={sessionId} />

        {/* ── Raw session data (collapsible) ────────────────────────────────── */}
        <details>
          <summary className="cursor-pointer rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50 list-none flex items-center justify-between">
            <span>Raw session data</span>
            <span className="text-slate-400">▼</span>
          </summary>
          <pre className="mt-2 max-h-96 overflow-auto rounded-xl border border-slate-200 bg-slate-950 p-5 text-[10px] leading-5 text-emerald-300 whitespace-pre-wrap">
            {JSON.stringify({ summary, issues, clientDiagnostics }, null, 2)}
          </pre>
        </details>

      </main>
    </div>
  );
}

// ─── Render Diagnostics Section (kept from previous) ─────────────────────────

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
      ⚠ {pct}% drift
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
      <span className="font-mono text-xs text-slate-600">{label}</span>
      <span className={`text-xs font-bold ${v ? "text-amber-700" : "text-slate-400"}`}>{v ? "yes" : "no"}</span>
    </div>
  );
}

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
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-950">Render Diagnostics</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Image pipeline stages, dimension mismatches, and debug artifacts.
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
          No render jobs yet.
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
  const input  = extractInput(job);
  const result = extractResult(job);
  const snap   = extractSnapshot(timeline, job.id);

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

  const promptOnlyMode = timeline.some((e) => e.eventType === "floor_polygon_missing_prompt_only_mode");

  const warnings: string[] = [];
  if (!snap)                              warnings.push("No render_diagnostics_snapshot — run a new render to populate");
  if (jobEventHasFailureReason("output_aspect_ratio_mismatch")) warnings.push("Failure reason: output_aspect_ratio_mismatch");
  if (!input?.floorPolygon && snap)       warnings.push(promptOnlyMode ? "floorPolygon missing — prompt-only mode" : "floorPolygon missing");
  if (!input?.productName  && snap)       warnings.push("productName missing");
  if (!snap?.promptVersion && snap)       warnings.push("promptVersion missing");
  if (snap?.paddingApplied)               warnings.push("paddingApplied: true");
  if (snap?.cropApplied)                  warnings.push("cropApplied: true");
  if (ginVsOrig  > 0.02)                  warnings.push(`Aspect drift — Gemini input vs original: ${(ginVsOrig * 100).toFixed(1)}%`);
  if (routVsGin  > 0.05)                  warnings.push(`Aspect drift — raw output vs Gemini input: ${(routVsGin * 100).toFixed(1)}%`);
  if (foutVsRout > 0.001)                 warnings.push("Saved raw — final differs from raw output");

  const statusColor =
    job.status === "completed" ? "bg-emerald-100 text-emerald-800"
    : job.status === "failed"  ? "bg-red-100 text-red-800"
    :                            "bg-slate-100 text-slate-700";

  const artifacts = snap?.artifactUrls ?? {};
  const artifactList: Array<{ key: string; label: string }> = [
    { key: "01-original-upload",    label: "01 · Original Upload" },
    { key: "02-gemini-input",       label: "02 · Gemini Input" },
    { key: "03-gemini-raw-output",  label: "03 · Raw Gemini Output" },
    { key: "04-final-saved-output", label: "04 · Final Saved Output" },
    { key: "prompt",                label: "prompt.txt" },
    { key: "metadata",              label: "metadata.json" },
  ];
  if (!artifacts["01-original-upload"] && input?.roomImageUrl) {
    artifacts["01-original-upload"] = input.roomImageUrl;
  }

  return (
    <div className="space-y-4 border-t border-slate-100 pt-4 first:border-t-0 first:pt-0">

      {/* Job header */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-slate-800">{job.id}</span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusColor}`}>{job.status}</span>
        {result?.modelName && (
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">{result.modelName}</span>
        )}
        {snap?.promptVersion && (
          <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[11px] font-medium text-purple-700">{snap.promptVersion}</span>
        )}
        <span className="text-[11px] text-slate-400">{dateTime(job.createdAt)}</span>
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="space-y-1 rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-red-700">Warnings</p>
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
                  ["sessionId",     sessionId],
                  ["renderJobId",   job.id],
                  ["status",        job.status],
                  ["model",         result?.modelName ?? snap?.modelName ?? "—"],
                  ["promptVersion", snap?.promptVersion ?? "—"],
                  ["productName",   input?.productName ?? "—"],
                  ["createdAt",     dateTime(job.createdAt)],
                  ["updatedAt",     dateTime(job.updatedAt)],
                ] as [string, string][]).map(([k, v]) => (
                  <tr key={k}>
                    <td className="w-36 whitespace-nowrap px-3 py-2 font-mono text-slate-500">{k}</td>
                    <td className="break-all px-3 py-2 text-slate-800">{v}</td>
                  </tr>
                ))}
                {input?.productImageUrl && (
                  <tr>
                    <td className="px-3 py-2 font-mono text-slate-500">productImage</td>
                    <td className="px-3 py-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={input.productImageUrl} alt="" className="h-12 w-12 rounded bg-slate-100 object-contain" />
                    </td>
                  </tr>
                )}
                {input?.roomImageUrl && (
                  <tr>
                    <td className="px-3 py-2 font-mono text-slate-500">roomImage</td>
                    <td className="px-3 py-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={input.roomImageUrl} alt="" className="h-20 rounded bg-slate-100 object-contain" />
                    </td>
                  </tr>
                )}
                {result?.imageUrl && (
                  <tr>
                    <td className="px-3 py-2 font-mono text-slate-500">outputImage</td>
                    <td className="px-3 py-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={result.imageUrl} alt="" className="h-20 rounded bg-slate-100 object-contain" />
                    </td>
                  </tr>
                )}
                <tr>
                  <td className="px-3 py-2 align-top font-mono text-slate-500">floorPolygon</td>
                  <td className="px-3 py-2">
                    {input?.floorPolygon
                      ? <pre className="text-[10px] leading-4 text-slate-700">{JSON.stringify(input.floorPolygon, null, 2)}</pre>
                      : <WarnBadge label="missing" />}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Right column: dimensions + flags */}
        <div className="space-y-4">
          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Image Pipeline Dimensions</h3>
            {!snap ? (
              <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
                No snapshot yet — run a render to populate.
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
                      { label: "Original upload",   dim: orig,  drift: 0,          note: snap.resizedApplied ? "resize will apply" : "no resize" },
                      { label: "Gemini input",       dim: gin,   drift: ginVsOrig,  note: snap.resizedApplied ? "fit:inside resized" : "no resize" },
                      { label: "Raw Gemini output",  dim: rout,  drift: routVsGin,  note: snap.savedRaw ? "saved_raw" : "" },
                      { label: "Final saved output", dim: fout,  drift: foutVsRout, note: snap.outputImageUrl ? "→ storage" : "" },
                    ] as Array<{ label: string; dim: typeof orig; drift: number; note: string }>).map(({ label, dim, drift, note }) => (
                      <tr key={label}>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-700">{label}</td>
                        <td className="px-3 py-2 tabular-nums text-slate-800">{dim?.width ?? "—"}</td>
                        <td className="px-3 py-2 tabular-nums text-slate-800">{dim?.height ?? "—"}</td>
                        <td className="px-3 py-2 tabular-nums text-slate-600">
                          {dim ? aspectRatio(dim.width, dim.height) : "—"}
                          <DimBadge drift={drift} />
                        </td>
                        <td className="px-3 py-2 text-[10px] text-slate-400">{note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {snap && (
            <div>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Transform Flags</h3>
              <div className="space-y-1">
                <FlagRow label="resizedApplied"         value={snap.resizedApplied} />
                <FlagRow label="cropApplied"            value={snap.cropApplied} />
                <FlagRow label="paddingApplied"         value={snap.paddingApplied} />
                <FlagRow label="normalizedApplied"      value={snap.normalizedApplied} />
                <FlagRow label="fillApplied"            value={snap.fillApplied} />
                <FlagRow label="containApplied"         value={snap.containApplied} />
                <FlagRow label="coverApplied"           value={snap.coverApplied} />
                <FlagRow label="exifOrientationApplied" value={snap.exifOrientationApplied} />
                <FlagRow label="savedRaw"               value={snap.savedRaw} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Prompt viewer */}
      {snap?.promptText && (
        <details className="mt-2">
          <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100">
            <span>Prompt <span className="ml-1.5 font-normal text-slate-400">(version: {snap.promptVersion ?? "—"}, model: {snap.modelName ?? "—"})</span></span>
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
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Debug Artifacts</h3>
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
                  className="group flex flex-col items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2 text-[10px] text-slate-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                >
                  {isImage ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={url} alt={label} className="h-20 w-28 rounded border border-slate-200 bg-white object-contain" loading="lazy" />
                  ) : (
                    <div className="flex h-20 w-28 items-center justify-center rounded border border-slate-200 bg-white text-slate-400">
                      <span className="text-lg">📄</span>
                    </div>
                  )}
                  <span className="text-center font-mono leading-tight">{label}</span>
                </a>
              );
            })}
          </div>
        </div>
      )}

      {Object.keys(artifacts).length === 0 && snap && (
        <p className="rounded-lg border border-dashed border-slate-200 px-4 py-3 text-xs text-slate-500">
          No debug artifacts.
          Set <code className="rounded bg-slate-100 px-1 font-mono text-slate-700">ROOM_PREVIEW_DEBUG_RENDER_ARTIFACTS=true</code> and re-run a render to save stage images.
        </p>
      )}
    </div>
  );
}
