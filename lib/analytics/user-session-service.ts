import "server-only";

import { prisma } from "@/lib/server/prisma";
import type { GateFormInput } from "@/lib/analytics/validators";

/**
 * Returns true if the given RoomPreviewSession has already been linked
 * to a UserSession (i.e. the visitor completed the gate).
 */
export async function sessionHasCompletedGate(sessionId: string): Promise<boolean> {
  const row = await prisma.roomPreviewSession.findUnique({
    where: { id: sessionId },
    select: { userSessionId: true },
  });
  // Row null = session does not exist, treat as gate not completed.
  return row?.userSessionId != null;
}

/**
 * Create a UserSession from validated gate form data, then link it to the
 * given RoomPreviewSession.
 *
 * Returns the new UserSession id.
 */
export async function createAndBindUserSession(
  sessionId: string,
  data: GateFormInput,
  ip: string | null,
): Promise<string> {
  const created = await prisma.userSession.create({
    data: {
      name: data.name,
      role: data.role,
      phone: data.role === "customer" ? data.phone : null,
      employeeCode: data.role === "employee" ? data.employeeCode : null,
      ip,
    },
  });

  try {
    await prisma.roomPreviewSession.update({
      where: { id: sessionId },
      data: { userSessionId: created.id },
    });
  } catch (error) {
    await prisma.userSession.delete({ where: { id: created.id } }).catch(() => undefined);
    throw error;
  }

  return created.id;
}
