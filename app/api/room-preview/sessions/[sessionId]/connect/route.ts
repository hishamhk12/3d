import { after, NextResponse } from "next/server";
import { getLogger } from "@/lib/logger";
import { guardSession } from "@/lib/room-preview/api-guard";
import {
  connectMobileToSession,
  isRoomPreviewSessionExpiredError,
  isRoomPreviewSessionNotFoundError,
  RoomPreviewSessionTransitionError,
} from "@/lib/room-preview/session-service";
import { trackEvent, getUserSessionIdForSession } from "@/lib/analytics/event-tracker";

const log = getLogger("connect-api");

export async function POST(
  request: Request,
  context: RouteContext<"/api/room-preview/sessions/[sessionId]/connect">,
) {
  const { sessionId } = await context.params;

  const unauthorized = guardSession(request, sessionId);
  if (unauthorized) return unauthorized;

  try {
    const session = await connectMobileToSession(sessionId);

    after(async () => {
      const userSessionId = await getUserSessionIdForSession(sessionId);
      if (userSessionId) {
        await trackEvent({ userSessionId, eventType: "qr_scanned", sessionId });
      }
    });

    return NextResponse.json(session);
  } catch (error) {
    if (isRoomPreviewSessionNotFoundError(error)) {
      return NextResponse.json(
        { code: error.code, error: error.message },
        { status: 404 },
      );
    }

    if (isRoomPreviewSessionExpiredError(error)) {
      return NextResponse.json(
        { code: error.code, error: error.message },
        { status: 410 },
      );
    }

    if (error instanceof RoomPreviewSessionTransitionError) {
      return NextResponse.json(
        { code: error.code, error: error.message },
        { status: 400 },
      );
    }

    log.error({ err: error, sessionId }, "Failed to connect mobile to session");
    return NextResponse.json(
      { error: "Failed to connect mobile to session." },
      { status: 500 },
    );
  }
}
