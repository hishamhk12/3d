"use server";

import { after } from "next/server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { gateFormSchema } from "@/lib/analytics/validators";
import {
  createAndBindUserSession,
  sessionHasCompletedGate,
} from "@/lib/analytics/user-session-service";
import {
  findCustomerByPhone,
  createOrRefreshCustomer,
  refreshCustomerLastSeen,
  getCustomerById,
  normalizePhoneToE164,
  maskPhone,
} from "@/lib/room-preview/customer-service";
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
    metadata: { ...metadata, mode: "gate_action_after_customer_info" },
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
      metadata: { ...metadata, mode: "gate_action_after_customer_info" },
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

    if (isRoomPreviewSessionExpiredError(error) || isRoomPreviewSessionNotFoundError(error)) {
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
        metadata: { ...metadata, mode: "gate_action_after_customer_info" },
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
      metadata: { ...metadata, mode: "gate_action_after_customer_info" },
    });
    throw error;
  }
}

export async function submitGateForm(formData: FormData) {
  const sessionId = String(formData.get("sessionId") ?? "");
  const locale = String(formData.get("locale") ?? "");
  const localeQuery = isSupportedLocale(locale) ? `&lang=${locale}` : "";

  const flow = String(formData.get("flow") ?? "");

  console.info("[room-preview] customer_info_submit_started", { sessionId, flow });
  await trackSessionEvent({
    sessionId,
    source: "mobile",
    eventType: "customer_info_submit_started",
    level: "info",
    metadata: { flow },
  });

  // ── Validate token ─────────────────────────────────────────────────────────
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
      message: "Mobile token missing or invalid.",
    });
    redirect(`/room-preview/gate/${sessionId}?error=invalid_session${localeQuery}`);
  }

  // ── Returning customer lookup (no UserSession created here) ────────────────
  // This flow just looks up the phone and redirects to the confirm screen.
  // No UserSession is created until the confirm step.
  if (flow === "customer_existing") {
    const raw = {
      flow: "customer_existing",
      countryCode: formData.get("countryCode"),
      dialCode: formData.get("dialCode"),
      phone: formData.get("phone"),
    };
    const parsed = gateFormSchema.safeParse(raw);
    if (!parsed.success || parsed.data.flow !== "customer_existing") {
      const firstError =
        Object.values(parsed.success ? {} : parsed.error.flatten().fieldErrors)[0]?.[0] ??
        "Invalid input";
      const params = new URLSearchParams({
        step: "customer_existing",
        error: firstError,
        countryCode: String(raw.countryCode ?? ""),
        phone: String(raw.phone ?? ""),
      });
      if (isSupportedLocale(locale)) params.set("lang", locale);
      redirect(`/room-preview/gate/${sessionId}?${params}`);
    }

    const { countryCode, dialCode, phone } = parsed.data;
    const phoneE164 = normalizePhoneToE164(phone, dialCode);

    console.info("[room-preview] customer_existing_lookup", {
      sessionId,
      phone: maskPhone(phoneE164),
    });

    const customer = await findCustomerByPhone(phoneE164);

    if (!customer) {
      console.info("[room-preview] customer_existing_not_found", {
        sessionId,
        phone: maskPhone(phoneE164),
      });
      await trackSessionEvent({
        sessionId,
        source: "mobile",
        eventType: "customer_existing_not_found",
        level: "info",
        metadata: { phone: maskPhone(phoneE164) },
      });
      const params = new URLSearchParams({
        step: "customer_existing",
        notFound: "1",
        countryCode,
        phone,
      });
      if (isSupportedLocale(locale)) params.set("lang", locale);
      redirect(`/room-preview/gate/${sessionId}?${params}`);
    }

    // Found — redirect to confirm screen
    console.info("[room-preview] customer_existing_found", {
      sessionId,
      customerId: customer.id,
    });
    await trackSessionEvent({
      sessionId,
      source: "mobile",
      eventType: "customer_existing_found",
      level: "info",
      metadata: { customerId: customer.id },
    });
    const params = new URLSearchParams({
      step: "customer_confirm",
      greeting: customer.name,
      cid: customer.id,
    });
    if (isSupportedLocale(locale)) params.set("lang", locale);
    redirect(`/room-preview/gate/${sessionId}?${params}`);
  }

  // ── Prevent double-submission for flows that create a UserSession ──────────
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

  // ── Parse form fields ──────────────────────────────────────────────────────
  const raw = {
    flow: formData.get("flow"),
    name: formData.get("name"),
    countryCode: formData.get("countryCode"),
    dialCode: formData.get("dialCode"),
    phone: formData.get("phone"),
    customerId: formData.get("customerId"),
    employeeCode: formData.get("employeeCode"),
  };

  const parsed = gateFormSchema.safeParse(raw);

  if (!parsed.success) {
    const firstError =
      Object.values(parsed.error.flatten().fieldErrors)[0]?.[0] ?? "Invalid input";
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
    const params = new URLSearchParams({ error: firstError });
    if (flow === "employee") {
      params.set("step", "employee");
      params.set("name", String(raw.name ?? ""));
    } else if (flow === "customer_new") {
      params.set("step", "customer_new");
      params.set("name", String(raw.name ?? ""));
      params.set("countryCode", String(raw.countryCode ?? ""));
      params.set("phone", String(raw.phone ?? ""));
    }
    if (isSupportedLocale(locale)) params.set("lang", locale);
    redirect(`/room-preview/gate/${sessionId}?${params}`);
  }

  const data = parsed.data;
  const reqHeaders = await headers();
  const ip = getClientIp(reqHeaders);
  const ua = reqHeaders.get("user-agent") ?? undefined;

  let userSessionId: string;
  let customerId: string | null = null;
  let userRole: "customer" | "employee" = "customer";

  try {
    // ── New customer ─────────────────────────────────────────────────────────
    if (data.flow === "customer_new") {
      const phoneE164 = normalizePhoneToE164(data.phone, data.dialCode);
      const customer = await createOrRefreshCustomer({
        name: data.name,
        phoneE164,
        countryCode: data.countryCode,
        dialCode: data.dialCode,
      });
      customerId = customer.id;
      userRole = "customer";
      userSessionId = await createAndBindUserSession(
        sessionId,
        {
          name: data.name,
          role: "customer",
          phone: phoneE164,
          countryCode: data.countryCode,
          dialCode: data.dialCode,
        },
        ip,
        customerId,
      );
    }

    // ── Existing customer confirm ─────────────────────────────────────────────
    else if (data.flow === "customer_confirm") {
      customerId = data.customerId;
      // Fetch customer to get stored phone/country
      const customer = await getCustomerById(customerId);
      if (!customer) {
        // Customer may have expired — treat as not found
        const params = new URLSearchParams({
          step: "customer_existing",
          notFound: "1",
        });
        if (isSupportedLocale(locale)) params.set("lang", locale);
        redirect(`/room-preview/gate/${sessionId}?${params}`);
      }
      await refreshCustomerLastSeen(customerId);
      userRole = "customer";
      userSessionId = await createAndBindUserSession(
        sessionId,
        {
          name: customer.name,
          role: "customer",
          phone: customer.phoneE164,
          countryCode: customer.countryCode,
          dialCode: customer.dialCode,
        },
        ip,
        customerId,
      );
    }

    // ── Employee ─────────────────────────────────────────────────────────────
    else if (data.flow === "employee") {
      userRole = "employee";
      userSessionId = await createAndBindUserSession(
        sessionId,
        {
          name: data.name,
          role: "employee",
          employeeCode: data.employeeCode,
        },
        ip,
        null,
      );
    }

    // customer_existing is handled above with an early redirect; this is unreachable
    else {
      redirect(`/room-preview/gate/${sessionId}?step=customer_existing${localeQuery}`);
    }
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
    flow: data.flow,
    sessionId,
    userSessionId,
    customerId,
  });
  await trackSessionEvent({
    sessionId,
    source: "mobile",
    eventType: "customer_info_submit_success",
    level: "info",
    metadata: { flow: data.flow, userRole, userSessionId, customerId },
  });

  after(() =>
    trackEvent({
      userSessionId,
      eventType: "user_entered",
      sessionId,
      metadata: { role: userRole, device: ua },
    }),
  );

  // ── Dev: mint mobile cookie if missing ─────────────────────────────────────
  if (process.env.NODE_ENV === "development" && !token) {
    cookieStore.set(MOBILE_TOKEN_COOKIE, generateSessionToken(sessionId), {
      path: "/",
      maxAge: 90 * 60,
      httpOnly: true,
      sameSite: "lax",
    });
  }

  // ── Short-lived cookie to skip the DB gate check on redirect ───────────────
  cookieStore.set(`gate_ok_${sessionId}`, "1", {
    path: "/",
    maxAge: 30,
    httpOnly: true,
    sameSite: "lax",
  });

  await connectAfterGateSuccess(sessionId, { flow: data.flow, userSessionId });
  redirect(ROOM_PREVIEW_ROUTES.mobileSession(sessionId));
}
