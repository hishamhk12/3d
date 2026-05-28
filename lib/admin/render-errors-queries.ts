import "server-only";

import { prisma } from "@/lib/server/prisma";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function safeDate(value: string | undefined, endOfDay = false): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return undefined;
  if (endOfDay) parsed.setHours(23, 59, 59, 999);
  return parsed;
}

function numFrom(m: Record<string, unknown> | null, key: string): number | null {
  const v = m?.[key];
  return typeof v === "number" ? v : null;
}

function strFrom(m: Record<string, unknown> | null, key: string): string | null {
  const v = m?.[key];
  return typeof v === "string" ? v : null;
}

function boolFrom(m: Record<string, unknown> | null, key: string): boolean | null {
  const v = m?.[key];
  return typeof v === "boolean" ? v : null;
}

function dimFrom(m: Record<string, unknown> | null, key: string): { width: number; height: number } | null {
  const v = m?.[key];
  if (!isRecord(v)) return null;
  const w = v["width"];
  const h = v["height"];
  return typeof w === "number" && typeof h === "number" ? { width: w, height: h } : null;
}

function extractProductName(input: unknown): string | null {
  if (!isRecord(input)) return null;
  const p = input["product"];
  if (!isRecord(p)) return null;
  return typeof p["name"] === "string" ? p["name"] : null;
}

