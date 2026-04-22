import { type NextRequest, NextResponse } from "next/server";
import { getLogger } from "@/lib/logger";
import { verifySessionToken } from "@/lib/room-preview/session-token";
import { ROOM_PREVIEW_ROUTES } from "@/lib/room-preview/constants";
import { MOBILE_TOKEN_COOKIE } from "@/lib/room-preview/cookies";

const log = getLogger("activate-mobile-api");

/** 90 minutes — generous enough to outlast the default 60-minute session expiry. */
const COOKIE_MAX_AGE_SECONDS = 90 * 60;

type RouteParams = { params: Promise<{ sessionId: string }> };

function cookieOptions(env: string | undefined) {
  return {
    httpOnly: true,
    secure: env === "production",
    // lax allows the cookie to be sent on top-level navigations from external
    // origins (e.g. QR scanner apps), while still blocking cross-site POSTs.
    sameSite: "lax" as const,
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  };
}

/**
 * GET /api/room-preview/sessions/[sessionId]/activate?t=TOKEN
 *
 * Primary activation path — the QR code points here directly.
 * Verifies the HMAC token from the query string, sets the HttpOnly cookie,
 * then redirects the mobile browser to the mobile session page.
 *
 * Using a query param (not a URL fragment) ensures the token survives
 * QR-scanner apps that strip `#…` before handing the URL to the browser.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { sessionId } = await params;
  const token = request.nextUrl.searchParams.get("t") ?? "";

  // Build the origin from the Host header the mobile browser sent, not from
  // request.url — Next.js dev server listens on 0.0.0.0 and request.url may
  // reflect that internal address instead of the LAN IP the client used.
  const host = request.headers.get("host") ?? "localhost:3000";
  const scheme = process.env.NODE_ENV === "production" ? "https" : "http";
  const origin = `${scheme}://${host}`;

  if (!token || !verifySessionToken(token, sessionId)) {
    log.warn({ sessionId }, "Rejected invalid mobile activation token (GET)");
    const dest = new URL(`/room-preview/gate/${sessionId}?error=invalid_session`, origin);
    return NextResponse.redirect(dest, 302);
  }

  const dest = new URL(ROOM_PREVIEW_ROUTES.mobileSession(sessionId), origin);
  const response = NextResponse.redirect(dest, 302);
  response.cookies.set(MOBILE_TOKEN_COOKIE, token, cookieOptions(process.env.NODE_ENV));

  log.info({ sessionId, host }, "Mobile activated via QR (GET)");
  return response;
}

/**
 * POST /api/room-preview/sessions/[sessionId]/activate
 *
 * Legacy / fallback path kept for backwards compatibility with the
 * client-side ActivationHandler. Validates the token from the request
 * body and sets the same HttpOnly cookie.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { sessionId } = await params;

  let token = "";
  try {
    const body: unknown = await request.json();
    if (typeof body === "object" && body !== null && typeof (body as Record<string, unknown>).token === "string") {
      token = (body as Record<string, unknown>).token as string;
    }
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!token || !verifySessionToken(token, sessionId)) {
    log.warn({ sessionId }, "Rejected invalid mobile activation token (POST)");
    return NextResponse.json({ error: "Invalid token." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(MOBILE_TOKEN_COOKIE, token, cookieOptions(process.env.NODE_ENV));

  log.info({ sessionId }, "Mobile activated via client-side handler (POST)");
  return response;
}
