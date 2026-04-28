"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { Prisma } from "@/lib/generated/prisma";
import { prisma } from "@/lib/server/prisma";
import { ADMIN_SESSION_COOKIE, verifyAdminToken } from "@/lib/admin/auth";
import { SESSION_EXPIRY_MINUTES } from "@/lib/room-preview/constants";
import {
  expireOldSessions,
  expireIdleWaitingSessions,
  failStuckRenderingSessions,
  completeResultReadySessions,
} from "@/lib/room-preview/session-cleanup";
import {
  markStuckRenderJobsAsFailed,
  type MarkStuckRenderJobsResult,
} from "@/lib/room-preview/render-job-cleanup";
import { trackSessionEvent } from "@/lib/room-preview/session-diagnostics";
import { detectStuckSessions } from "@/lib/room-preview/stuck-detection";

async function requireAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  if (!token || !(await verifyAdminToken(token))) {
    throw new Error("Unauthorized");
  }
}

export async function forceExpireSession(sessionId: string) {
  await requireAdmin();
  await prisma.roomPreviewSession.update({
    where: { id: sessionId },
    data: { status: "expired" },
  });
  await trackSessionEvent({
    sessionId,
    source: "admin",
    eventType: "session_expired",
    level: "warning",
    statusAfter: "expired",
    metadata: { forced: true },
  });
  revalidatePath("/admin");
}

export type CleanupResult = {
  expired: number;
  idleExpired: number;
  stuckFailed: number;
  stuckRenderJobsFailed: number;
  completed: number;
  detectedIssues: number;
  ranAt: string;
};

export async function triggerCleanup(
  _prevState: CleanupResult | null,
  _formData: FormData,
): Promise<CleanupResult> {
  void _prevState;
  void _formData;
  await requireAdmin();

  const detectedIssues = await detectStuckSessions();
  const stuckRenderJobs = await markStuckRenderJobsAsFailed();
  const [stuckFailed, completed, idleExpired, expired] = await Promise.all([
    failStuckRenderingSessions(),
    completeResultReadySessions(),
    expireIdleWaitingSessions(),
    expireOldSessions(),
  ]);

  revalidatePath("/admin");

  return {
    expired,
    idleExpired,
    stuckFailed,
    stuckRenderJobsFailed: stuckRenderJobs.cleanedJobs,
    completed,
    detectedIssues,
    ranAt: new Date().toISOString(),
  };
}

export type MarkStuckRenderJobsActionResult =
  | (MarkStuckRenderJobsResult & { ranAt: string })
  | null;

export async function markStuckRenderJobsAsFailedAction(
  _prevState: MarkStuckRenderJobsActionResult,
  _formData: FormData,
): Promise<MarkStuckRenderJobsActionResult> {
  void _prevState;
  void _formData;
  await requireAdmin();

  const result = await markStuckRenderJobsAsFailed();

  revalidatePath("/admin");

  return { ...result, ranAt: new Date().toISOString() };
}

export async function forceResetSession(sessionId: string) {
  await requireAdmin();
  const expiresAt = new Date(Date.now() + SESSION_EXPIRY_MINUTES * 60 * 1000);

  await prisma.roomPreviewSession.update({
    where: { id: sessionId },
    data: {
      status: "waiting_for_mobile",
      mobileConnected: false,
      selectedRoom: Prisma.JsonNull,
      selectedProduct: Prisma.JsonNull,
      renderResult: Prisma.JsonNull,
      expiresAt,
    },
  });
  await trackSessionEvent({
    sessionId,
    source: "admin",
    eventType: "session_reset",
    level: "warning",
    statusAfter: "waiting_for_mobile",
  });
  revalidatePath("/admin");
}
