import { NextResponse } from "next/server";
import { getLogger } from "@/lib/logger";
import { getRoomPreviewSession } from "@/lib/room-preview/session-service";

const log = getLogger("session-api");

export async function GET(
  _request: Request,
  context: RouteContext<"/api/room-preview/sessions/[sessionId]">,
) {
  try {
    const { sessionId } = await context.params;
    const session = await getRoomPreviewSession(sessionId);

    if (!session) {
      return NextResponse.json(
        {
          code: "SESSION_NOT_FOUND",
          error: "Session not found",
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

    return NextResponse.json(session);
  } catch (err) {
    log.error({ err }, "Failed to get session");
    return NextResponse.json(
      { error: "Failed to get session" },
      { status: 500 },
    );
  }
}
