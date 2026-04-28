"use server";

import { after } from "next/server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { gateFormSchema } from "@/lib/analytics/validators";
import { createAndBindUserSession, sessionHasCompletedGate } from "@/lib/analytics/user-session-service";
import { isSupportedLocale, LOCALE_COOKIE_NAME } from "@/lib/i18n/config";
import { verifySessionToken, generateSessionToken } from "@/lib/room-preview/session-token";
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
  const locale = String(formData.get("locale") ?? "");
  const localeQuery = isSupportedLocale(locale) ? `&lang=${locale}` : "";

  // ── Validate token (read from cookie, not form data) ────────────────────────
  // The token was stored as an HttpOnly cookie by the /activate endpoint when
  // the user first scanned the QR code. Reading it here keeps it out of URLs.
  const cookieStore = await cookies();
  const token = cookieStore.get(MOBILE_TOKEN_COOKIE)?.value ?? "";

  if (isSupportedLocale(locale)) {
    cookieStore.set(LOCALE_COOKIE_NAME, locale, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
      httpOnly: false,
    });
  }

  // In development, allow submission without the activation cookie so the
  // gate form can be tested by directly visiting the URL (no QR scan needed).
  // In production the token is always required.
  const tokenOk =
    process.env.NODE_ENV === "development"
      ? !token || verifySessionToken(token, sessionId)
      : verifySessionToken(token, sessionId);

  if (!sessionId || !tokenOk) {
    redirect(`/room-preview/gate/${sessionId}?error=invalid_session${localeQuery}`);
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
    if (isSupportedLocale(locale)) {
      params.set("lang", locale);
    }
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

  // ── In dev: mint the mobile auth cookie if it was missing ─────────────────
  // Without this, the mobile client's connectRoomPreviewSession call would get
  // a 401 because guardSession always requires the rp-mobile-token cookie.
  if (process.env.NODE_ENV === "development" && !token) {
    cookieStore.set(MOBILE_TOKEN_COOKIE, generateSessionToken(sessionId), {
      path: "/",
      maxAge: 90 * 60,
      httpOnly: true,
      sameSite: "lax",
    });
  }

  // ── Set short-lived cookie so mobile page skips the DB gate check ──────────
  // Avoids the race condition where sessionHasCompletedGate returns false
  // immediately after the write, causing a redirect loop.
  cookieStore.set(`gate_ok_${sessionId}`, "1", {
    path: "/",
    maxAge: 30,
    httpOnly: true,
    sameSite: "lax",
  });

  // ── Redirect into the experience ────────────────────────────────────────────
  redirect(ROOM_PREVIEW_ROUTES.mobileSession(sessionId));
}
