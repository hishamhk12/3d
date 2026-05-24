import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { ADMIN_SESSION_COOKIE, verifyAdminToken } from "@/lib/admin/auth";

export const dynamic = "force-dynamic";

async function requireAdminResponse(): Promise<NextResponse | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  if (!token || !(await verifyAdminToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export type RenderSpeedLabel = "fast" | "warning" | "slow" | "failed" | "pending";

export type RenderPerformanceEntry = {
  renderJobId: string;
  sessionIdShort: string;
  status: string;
  failureReason: string | null;
  startedAt: string;
  completedAt: string | null;
  // Macro timings (from render_timing_summary event or job timestamps)
  totalMs: number | null;
  setupMs: number | null;      // slot claim → provider start
  providerMs: number | null;   // entire provider call (all images + Gemini + upload)
  saveMs: number | null;       // job/session persist after provider returns
  // Micro timings (from render_diagnostics_snapshot event, inside provider)
  imageLoadMs: number | null;
  geminiMs: number | null;
  uploadMs: number | null;
  attempt: number | null;
  modelName: string | null;
  speedLabel: RenderSpeedLabel;
};

export type RenderPerformanceResponse = {
  jobs: RenderPerformanceEntry[];
  fetchedAt: string;
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function getNum(obj: unknown, key: string): number | null {
  if (!obj || typeof obj !== "object") return null;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "number" ? v : null;
}

function getStr(obj: unknown, key: string): string | null {
  if (!obj || typeof obj !== "object") return null;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "string" ? v : null;
}

function getNestedNum(obj: unknown, parent: string, key: string): number | null {
  if (!obj || typeof obj !== "object") return null;
  return getNum((obj as Record<string, unknown>)[parent], key);
}

function getNestedStr(obj: unknown, parent: string, key: string): string | null {
  if (!obj || typeof obj !== "object") return null;
  return getStr((obj as Record<string, unknown>)[parent], key);
}

function speedLabel(status: string, totalMs: number | null): RenderSpeedLabel {
  if (status === "failed") return "failed";
  if (status === "pending" || status === "processing") return "pending";
  if (totalMs === null) return "pending";
  if (totalMs < 30_000) return "fast";
  if (totalMs < 60_000) return "warning";
  return "slow";
}

// ─── Route ─────────────────────────────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  const denied = await requireAdminResponse();
  if (denied) return denied;

  // Fetch the 20 most recent render jobs
  const rawJobs = await prisma.renderJob.findMany({
    take: 20,
    orderBy: { createdAt: "desc" },
    select: {
      id:            true,
      sessionId:     true,
      status:        true,
      failureReason: true,
      createdAt:     true,
      updatedAt:     true,
    },
  });

  if (rawJobs.length === 0) {
    const body: RenderPerformanceResponse = { jobs: [], fetchedAt: new Date().toISOString() };
    return NextResponse.json(body);
  }

  const sessionIds = [...new Set(rawJobs.map((j) => j.sessionId))];

  // Pull timing events for these sessions in one query
  const timingEvents = await prisma.sessionEvent.findMany({
    where: {
      sessionId: { in: sessionIds },
      eventType: { in: ["render_timing_summary", "render_diagnostics_snapshot"] },
    },
    select: {
      sessionId: true,
      eventType: true,
      metadata:  true,
      timestamp: true,
    },
    orderBy: { timestamp: "desc" },
  });

  // Index by renderJobId for O(1) lookup
  const summaryByJobId   = new Map<string, typeof timingEvents[number]>();
  const snapshotByJobId  = new Map<string, typeof timingEvents[number]>();

  for (const evt of timingEvents) {
    const jobId = getStr(evt.metadata, "renderJobId");
    if (!jobId) continue;
    if (evt.eventType === "render_timing_summary" && !summaryByJobId.has(jobId)) {
      summaryByJobId.set(jobId, evt);
    }
    if (evt.eventType === "render_diagnostics_snapshot" && !snapshotByJobId.has(jobId)) {
      snapshotByJobId.set(jobId, evt);
    }
  }

  const jobs: RenderPerformanceEntry[] = rawJobs.map((job) => {
    const summary  = summaryByJobId.get(job.id);
    const snapshot = snapshotByJobId.get(job.id);

    // Macro timings — prefer the summary event, fall back to job timestamps
    const fallbackTotalMs =
      job.status === "completed" || job.status === "failed"
        ? job.updatedAt.getTime() - job.createdAt.getTime()
        : null;

    const totalMs    = getNum(summary?.metadata, "totalMs")    ?? fallbackTotalMs;
    const setupMs    = getNum(summary?.metadata, "setupMs");
    const providerMs = getNum(summary?.metadata, "providerMs");
    const saveMs     = getNum(summary?.metadata, "saveMs");

    // Micro timings from diagnostics snapshot
    const imageLoadMs = getNestedNum(snapshot?.metadata, "timings", "imageLoadMs");
    const geminiMs    = getNestedNum(snapshot?.metadata, "timings", "geminiMs");
    const uploadMs    = getNestedNum(snapshot?.metadata, "timings", "uploadMs");
    const attempt     = getNestedNum(snapshot?.metadata, "timings", "attempt");
    const modelName   = getNestedStr(snapshot?.metadata, "timings", "modelName");

    const isTerminal = job.status === "completed" || job.status === "failed";

    return {
      renderJobId:    job.id,
      sessionIdShort: job.sessionId.slice(0, 8),
      status:         job.status,
      failureReason:  job.failureReason ?? null,
      startedAt:      job.createdAt.toISOString(),
      completedAt:    isTerminal ? job.updatedAt.toISOString() : null,
      totalMs,
      setupMs,
      providerMs,
      saveMs,
      imageLoadMs,
      geminiMs,
      uploadMs,
      attempt,
      modelName,
      speedLabel:     speedLabel(job.status, totalMs),
    };
  });

  const body: RenderPerformanceResponse = { jobs, fetchedAt: new Date().toISOString() };
  return NextResponse.json(body);
}
