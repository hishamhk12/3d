import { NextResponse } from "next/server";
import { getLogger } from "@/lib/logger";
import { guardSession } from "@/lib/room-preview/api-guard";
import {
  abandonRoomPreviewSession,
  isRoomPreviewSessionNotFoundError,
} from "@/lib/room-preview/session-service";

const log = getLogger("abandon-api");

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;

  const unauthorized = guardSession(request, sessionId);
  if (unauthorized) return unauthorized;

  try {
    await abandonRoomPreviewSession(sessionId);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (isRoomPreviewSessionNotFoundError(error)) {
      return NextResponse.json(
        { code: error.code, error: error.message },
        { status: 404 },
      );
    }

    log.error({ err: error, sessionId }, "Failed to abandon session");
    return NextResponse.json(
      { error: "Failed to abandon session." },
      { status: 500 },
    );
  }
}
