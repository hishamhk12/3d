import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getLogger } from "@/lib/logger";
import { getRoomPreviewSession } from "@/lib/room-preview/session-service";
import { isValidRoomPreviewSessionId } from "@/lib/room-preview/validators";
import { getDatabaseTargetFingerprint } from "@/lib/server/database-target";

export const dynamic = "force-dynamic";

const log = getLogger("session-api");

export async function GET(
  request: Request,
  context: RouteContext<"/api/room-preview/sessions/[sessionId]">,
) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const databaseTarget = getDatabaseTargetFingerprint();
  let sessionId: string | null = null;
  let stage = "route_params";

  try {
    const params = await context.params;
    sessionId = params.sessionId;

    log.info(
      { databaseTarget, requestId, sessionId },
      "Room Preview session GET received",
    );

    if (!isValidRoomPreviewSessionId(sessionId)) {
      log.warn(
        { requestId, sessionId },
        "Room Preview session GET rejected invalid session id",
      );
      return NextResponse.json(
        { code: "INVALID_SESSION_ID", error: "Invalid session id", requestId },
        { status: 400 },
      );
    }

    stage = "session_store_read";
    const session = await getRoomPreviewSession(sessionId);

    if (!session) {
      log.warn(
        { databaseTarget, requestId, sessionId },
        "Room Preview session not found",
      );
      return NextResponse.json(
        {
          code: "SESSION_NOT_FOUND",
          error: "Session not found",
          requestId,
        },
        { status: 404 },
      );
    }

    if (session.status === "expired") {
      return NextResponse.json(
        {
          code: "SESSION_EXPIRED",
          error: "Session expired. Start a new session.",
        },
        { status: 410 },
      );
    }

    log.info(
      { databaseTarget, requestId, sessionId, status: session.status },
      "Room Preview session read succeeded",
    );

    return NextResponse.json(session, {
      headers: {
        "Cache-Control": "no-store",
        "X-Request-Id": requestId,
      },
    });
  } catch (err) {
    // Pino's `err` serializer emits the real error message and stack trace.
    // The response exposes only a correlation id and a stable public code.
    log.error(
      { databaseTarget, err, requestId, sessionId, stage },
      "Failed to get session",
    );
    return NextResponse.json(
      { code: "SESSION_READ_FAILED", error: "Failed to get session", requestId },
      { status: 500 },
    );
  }
}
