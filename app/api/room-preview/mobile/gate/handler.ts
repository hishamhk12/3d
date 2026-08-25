import { after, NextResponse } from "next/server";
import { z } from "zod";
import { trackEvent } from "@/lib/analytics/event-tracker";
import { guardSession } from "@/lib/room-preview/api-guard";
import {
  MobileGateError,
  submitMobileGate,
} from "@/lib/room-preview/mobile-gate-service";

export const dynamic = "force-dynamic";

const MobileGateBodySchema = z.object({
  sessionId: z.string().trim().min(1),
}).passthrough();

function getClientIp(request: Request): string | null {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    null
  );
}

export async function POST(request: Request) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, code: "INVALID_JSON", error: "Invalid request body." },
      { status: 400 },
    );
  }

  const bodyWithSession = MobileGateBodySchema.safeParse(rawBody);
  if (!bodyWithSession.success) {
    return NextResponse.json(
      {
        ok: false,
        code: "INVALID_GATE_PAYLOAD",
        error: bodyWithSession.error.issues[0]?.message ?? "Invalid gate payload.",
      },
      { status: 400 },
    );
  }

  const { sessionId } = bodyWithSession.data;
  const unauthorized = guardSession(request, sessionId);
  if (unauthorized) return unauthorized;

  try {
    const result = await submitMobileGate({
      sessionId,
      body: rawBody,
      ip: getClientIp(request),
    });

    if ("userSessionId" in result && result.userSessionId) {
      const userAgent = request.headers.get("user-agent") ?? undefined;
      after(() =>
        trackEvent({
          userSessionId: result.userSessionId!,
          eventType: "user_entered",
          sessionId,
          metadata: { role: result.role, device: userAgent },
        }),
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof MobileGateError) {
      return NextResponse.json(
        { ok: false, code: error.code, error: error.message },
        { status: error.status },
      );
    }

    return NextResponse.json(
      { ok: false, code: "CUSTOMER_INFO_SAVE_FAILED", error: "Failed to submit gate." },
      { status: 500 },
    );
  }
}
