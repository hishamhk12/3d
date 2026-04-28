import { type NextRequest, NextResponse } from "next/server";
import { createRoomPreviewSession } from "@/lib/room-preview/session-service";
import { generateSessionToken } from "@/lib/room-preview/session-token";
import { ROOM_PREVIEW_ROUTES } from "@/lib/room-preview/constants";
import { MOBILE_TOKEN_COOKIE } from "@/lib/room-preview/cookies";
import { isSupportedLocale } from "@/lib/i18n/config";
import { getLogger } from "@/lib/logger";

const log = getLogger("dev-entry-api");

/**
 * DEV ONLY — GET /api/room-preview/dev-entry?sessionId=<id>&lang=ar
 *
 * Sets the mobile auth cookie and redirects to the mobile page.
 * When sessionId is provided, reuses that session (no new session created).
 * Falls back to creating a fresh session when sessionId is omitted.
 *
 * Does NOT skip the gate — the mobile page redirects to /gate/[sessionId]
 * if no UserSession is bound yet. The existing gate form handles collection.
 *
 * Returns 404 in production.
 */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const lang = request.nextUrl.searchParams.get("lang");
  const locale = isSupportedLocale(lang) ? lang : "ar";
  const passedSessionId = request.nextUrl.searchParams.get("sessionId");

  let sessionId: string;

  if (passedSessionId) {
    sessionId = passedSessionId;
    log.info({ event: "dev_entry_reuse", sessionId }, "Dev-entry reusing existing session");
  } else {
    const session = await createRoomPreviewSession();
    sessionId = session.id;
    log.info({ event: "dev_entry_create", sessionId }, "Dev-entry created new session");
  }

  const token = generateSessionToken(sessionId);

  const host = request.headers.get("host") ?? "localhost:3000";
  const dest = new URL(
    `${ROOM_PREVIEW_ROUTES.mobileSession(sessionId)}?lang=${locale}`,
    `http://${host}`,
  );

  const response = NextResponse.redirect(dest, 302);
  response.cookies.set(MOBILE_TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/",
    maxAge: 90 * 60,
  });

  return response;
}
