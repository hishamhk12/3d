import "server-only";

// Shared admin-session guard for API routes. Mirrors the existing inline check
// used by app/api/admin/* (cookie -> verifyAdminToken). Returns a 401 NextResponse
// when the session is missing/invalid, or null when the request may proceed.
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, verifyAdminToken } from "@/lib/admin/auth";

export async function requireAdminResponse(): Promise<NextResponse | null> {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  if (!token || !(await verifyAdminToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

/** Server-component guard: true when the current request has a valid admin
 *  session. Pages use this to redirect unauthenticated visitors to the login. */
export async function hasAdminSession(): Promise<boolean> {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  return Boolean(token && (await verifyAdminToken(token)));
}
