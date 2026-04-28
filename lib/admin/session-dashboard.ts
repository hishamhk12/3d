import "server-only";

import { prisma } from "@/lib/server/prisma";
import {
  LIVE_STATUSES,
  SUCCESS_STATUSES,
  STATUS_GROUP,
  isEffectivelyExpired,
  type SessionStatusGroup,
} from "@/lib/room-preview/session-status";
import type { RoomPreviewSessionStatus } from "@/lib/room-preview/types";
import {
  getRenderJobStuckThresholdMs,
  isRenderJobStuck,
  markStuckRenderJobsAsFailed,
} from "@/lib/room-preview/render-job-cleanup";

export type { SessionStatusGroup } from "@/lib/room-preview/session-status";

// ─── Metrics ──────────────────────────────────────────────────────────────────

export async function getDashboardMetrics() {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  // Live = status in LIVE_STATUSES AND expiresAt exists AND is still in the future.
  // Null expiresAt (legacy orphan) is intentionally excluded — those sessions are dead.
  const liveFilter = { expiresAt: { gt: now } };

  const [
    liveCount,
    waitingCount,
    renderingCount,
    successToday,
    failedJobsLastHour,
    completedJobsToday,
  ] = await Promise.all([
    prisma.roomPreviewSession.count({
      where: { status: { in: [...LIVE_STATUSES] }, ...liveFilter },
    }),
    prisma.roomPreviewSession.count({
      where: { status: "waiting_for_mobile", ...liveFilter },
    }),
    prisma.roomPreviewSession.count({
      where: { status: "rendering" },
    }),
    prisma.roomPreviewSession.count({
      where: {
        status: { in: [...SUCCESS_STATUSES] },
        updatedAt: { gte: startOfToday },
      },
    }),
    prisma.renderJob.count({
      where: { status: "failed", createdAt: { gte: oneHourAgo } },
    }),
    prisma.renderJob.findMany({
      where: { status: "completed", createdAt: { gte: startOfToday } },
      select: { createdAt: true, updatedAt: true },
    }),
  ]);

  const avgRenderMs =
    completedJobsToday.length > 0
      ? completedJobsToday.reduce(
          (sum, job) => sum + (job.updatedAt.getTime() - job.createdAt.getTime()),
          0,
        ) / completedJobsToday.length
      : null;

  return {
    liveCount,
    waitingCount,
    renderingCount,
    successToday,
    failedJobsLastHour,
    rendersToday: completedJobsToday.length,
    avgRenderSeconds: avgRenderMs !== null ? Math.round(avgRenderMs / 1000) : null,
  };
}

// ─── Session list ─────────────────────────────────────────────────────────────

export type DashboardSession = {
  id: string;
  status: string;
  group: SessionStatusGroup;
  effectivelyExpired: boolean;
  mobileConnected: boolean;
  renderCount: number;
  selectedProduct: unknown;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  renderJobCount: number;
};

export async function getDashboardSessions(): Promise<DashboardSession[]> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - 4 * 60 * 60 * 1000);

  const rows = await prisma.roomPreviewSession.findMany({
    where: {
      OR: [
        // Live-status sessions regardless of age — cleanup may not have run yet.
        // effectivelyExpired flag + group reclassification handle the display.
        { status: { in: [...LIVE_STATUSES] } },
        // Recent terminal sessions for history
        { updatedAt: { gte: cutoff } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      status: true,
      mobileConnected: true,
      renderCount: true,
      selectedProduct: true,
      createdAt: true,
      updatedAt: true,
      expiresAt: true,
      _count: { select: { renderJobs: true } },
    },
  });

  return rows.map((r) => {
    const expiresAtIso = r.expiresAt?.toISOString() ?? null;
    const effectivelyExpired = isEffectivelyExpired({ status: r.status, expiresAt: expiresAtIso });
    const rawGroup = STATUS_GROUP[r.status as RoomPreviewSessionStatus] ?? "closed";
    // Reclassify effectively-expired live sessions to "closed" so they appear
    // in the Expired tab and never pollute the Live tab.
    const group: SessionStatusGroup = effectivelyExpired && rawGroup === "live" ? "closed" : rawGroup;

    return {
      id: r.id,
      status: r.status,
      group,
      effectivelyExpired,
      mobileConnected: r.mobileConnected,
      renderCount: r.renderCount,
      selectedProduct: r.selectedProduct,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      expiresAt: expiresAtIso,
      renderJobCount: r._count.renderJobs,
    };
  });
}

// ─── Render jobs ──────────────────────────────────────────────────────────────

export type AdminRenderJob = {
  id: string;
  sessionId: string;
  status: string;
  isStuck: boolean;
  stuckThresholdMs: number;
  input: unknown;
  result: unknown;
  failureReason: string | null;
  durationMs: number;
  createdAt: string;
  updatedAt: string;
};

export async function getAdminRenderJobs(): Promise<AdminRenderJob[]> {
  await markStuckRenderJobsAsFailed();

  const now = new Date();
  const stuckThresholdMs = getRenderJobStuckThresholdMs();
  const rows = await prisma.renderJob.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      sessionId: true,
      status: true,
      input: true,
      result: true,
      failureReason: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return rows.map((r) => {
    const isStuck = isRenderJobStuck(r, now, stuckThresholdMs);

    return {
      ...r,
      isStuck,
      stuckThresholdMs,
      durationMs: r.updatedAt.getTime() - r.createdAt.getTime(),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  });
}
