"use server";

import { after } from "next/server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { gateFormSchema } from "@/lib/analytics/validators";
import { createAndBindUserSession, sessionHasCompletedGate } from "@/lib/analytics/user-session-service";
import { verifySessionToken } from "@/lib/room-preview/session-token";
import { trackEvent } from "@/lib/analytics/event-tracker";
import { ROOM_PREVIEW_ROUTES } from "@/lib/room-preview/constants";
import { MOBILE_TOKEN_COOKIE } from "@/lib/room-preview/cookies";

function getClientIp(reqHeaders: Awaited<ReturnType<typeof headers>>): string | null {
  return (
    reqHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    reqHeaders.get("x-real-ip") ??
    null
  );
}

export async function submitGateForm(formData: FormData) {
  const sessionId = String(formData.get("sessionId") ?? "");

  // ── Validate token (read from cookie, not form data) ────────────────────────
  // The token was stored as an HttpOnly cookie by the /activate endpoint when
  // the user first scanned the QR code. Reading it here keeps it out of URLs.
  const cookieStore = await cookies();
  const token = cookieStore.get(MOBILE_TOKEN_COOKIE)?.value ?? "";

  if (!sessionId || !verifySessionToken(token, sessionId)) {
    redirect(`/room-preview/gate/${sessionId}?error=invalid_session`);
  }

  // ── Prevent double-submission ───────────────────────────────────────────────
  const alreadyDone = await sessionHasCompletedGate(sessionId);
  if (alreadyDone) {
    redirect(ROOM_PREVIEW_ROUTES.mobileSession(sessionId));
  }

  // ── Validate form fields ────────────────────────────────────────────────────
  const raw = {
    role: formData.get("role"),
    name: formData.get("name"),
    phone: formData.get("phone"),
    employeeCode: formData.get("employeeCode"),
  };

  const parsed = gateFormSchema.safeParse(raw);

  if (!parsed.success) {
    const firstError = Object.values(parsed.error.flatten().fieldErrors)[0]?.[0] ?? "Invalid input";
    const params = new URLSearchParams({
      error: firstError,
      role: String(raw.role ?? ""),
      name: String(raw.name ?? ""),
    });
    redirect(`/room-preview/gate/${sessionId}?${params}`);
  }

  // ── Create UserSession + bind to RoomPreviewSession ─────────────────────────
  const reqHeaders = await headers();
  const ip = getClientIp(reqHeaders);
  const ua = reqHeaders.get("user-agent") ?? undefined;

  const userSessionId = await createAndBindUserSession(sessionId, parsed.data, ip);

  // ── Track user_entered event ─────────────────────────────────────────────────
  after(() => trackEvent({
    userSessionId,
    eventType: "user_entered",
    sessionId,
    metadata: { role: parsed.data.role, device: ua },
  }));

  // ── Redirect into the experience ────────────────────────────────────────────
  redirect(ROOM_PREVIEW_ROUTES.mobileSession(sessionId));
}
