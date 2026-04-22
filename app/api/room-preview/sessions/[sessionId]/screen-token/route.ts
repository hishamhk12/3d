import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { getLogger } from "@/lib/logger";
import { SCREEN_TOKEN_COOKIE } from "@/lib/room-preview/cookies";
import { verifySessionToken } from "@/lib/room-preview/session-token";

const log = getLogger("screen-token-api");

/**
 * Cookie TTL in seconds — generous enough to outlast the session expiry
 * (default 60 min) plus a small buffer for clock drift.
 */
const COOKIE_MAX_AGE_SECONDS = 90 * 60; // 90 minutes

type RouteParams = { params: Promise<{ sessionId: string }> };

/**
 * POST /api/room-preview/sessions/[sessionId]/screen-token
 *
 * Verifies the HMAC token for the given sessionId and, if valid, stores it
 * in an HttpOnly cookie so the screen page can read it server-side without
 * ever exposing it in the URL, browser history, or proxy / CDN access logs.
 *
 * Called once by ScreenLauncherClient immediately after creating a session,
 * before navigating to the screen page.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { sessionId } = await params;

  let token: string | undefined;

  try {
    const body: unknown = await request.json();
    if (
      typeof body === "object" &&
      body !== null &&
      typeof (body as Record<string, unknown>).token === "string"
    ) {
      token = (body as Record<string, unknown>).token as string;
    }
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!token) {
    return NextResponse.json({ error: "Missing token." }, { status: 400 });
  }

  // Verify the token before persisting it — reject tokens that don't belong
  // to this sessionId to prevent cookie-stuffing attacks.
  const valid = verifySessionToken(token, sessionId);

  if (!valid) {
    log.warn({ sessionId }, "Rejected invalid screen session token");
    return NextResponse.json({ error: "Invalid token." }, { status: 400 });
  }

  const cookieStore = await cookies();

  cookieStore.set(SCREEN_TOKEN_COOKIE, token, {
    httpOnly: true,
    // Secure must only be true over HTTPS. In local dev (HTTP) the browser
    // silently drops Secure cookies, so we disable it in development.
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });

  return NextResponse.json({ ok: true });
}
