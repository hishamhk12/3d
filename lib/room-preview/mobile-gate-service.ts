import "server-only";

import { gateFormSchema, type GateFormInput } from "@/lib/analytics/validators";
import {
  createAndBindUserSession,
  sessionHasCompletedGate,
} from "@/lib/analytics/user-session-service";
import {
  createOrRefreshCustomer,
  findCustomerByPhone,
  getCustomerById,
  getLatestCustomerExperiences,
  maskPhone,
  normalizePhoneToE164,
  refreshCustomerLastSeen,
} from "@/lib/room-preview/customer-service";
import {
  connectMobileToSession,
  getRoomPreviewSession,
  isRoomPreviewSessionExpiredError,
  isRoomPreviewSessionNotFoundError,
  RoomPreviewSessionTransitionError,
} from "@/lib/room-preview/session-service";
import { trackSessionEvent } from "@/lib/room-preview/session-diagnostics";
import type { RoomPreviewSession } from "@/lib/room-preview/types";

export type MobileGateResult =
  | {
      ok: true;
      flow: "customer_existing";
      nextFlow: "customer_confirm";
      customer: {
        id: string;
        name: string;
        countryCode: string;
        dialCode: string;
        phoneMasked: string;
      };
      previousExperiences: Array<{
        id: string;
        sessionId: string;
        roomImageUrl: string | null;
        productId: string | null;
        productName: string | null;
        resultImageUrl: string | null;
        createdAt: string;
      }>;
    }
  | {
      ok: true;
      flow: Exclude<GateFormInput["flow"], "customer_existing">;
      role: "customer" | "employee";
      userSessionId: string | null;
      customerId: string | null;
      alreadyCompleted: boolean;
      session: RoomPreviewSession | null;
    };

export class MobileGateError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "MobileGateError";
  }
}

type SubmitMobileGateInput = {
  sessionId: string;
  body: unknown;
  ip: string | null;
};

async function connectAfterGateSuccess(
  sessionId: string,
  metadata?: Record<string, unknown>,
): Promise<RoomPreviewSession | null> {
  await trackSessionEvent({
    sessionId,
    source: "mobile",
    eventType: "gate_success_before_connect",
    level: "info",
    metadata,
  });

  await trackSessionEvent({
    sessionId,
    source: "mobile",
    eventType: "mobile_connect_started",
    level: "info",
    metadata: { ...metadata, mode: "mobile_gate_api" },
  });

  try {
    const connectedSession = await connectMobileToSession(sessionId);
    await trackSessionEvent({
      sessionId,
      source: "mobile",
      eventType: "mobile_connect_success",
      level: "info",
      statusAfter: connectedSession.status,
      metadata: { ...metadata, mode: "mobile_gate_api" },
    });
    return connectedSession;
  } catch (error) {
    if (error instanceof RoomPreviewSessionTransitionError) {
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
          mode: "mobile_gate_api",
          reason: "session_not_waiting_for_mobile",
        },
      });
      return getRoomPreviewSession(sessionId);
    }

    if (isRoomPreviewSessionExpiredError(error) || isRoomPreviewSessionNotFoundError(error)) {
      await trackSessionEvent({
        sessionId,
        source: "mobile",
        eventType: "mobile_connect_failed",
        level: "warning",
        code: error.code,
        message: error.message,
        metadata: { ...metadata, mode: "mobile_gate_api" },
      });
      throw new MobileGateError(error.code, error.message, isRoomPreviewSessionExpiredError(error) ? 410 : 404);
    }

    await trackSessionEvent({
      sessionId,
      source: "mobile",
      eventType: "mobile_connect_failed",
      level: "error",
      code: "MOBILE_CONNECT_AFTER_GATE_FAILED",
      message: error instanceof Error ? error.message : String(error),
      metadata: { ...metadata, mode: "mobile_gate_api" },
    });
    throw error;
  }
}

function serializeExperience(experience: {
  id: string;
  sessionId: string;
  roomImageUrl: string | null;
  productId: string | null;
  productName: string | null;
  resultImageUrl: string | null;
  createdAt: Date;
}) {
  return {
    id: experience.id,
    sessionId: experience.sessionId,
    roomImageUrl: experience.roomImageUrl,
    productId: experience.productId,
    productName: experience.productName,
    resultImageUrl: experience.resultImageUrl,
    createdAt: experience.createdAt.toISOString(),
  };
}

