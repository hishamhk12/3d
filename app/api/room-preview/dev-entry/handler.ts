import { type NextRequest, NextResponse } from "next/server";
import { getLogger } from "@/lib/logger";
import { isSupportedLocale } from "@/lib/i18n/config";
import { MOBILE_TOKEN_COOKIE } from "@/lib/room-preview/cookies";
import { ROOM_PREVIEW_ROUTES } from "@/lib/room-preview/constants";
import { generateSessionToken } from "@/lib/room-preview/session-token";
import { isValidRoomPreviewSessionId } from "@/lib/room-preview/validators";
import { createRoomPreviewSession, getRoomPreviewSession } from "@/lib/room-preview/session-service";

const log = getLogger("dev-entry-api");

/** Development-only shortcut for testing the mobile flow without scanning a QR. */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const lang = request.nextUrl.searchParams.get("lang");
  const locale = isSupportedLocale(lang) ? lang : "ar";
  const requestedSessionId = request.nextUrl.searchParams.get("sessionId");

  let sessionId: string;
  if (requestedSessionId) {
    if (!isValidRoomPreviewSessionId(requestedSessionId)) {
      return NextResponse.json({ error: "Invalid session id." }, { status: 400 });
    }

    const session = await getRoomPreviewSession(requestedSessionId);
    if (!session) return NextResponse.json({ error: "Session not found." }, { status: 404 });
    if (session.status === "expired") {
      return NextResponse.json({ error: "Session expired." }, { status: 410 });
    }
    sessionId = session.id;
  } else {
    const session = await createRoomPreviewSession();
    sessionId = session.id;
  }

  // In `next dev --hostname 0.0.0.0`, nextUrl.origin can expose the bind
  // address (0.0.0.0) instead of the browser's reachable host. Preserve Host
  // so the shortcut also works through the Windows-to-WSL LAN proxy.
  const host = request.headers.get("host") ?? "localhost:3000";
  const origin = `http://${host}`;
  const destination = new URL(
    `${ROOM_PREVIEW_ROUTES.mobileSession(sessionId)}?lang=${locale}`,
    origin,
  );
  const response = NextResponse.redirect(destination, 302);
  response.cookies.set(MOBILE_TOKEN_COOKIE, generateSessionToken(sessionId), {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/",
    maxAge: 90 * 60,
  });
  log.info({ sessionId }, "Development mobile entry opened");
  return response;
}
