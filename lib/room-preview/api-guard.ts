import "server-only";

import { NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/room-preview/session-token";

import { MOBILE_TOKEN_COOKIE } from "@/lib/room-preview/cookies";

function getMobileTokenFromCookies(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const part of cookieHeader.split(";")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    const name = part.slice(0, eqIdx).trim();
    if (name === MOBILE_TOKEN_COOKIE) {
      return decodeURIComponent(part.slice(eqIdx + 1).trim());
    }
  }
  return null;
}

/**
 * Verify the session token on a mutation request.
 *
 * Returns a 401 NextResponse if the token is missing or invalid.
 * Returns null if the request is authorised — the caller may proceed.
 *
 * Accepts the token from either the `x-session-token` header (legacy /
 * non-browser clients) or the `rp-mobile-token` HttpOnly cookie (browser
 * mobile clients — set by the /activate endpoint on first QR scan).
 */
export function guardSession(
  request: Request,
  sessionId: string,
): NextResponse | null {
  const token =
    request.headers.get("x-session-token") ??
    getMobileTokenFromCookies(request);

  if (!token) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", error: "Session token is required." },
      { status: 401 },
    );
  }

  if (!verifySessionToken(token, sessionId)) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", error: "Invalid session token." },
      { status: 401 },
    );
  }

  return null;
}
