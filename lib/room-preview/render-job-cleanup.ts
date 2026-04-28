import "server-only";

import { Prisma } from "@/lib/generated/prisma";
import { getLogger } from "@/lib/logger";
import { openSessionIssue, trackSessionEvent } from "@/lib/room-preview/session-diagnostics";
import { prisma } from "@/lib/server/prisma";

export const RENDER_JOB_STUCK_FAILURE_REASON = "render_job_stuck_timeout";

const DEVELOPMENT_STUCK_AFTER_MS = 3 * 60 * 1000;
const PRODUCTION_STUCK_AFTER_MS = 7 * 60 * 1000;

const log = getLogger("render-job-cleanup");

export type MarkStuckRenderJobsResult = {
  cleanedJobs: number;
  resetSessions: number;
  thresholdMs: number;
  cutoff: string;
  jobIds: string[];
  sessionIds: string[];
};

export function getRenderJobStuckThresholdMs(): number {
  return process.env.NODE_ENV === "development"
    ? DEVELOPMENT_STUCK_AFTER_MS
    : PRODUCTION_STUCK_AFTER_MS;
}

export function isRenderJobStuck(
  job: { status: string; createdAt: Date | string; updatedAt: Date | string },
  now = new Date(),
  thresholdMs = getRenderJobStuckThresholdMs(),
): boolean {
  if (job.status !== "processing") {
    return false;
  }

  const updatedAt = typeof job.updatedAt === "string" ? new Date(job.updatedAt) : job.updatedAt;
  const createdAt = typeof job.createdAt === "string" ? new Date(job.createdAt) : job.createdAt;
  const cutoff = now.getTime() - thresholdMs;

  return updatedAt.getTime() <= cutoff || createdAt.getTime() <= cutoff;
}

export async function markStuckRenderJobsAsFailed(
  thresholdMs = getRenderJobStuckThresholdMs(),
): Promise<MarkStuckRenderJobsResult> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - thresholdMs);

  const stuckJobs = await prisma.renderJob.findMany({
    where: {
      status: "processing",
      OR: [
        { updatedAt: { lte: cutoff } },
        { createdAt: { lte: cutoff } },
      ],
    },
    select: {
      id: true,
      sessionId: true,
      createdAt: true,
      updatedAt: true,
      session: {
        select: {
          status: true,
        },
      },
    },
  });

  if (stuckJobs.length === 0) {
    return {
      cleanedJobs: 0,
      resetSessions: 0,
      thresholdMs,
      cutoff: cutoff.toISOString(),
      jobIds: [],
      sessionIds: [],
    };
  }

  const jobIds = stuckJobs.map((job) => job.id);
  const sessionIds = [...new Set(stuckJobs.map((job) => job.sessionId))];
  const stuckJobIds = new Set(jobIds);
  const latestJobs = await prisma.renderJob.findMany({
    where: { sessionId: { in: sessionIds } },
    orderBy: [{ sessionId: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      sessionId: true,
    },
  });
  const latestJobBySession = new Map<string, string>();
  for (const job of latestJobs) {
    if (!latestJobBySession.has(job.sessionId)) {
      latestJobBySession.set(job.sessionId, job.id);
    }
  }

  const sessionsToFail = [
    ...new Set(
      stuckJobs
        .filter((job) =>
          job.session.status === "rendering" &&
          latestJobBySession.get(job.sessionId) === job.id &&
          stuckJobIds.has(job.id),
        )
        .map((job) => job.sessionId),
    ),
  ];

  const resultMetadata = {
    failureReason: RENDER_JOB_STUCK_FAILURE_REASON,
    failedAt: now.toISOString(),
    previousStatus: "processing",
    stuckThresholdMs: thresholdMs,
  } satisfies Prisma.InputJsonObject;

  const [jobUpdateResult, sessionUpdateResult] = await prisma.$transaction([
    prisma.renderJob.updateMany({
      where: {
        id: { in: jobIds },
        status: "processing",
      },
      data: {
        status: "failed",
        failureReason: RENDER_JOB_STUCK_FAILURE_REASON,
        result: resultMetadata,
      },
    }),
    prisma.roomPreviewSession.updateMany({
      where: {
        id: { in: sessionsToFail },
        status: "rendering",
      },
      data: { status: "failed" },
    }),
  ]);

  await Promise.all(
    sessionsToFail.map(async (sessionId) => {
      await openSessionIssue({
        sessionId,
        type: "RENDER_TIMEOUT",
        metadata: {
          reason: RENDER_JOB_STUCK_FAILURE_REASON,
          thresholdMs,
          renderJobIds: stuckJobs
            .filter((job) => job.sessionId === sessionId)
            .map((job) => job.id),
        },
      });
      await trackSessionEvent({
        sessionId,
        source: "server",
        eventType: "render_timeout",
        level: "error",
        statusBefore: "rendering",
        statusAfter: "failed",
        code: "RENDER_TIMEOUT",
        metadata: {
          reason: RENDER_JOB_STUCK_FAILURE_REASON,
          thresholdMs,
        },
      });
    }),
  );

  if (jobUpdateResult.count > 0) {
    log.warn(
      {
        cleanedJobs: jobUpdateResult.count,
        resetSessions: sessionUpdateResult.count,
        thresholdMs,
        cutoff: cutoff.toISOString(),
      },
      "Marked stuck render jobs as failed",
    );
  }

  return {
    cleanedJobs: jobUpdateResult.count,
    resetSessions: sessionUpdateResult.count,
    thresholdMs,
    cutoff: cutoff.toISOString(),
    jobIds,
    sessionIds: sessionsToFail,
  };
}