function extractFloorPolygon(input: unknown): boolean {
  if (!isRecord(input)) return false;
  const r = input["room"];
  if (!isRecord(r)) return false;
  return r["floorQuad"] != null;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type RenderErrorFilters = {
  dateFrom?: string;
  dateTo?: string;
  failureReason?: string;
  branch?: string;
  productSearch?: string;
  sessionSearch?: string;
  jobSearch?: string;
};

export type AttemptRow = {
  attempt: number;
  modelName: string | null;
  durationMs: number;
  status: string;
  attemptTimeoutMs: number | null;
  abortedByTimeout: boolean;
};

export type RenderErrorRecord = {
  jobId: string;
  sessionId: string;
  failureReason: string | null;
  errorMessage: string | null;
  errorCode: string | null;
  createdAt: string;
  totalMs: number;
  // input
  productName: string | null;
  floorPolygonProvided: boolean;
  promptOnly: boolean;
  inputWidth: number | null;
  inputHeight: number | null;
  // branch / parallel
  branch: string | null;
  parallelEnabled: boolean | null;
  rawEnableParallel: string | null;
  // timing
  geminiMs: number | null;
  imageLoadMs: number | null;
  firstAttemptTimeoutMs: number | null;
  totalProviderMs: number | null;
  // attempts
  attemptsCount: number | null;
  winnerAttemptId: string | null;
  allTimedOut: boolean;
  allFailed: boolean;
  attemptRows: AttemptRow[];
  // model / prompt
  modelName: string | null;
  promptVersion: string | null;
  qualityMode: string | null;
  // diagnostics
  hasSnapshot: boolean;
  recommendedAction: string;
  // raw metadata for expandable panel
  rawTimingSummary: Record<string, unknown> | null;
  rawBranchResolved: Record<string, unknown> | null;
  rawSnapshot: Record<string, unknown> | null;
};

export type RenderErrorSummary = {
  totalErrors: number;
  geminiTimeouts: number;
  parallelFailures: number;
  promptOnlyFailures: number;
  missingSnapshots: number;
  avgFailedMs: number;
  mostCommonReason: string;
  reasonCounts: Record<string, number>;
};

export type ReasonGroupCount = {
  key: string;
  label: string;
  labelAr: string;
  count: number;
  pct: number;
  color: string;
};

// ─── Reason-group definitions ─────────────────────────────────────────────────

const KNOWN_FAILURE_REASONS = new Set([
  "gemini_timeout",
  "output_validation_failed",
  "storage_upload_failed",
  "material_unclear",
  "floor_not_visible",
]);

type GroupDef = {
  key: string;
  label: string;
  labelAr: string;
  color: string;
  match(r: RenderErrorRecord): boolean;
};

const REASON_GROUP_DEFS: GroupDef[] = [
  {
    key: "both_parallel_timed_out",
    label: "Both Parallel Timed Out",
    labelAr: "كلتا المحاولتان انتهت مهلتهما",
    color: "orange",
    match: (r) =>
      r.branch === "parallel" &&
      r.allTimedOut &&
      r.winnerAttemptId === null,
  },
  {
    key: "gemini_timeout",
    label: "Gemini Timeout",
    labelAr: "انتهت مهلة Gemini",
    color: "amber",
    match: (r) =>
      r.failureReason === "gemini_timeout" ||
      (r.errorMessage?.toLowerCase().includes("timed out") ?? false),
  },
  {
    key: "prompt_only_mode",
    label: "Prompt-Only Mode",
    labelAr: "وضع النص فقط",
    color: "purple",
    match: (r) => r.promptOnly,
  },
  {
    key: "floor_polygon_missing",
    label: "Floor Polygon Missing",
    labelAr: "مضلع الأرضية مفقود",
    color: "violet",
    match: (r) => !r.floorPolygonProvided,
  },
  {
    key: "missing_snapshot",
    label: "Missing Snapshot",
    labelAr: "لقطة التشخيص مفقودة",
    color: "slate",
    match: (r) => !r.hasSnapshot,
  },
  {
    key: "output_validation_failed",
    label: "Output Validation Failed",
    labelAr: "فشل التحقق من المخرجات",
    color: "orange",
    match: (r) =>
      r.failureReason === "output_validation_failed" ||
      (r.errorMessage?.toLowerCase().includes("validation") ?? false) ||
      (r.errorMessage?.toLowerCase().includes("dimension") ?? false),
  },
  {
    key: "storage_upload_failed",
    label: "Storage Upload Failed",
    labelAr: "فشل رفع الملف",
    color: "red",
    match: (r) =>
      r.failureReason === "storage_upload_failed" ||
      (r.errorMessage?.toLowerCase().includes("upload") ?? false),
  },
  {
    key: "material_unclear",
    label: "Material Unclear",
    labelAr: "المادة غير واضحة",
    color: "blue",
    match: (r) => r.failureReason === "material_unclear",
  },
  {
    key: "floor_not_visible",
    label: "Floor Not Visible",
    labelAr: "الأرضية غير مرئية",
    color: "teal",
    match: (r) => r.failureReason === "floor_not_visible",
  },
  {
    key: "unknown",
    label: "Unknown",
    labelAr: "سبب غير معروف",
    color: "slate",
    match: (r) =>
      (r.failureReason === null || !KNOWN_FAILURE_REASONS.has(r.failureReason)) &&
      !(r.promptOnly) &&
      r.floorPolygonProvided &&
      !(r.allTimedOut),
  },
];

export function computeReasonGroups(records: RenderErrorRecord[]): ReasonGroupCount[] {
  const total = records.length;
  return REASON_GROUP_DEFS.map((def) => {
    const count = records.filter(def.match).length;
    return {
      key: def.key,
      label: def.label,
      labelAr: def.labelAr,
      color: def.color,
      count,
      pct: total > 0 ? Math.round((count / total) * 100) : 0,
    };
  }).filter((g) => g.count > 0);
}

export function filterByReasonGroup(
  records: RenderErrorRecord[],
  key: string,
): RenderErrorRecord[] {
  const def = REASON_GROUP_DEFS.find((d) => d.key === key);
  if (!def) return records;
  return records.filter(def.match);
}

// ─── Recommended action ───────────────────────────────────────────────────────

function getRecommendedAction(rec: {
  branch: string | null;
  allTimedOut: boolean;
  failureReason: string | null;
  floorPolygonProvided: boolean;
  promptOnly: boolean;
}): string {
  if (rec.branch === "parallel" && rec.allTimedOut) {
    return "المحاولتان فشلتا. راجع prompt-only mode أو أضف floor polygon.";
  }
  if (rec.failureReason === "gemini_timeout") {
    return "تحقق من زمن استجابة Gemini. جرّب retry أو Auto Floor Detection.";
  }
  if (rec.promptOnly || !rec.floorPolygonProvided) {
    return "أضف Auto Floor Detection لتحديد الأرضية قبل الرندر.";
  }
  if (rec.failureReason === "storage_upload_failed") {
    return "راجع R2/S3 credentials, CORS, bucket permissions.";
  }
  if (rec.failureReason === "output_validation_failed") {
    return "راجع أبعاد الصورة الناتجة ونسبة العرض/الارتفاع.";
  }
  if (rec.failureReason === "material_unclear") {
    return "راجع صورة المنتج أو product prompt.";
  }
  if (rec.failureReason === "floor_not_visible") {
    return "الأرضية غير واضحة للنموذج. استخدم floor detection أو fallback UI.";
  }
  return "راجع raw render logs.";
}

// ─── Main query ───────────────────────────────────────────────────────────────

export async function getRenderErrors(
  filters: RenderErrorFilters = {},
): Promise<RenderErrorRecord[]> {
  const dateFrom =
    safeDate(filters.dateFrom) ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const dateTo = safeDate(filters.dateTo, true);

  const jobs = await prisma.renderJob.findMany({
    where: {
      status: "failed",
      createdAt: { gte: dateFrom, ...(dateTo ? { lte: dateTo } : {}) },
      ...(filters.failureReason ? { failureReason: filters.failureReason } : {}),
      ...(filters.jobSearch ? { id: { contains: filters.jobSearch } } : {}),
      ...(filters.sessionSearch ? { sessionId: { contains: filters.sessionSearch } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      sessionId: true,
      failureReason: true,
      input: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (jobs.length === 0) return [];

  const sessionIds = [...new Set(jobs.map((j) => j.sessionId))];

  const events = await prisma.sessionEvent.findMany({
    where: {
      sessionId: { in: sessionIds },
      eventType: {
        in: [
          "render_failed",
          "render_timing_summary",
          "render_branch_resolved",
          "render_diagnostics_snapshot",
          "floor_polygon_missing_prompt_only_mode",
        ],
      },
    },
    orderBy: { timestamp: "desc" },
    take: 5000,
    select: {
      sessionId: true,
      eventType: true,
      metadata: true,
      message: true,
      code: true,
    },
  });

  type EvRow = (typeof events)[number];

  const bySession = new Map<string, EvRow[]>();
  for (const e of events) {
    const list = bySession.get(e.sessionId) ?? [];
    list.push(e);
    bySession.set(e.sessionId, list);
  }

  const promptOnlySessions = new Set(
    events
      .filter((e) => e.eventType === "floor_polygon_missing_prompt_only_mode")
      .map((e) => e.sessionId),
  );

  const getRenderJobId = (m: unknown): string | null => {
    if (!isRecord(m)) return null;
    return typeof m["renderJobId"] === "string" ? m["renderJobId"] : null;
  };

  const records: RenderErrorRecord[] = [];

  for (const job of jobs) {
    const sessionEvents = bySession.get(job.sessionId) ?? [];

    const findEvt = (type: string): EvRow | undefined =>
      sessionEvents.find(
        (e) => e.eventType === type && getRenderJobId(e.metadata) === job.id,
      ) ?? sessionEvents.find((e) => e.eventType === type);

    const timingEvt = findEvt("render_timing_summary");
    const branchEvt = findEvt("render_branch_resolved");
    const snapEvt   = findEvt("render_diagnostics_snapshot");
    const failedEvt = findEvt("render_failed");

    const timing = isRecord(timingEvt?.metadata) ? timingEvt!.metadata : null;
    const branch = isRecord(branchEvt?.metadata) ? branchEvt!.metadata : null;
    const snap   = isRecord(snapEvt?.metadata)   ? snapEvt!.metadata   : null;

    const productName        = extractProductName(job.input);
    const floorPolygonProvided = extractFloorPolygon(job.input);
    const promptOnly         = promptOnlySessions.has(job.sessionId);
    const totalMs            = Math.max(0, job.updatedAt.getTime() - job.createdAt.getTime());

    // Normalize attempt rows
    const rawTimings = Array.isArray(timing?.["attemptTimings"])
      ? (timing!["attemptTimings"] as unknown[])
      : [];
    const attemptRows: AttemptRow[] = rawTimings.flatMap((t) => {
      if (!isRecord(t)) return [];
      return [{
        attempt: typeof t["attempt"] === "number" ? t["attempt"] : 0,
        modelName: typeof t["modelName"] === "string" ? t["modelName"] : null,
        durationMs: typeof t["durationMs"] === "number" ? t["durationMs"] : 0,
        status: typeof t["status"] === "string" ? t["status"] : "unknown",
        attemptTimeoutMs: typeof t["attemptTimeoutMs"] === "number" ? t["attemptTimeoutMs"] : null,
        abortedByTimeout: t["abortedByTimeout"] === true,
      }];
    });

    // Branch determination
    const resolvedBranch =
      strFrom(branch, "branch") ?? strFrom(timing, "mode");

    const allTimedOut =
      timing?.["allTimedOut"] === true ||
      (attemptRows.length > 0 &&
        attemptRows.every((r) => r.status === "timed_out" || r.abortedByTimeout));

    // winnerAttemptId: can be null (on failure) or a string (on success)
    let winnerAttemptId: string | null = null;
    if (timing && "winnerAttemptId" in timing) {
      const w = timing["winnerAttemptId"];
      winnerAttemptId = typeof w === "string" ? w : null;
    }

    const inputDim = dimFrom(timing, "inputDimensions");

    const rec: RenderErrorRecord = {
      jobId: job.id,
      sessionId: job.sessionId,
      failureReason: job.failureReason,
      errorMessage: failedEvt?.message ?? null,
      errorCode: failedEvt?.code ?? null,
      createdAt: job.createdAt.toISOString(),
      totalMs,

      productName,
      floorPolygonProvided,
      promptOnly,
      inputWidth:  inputDim?.width  ?? null,
      inputHeight: inputDim?.height ?? null,

      branch: resolvedBranch,
      parallelEnabled:  boolFrom(branch, "parallelGeminiEnabled"),
      rawEnableParallel: strFrom(branch, "raw_ROOM_PREVIEW_ENABLE_PARALLEL_GEMINI_ATTEMPTS"),

      geminiMs:             numFrom(timing, "geminiMs"),
      imageLoadMs:          numFrom(timing, "imageLoadMs"),
      firstAttemptTimeoutMs: numFrom(timing, "firstAttemptTimeoutMs"),
      totalProviderMs:      numFrom(timing, "totalProviderMs"),

      attemptsCount:  numFrom(timing, "attemptCount"),
      winnerAttemptId,
      allTimedOut,
      allFailed: timing?.["allFailed"] === true,
      attemptRows,

      modelName:
        strFrom(timing, "modelName") ?? strFrom(snap, "modelName"),
      promptVersion: strFrom(timing, "promptVersion"),
      qualityMode:   strFrom(timing, "qualityMode"),

      hasSnapshot: !!snapEvt,

      recommendedAction: getRecommendedAction({
        branch: resolvedBranch,
        allTimedOut,
        failureReason: job.failureReason,
        floorPolygonProvided,
        promptOnly,
      }),

      rawTimingSummary:  timing,
      rawBranchResolved: branch,
      rawSnapshot:       snap,
    };

    // In-memory filters (fields not queryable at DB level)
    if (filters.branch && rec.branch !== filters.branch) continue;
    if (
      filters.productSearch &&
      !rec.productName?.toLowerCase().includes(filters.productSearch.toLowerCase())
    ) continue;

    records.push(rec);
  }

  return records;
}

// ─── Summary (derived from fetched records) ───────────────────────────────────

export function computeRenderErrorSummary(records: RenderErrorRecord[]): RenderErrorSummary {
  const reasonCounts: Record<string, number> = {};
  let geminiTimeouts   = 0;
  let parallelFailures = 0;
  let promptOnlyFailures = 0;
  let missingSnapshots = 0;
  let totalMs = 0;

  for (const r of records) {
    const reason = r.failureReason ?? "unknown";
    reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
    if (r.failureReason === "gemini_timeout") geminiTimeouts++;
    if (r.branch === "parallel" && r.allFailed) parallelFailures++;
    if (r.promptOnly) promptOnlyFailures++;
    if (!r.hasSnapshot) missingSnapshots++;
    totalMs += r.totalMs;
  }

  const sorted = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]);
  const mostCommonReason = sorted[0]?.[0] ?? "—";
  const avgFailedMs = records.length > 0 ? Math.round(totalMs / records.length) : 0;

  return {
    totalErrors: records.length,
    geminiTimeouts,
    parallelFailures,
    promptOnlyFailures,
    missingSnapshots,
    avgFailedMs,
    mostCommonReason,
    reasonCounts,
  };
}
