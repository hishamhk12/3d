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
import { trackSessionEvent } from "@/lib/room-preview/session-diagnostics";
import {
  connectMobileToSession,
  isRoomPreviewSessionExpiredError,
  isRoomPreviewSessionNotFoundError,
  RoomPreviewSessionTransitionError,
} from "@/lib/room-preview/session-service";

function getClientIp(reqHeaders: Awaited<ReturnType<typeof headers>>): string | null {
  return (
    reqHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    reqHeaders.get("x-real-ip") ??
    null
  );
}

async function connectAfterGateSuccess(sessionId: string, metadata?: Record<string, unknown>) {
  await trackSessionEvent({
    sessionId,
    source: "mobile",
    eventType: "gate_success_before_connect",
    level: "info",
    metadata,
  });

  console.info("[room-preview] mobile_connect_started", {
    mode: "gate_action_after_customer_info",
    sessionId,
  });
  await trackSessionEvent({
    sessionId,
    source: "mobile",
    eventType: "mobile_connect_started",
    level: "info",
    metadata: {
      ...metadata,
      mode: "gate_action_after_customer_info",
    },
  });

  try {
    const connectedSession = await connectMobileToSession(sessionId);
    console.info("[room-preview] mobile_connect_success", {
      mode: "gate_action_after_customer_info",
      sessionId,
      statusAfter: connectedSession.status,
    });
    await trackSessionEvent({
      sessionId,
      source: "mobile",
      eventType: "mobile_connect_success",
      level: "info",
      statusAfter: connectedSession.status,
      metadata: {
        ...metadata,
        mode: "gate_action_after_customer_info",
      },
    });
  } catch (error) {
    if (error instanceof RoomPreviewSessionTransitionError) {
      console.warn("[room-preview] mobile_connect_skipped_reason", {
        currentStatus: error.currentStatus,
        message: error.message,
        mode: "gate_action_after_customer_info",
        sessionId,
      });
      await trackSessionEvent({
        sessionId,
        source: "mobile",
        eventType: "mobile_connect_skipped_reason",
        level: "warning",
        code: error.code,
        message: error.message,
        statusBefore: error.currentStatus,
        metadata: {
          ...metadata,
          currentStatus: error.currentStatus,
          mode: "gate_action_after_customer_info",
          reason: "session_not_waiting_for_mobile",
        },
      });
      return;
    }

    if (
      isRoomPreviewSessionExpiredError(error) ||
      isRoomPreviewSessionNotFoundError(error)
    ) {
      console.warn("[room-preview] mobile_connect_failed", {
        code: error.code,
        message: error.message,
        mode: "gate_action_after_customer_info",
        sessionId,
      });
      await trackSessionEvent({
        sessionId,
        source: "mobile",
        eventType: "mobile_connect_failed",
        level: "warning",
        code: error.code,
        message: error.message,
        metadata: {
          ...metadata,
          mode: "gate_action_after_customer_info",
        },
      });
      return;
    }

    console.error("[room-preview] mobile_connect_failed", {
      error: error instanceof Error ? error.message : String(error),
      mode: "gate_action_after_customer_info",
      sessionId,
    });
    await trackSessionEvent({
      sessionId,
      source: "mobile",
      eventType: "mobile_connect_failed",
      level: "error",
      code: "MOBILE_CONNECT_AFTER_GATE_FAILED",
      message: error instanceof Error ? error.message : String(error),
      metadata: {
        ...metadata,
        mode: "gate_action_after_customer_info",
      },
    });
    throw error;
  }
}

export async function submitGateForm(formData: FormData) {
  const sessionId = String(formData.get("sessionId") ?? "");
  const locale = String(formData.get("locale") ?? "");
  const localeQuery = isSupportedLocale(locale) ? `&lang=${locale}` : "";

  console.info("[room-preview] customer_info_submit_started", { sessionId });
  await trackSessionEvent({
    sessionId,
    source: "mobile",
    eventType: "customer_info_submit_started",
    level: "info",
  });

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
    console.warn("[room-preview] customer_info_submit_failed", {
      reason: "invalid_session_token",
      sessionId,
    });
    await trackSessionEvent({
      sessionId,
      source: "mobile",
      eventType: "customer_info_submit_failed",
      level: "error",
      code: "INVALID_SESSION_TOKEN",
      message: "Customer info submit rejected because the mobile token was missing or invalid.",
    });
    redirect(`/room-preview/gate/${sessionId}?error=invalid_session${localeQuery}`);
  }

  // ── Prevent double-submission ───────────────────────────────────────────────
  const alreadyDone = await sessionHasCompletedGate(sessionId);
  if (alreadyDone) {
    console.info("[room-preview] customer_info_submit_success", {
      alreadyCompleted: true,
      sessionId,
    });
    await trackSessionEvent({
      sessionId,
      source: "mobile",
      eventType: "customer_info_submit_success",
      level: "info",
      metadata: { alreadyCompleted: true },
    });
    await connectAfterGateSuccess(sessionId, { alreadyCompleted: true });
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
    console.warn("[room-preview] customer_info_submit_failed", {
      reason: "validation_failed",
      sessionId,
    });
    await trackSessionEvent({
      sessionId,
      source: "mobile",
      eventType: "customer_info_submit_failed",
      level: "warning",
      code: "CUSTOMER_INFO_VALIDATION_FAILED",
      message: firstError,
    });
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

  let userSessionId: string;
  try {
    userSessionId = await createAndBindUserSession(sessionId, parsed.data, ip);
  } catch (error) {
    console.error("[room-preview] customer_info_submit_failed", {
      error: error instanceof Error ? error.message : String(error),
      sessionId,
    });
    await trackSessionEvent({
      sessionId,
      source: "mobile",
      eventType: "customer_info_submit_failed",
      level: "error",
      code: "CUSTOMER_INFO_SAVE_FAILED",
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  console.info("[room-preview] customer_info_submit_success", {
    role: parsed.data.role,
    sessionId,
    userSessionId,
  });
  await trackSessionEvent({
    sessionId,
    source: "mobile",
    eventType: "customer_info_submit_success",
    level: "info",
    metadata: { role: parsed.data.role, userSessionId },
  });

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
  await connectAfterGateSuccess(sessionId, {
    role: parsed.data.role,
    userSessionId,
  });

  redirect(ROOM_PREVIEW_ROUTES.mobileSession(sessionId));
}