export async function submitMobileGate({
  sessionId,
  body,
  ip,
}: SubmitMobileGateInput): Promise<MobileGateResult> {
  const parsed = gateFormSchema.safeParse(body);
  if (!parsed.success) {
    const firstError =
      Object.values(parsed.error.flatten().fieldErrors)[0]?.[0] ??
      "Invalid gate payload.";
    await trackSessionEvent({
      sessionId,
      source: "mobile",
      eventType: "customer_info_submit_failed",
      level: "warning",
      code: "CUSTOMER_INFO_VALIDATION_FAILED",
      message: firstError,
    });
    throw new MobileGateError("CUSTOMER_INFO_VALIDATION_FAILED", firstError, 400);
  }

  const data = parsed.data;

  await trackSessionEvent({
    sessionId,
    source: "mobile",
    eventType: "customer_info_submit_started",
    level: "info",
    metadata: { flow: data.flow, mode: "mobile_gate_api" },
  });

  if (data.flow === "customer_existing") {
    const phoneE164 = normalizePhoneToE164(data.phone, data.dialCode);
    const customer = await findCustomerByPhone(phoneE164);

    if (!customer) {
      await trackSessionEvent({
        sessionId,
        source: "mobile",
        eventType: "customer_existing_not_found",
        level: "info",
        metadata: { phone: maskPhone(phoneE164), mode: "mobile_gate_api" },
      });
      throw new MobileGateError("CUSTOMER_NOT_FOUND", "Customer not found.", 404);
    }

    await trackSessionEvent({
      sessionId,
      source: "mobile",
      eventType: "customer_existing_found",
      level: "info",
      metadata: { customerId: customer.id, mode: "mobile_gate_api" },
    });

    const previousExperiences = await getLatestCustomerExperiences(customer.id, 3);

    return {
      ok: true,
      flow: "customer_existing",
      nextFlow: "customer_confirm",
      customer: {
        id: customer.id,
        name: customer.name,
        countryCode: customer.countryCode,
        dialCode: customer.dialCode,
        phoneMasked: maskPhone(customer.phoneE164),
      },
      previousExperiences: previousExperiences.map(serializeExperience),
    };
  }

  const alreadyCompleted = await sessionHasCompletedGate(sessionId);
  if (alreadyCompleted) {
    const session = await connectAfterGateSuccess(sessionId, {
      alreadyCompleted: true,
      mode: "mobile_gate_api",
    });
    await trackSessionEvent({
      sessionId,
      source: "mobile",
      eventType: "customer_info_submit_success",
      level: "info",
      metadata: { alreadyCompleted: true, mode: "mobile_gate_api" },
    });
    return {
      ok: true,
      flow: data.flow,
      role: data.flow === "employee" ? "employee" : "customer",
      userSessionId: null,
      customerId: null,
      alreadyCompleted: true,
      session,
    };
  }

  let userSessionId: string;
  let customerId: string | null = null;
  let role: "customer" | "employee" = "customer";

  if (data.flow === "customer_new") {
    const phoneE164 = normalizePhoneToE164(data.phone, data.dialCode);
    const customer = await createOrRefreshCustomer({
      name: data.name,
      phoneE164,
      countryCode: data.countryCode,
      dialCode: data.dialCode,
    });
    customerId = customer.id;
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
  } else if (data.flow === "customer_confirm") {
    const customer = await getCustomerById(data.customerId);
    if (!customer) {
      throw new MobileGateError("CUSTOMER_NOT_FOUND", "Customer not found.", 404);
    }

    await refreshCustomerLastSeen(customer.id);
    customerId = customer.id;
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
  } else {
    role = "employee";
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

  await trackSessionEvent({
    sessionId,
    source: "mobile",
    eventType: "customer_info_submit_success",
    level: "info",
    metadata: { flow: data.flow, userRole: role, userSessionId, customerId, mode: "mobile_gate_api" },
  });

  await trackSessionEvent({
    sessionId,
    source: "mobile",
    eventType: "gate_completed",
    level: "info",
    metadata: {
      role,
      hasName: true,
      hasPhone: role === "customer",
      isExistingCustomer: data.flow === "customer_confirm",
      mode: "mobile_gate_api",
    },
  });

  const session = await connectAfterGateSuccess(sessionId, {
    flow: data.flow,
    userSessionId,
    mode: "mobile_gate_api",
  });

  return {
    ok: true,
    flow: data.flow,
    role,
    userSessionId,
    customerId,
    alreadyCompleted: false,
    session,
  };
}
