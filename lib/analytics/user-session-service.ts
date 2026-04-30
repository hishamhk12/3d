import "server-only";

import { prisma } from "@/lib/server/prisma";

/**
 * Returns true if the given RoomPreviewSession has already been linked
 * to a UserSession (i.e. the visitor completed the gate).
 */
export async function sessionHasCompletedGate(sessionId: string): Promise<boolean> {
  const row = await prisma.roomPreviewSession.findUnique({
    where: { id: sessionId },
    select: { userSessionId: true },
  });
  return row?.userSessionId != null;
}

export type BindUserSessionData = {
  name: string;
  role: "customer" | "employee";
  phone?: string | null;
  countryCode?: string | null;
  dialCode?: string | null;
  employeeCode?: string | null;
};

/**
 * Create a UserSession from gate data, then link it to the RoomPreviewSession.
 * Optionally binds a Customer record via customerId.
 * Returns the new UserSession id.
 */
export async function createAndBindUserSession(
  sessionId: string,
  data: BindUserSessionData,
  ip: string | null,
  customerId?: string | null,
): Promise<string> {
  const created = await prisma.userSession.create({
    data: {
      name: data.name,
      role: data.role,
      phone: data.phone ?? null,
      countryCode: data.countryCode ?? null,
      dialCode: data.dialCode ?? null,
      employeeCode: data.employeeCode ?? null,
      ip,
    },
  });

  try {
    await prisma.roomPreviewSession.update({
      where: { id: sessionId },
      data: {
        userSessionId: created.id,
        ...(customerId ? { customerId } : {}),
      },
    });
  } catch (error) {
    await prisma.userSession.delete({ where: { id: created.id } }).catch(() => undefined);
    throw error;
  }

  return created.id;
}
