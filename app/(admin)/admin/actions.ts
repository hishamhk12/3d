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
  revalidatePath("/admin");
}

export type CleanupResult = {
  expired: number;
  idleExpired: number;
  stuckFailed: number;
  completed: number;
  ranAt: string;
};

export async function triggerCleanup(
  _prevState: CleanupResult | null,
  _formData: FormData,
): Promise<CleanupResult> {
  await requireAdmin();

  const [stuckFailed, completed, idleExpired, expired] = await Promise.all([
    failStuckRenderingSessions(),
    completeResultReadySessions(),
    expireIdleWaitingSessions(),
    expireOldSessions(),
  ]);

  revalidatePath("/admin");

  return { expired, idleExpired, stuckFailed, completed, ranAt: new Date().toISOString() };
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
  revalidatePath("/admin");
}
