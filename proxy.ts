import { NextRequest, NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, verifyAdminToken } from "@/lib/admin/auth";
import { checkIpRateLimit, getClientIp } from "@/lib/ip-rate-limit";
import { isRoomPreviewRateLimitDisabled } from "@/lib/room-preview/rate-limit-bypass";

// ─── Limits configuration ─────────────────────────────────────────────────────
//
// Each entry: [url-fragment-to-match, requests-per-window, window-seconds]
// Rules are checked in order; first match wins.
// Counters are Redis-backed (shared across all instances) with an in-memory
// fallback when Redis is unavailable.

type RateLimitRule = [fragment: string, limit: number, windowSeconds: number];

const RATE_LIMIT_RULES: RateLimitRule[] = [
  // AI render pipeline — most expensive resource
  ["/render",   5,   60],
  // Image uploads
  ["/room",     20,  60],
  // Session creation
  ["/sessions", 15,  60],
  // All other API calls — broad safety net
  ["/api/",     300, 60],
];

// ─── Security headers ─────────────────────────────────────────────────────────

const SECURITY_HEADERS: [string, string][] = [
  ["X-Content-Type-Options",  "nosniff"],
  ["X-Frame-Options",         "DENY"],
  ["X-XSS-Protection",        "1; mode=block"],
  ["Referrer-Policy",         "strict-origin-when-cross-origin"],
  // camera=(self) — allow camera only on same-origin pages (needed for room photo capture).
  // microphone and geolocation remain blocked.
  ["Permissions-Policy",      "camera=(self), microphone=(), geolocation=()"],
];

// ─── Proxy (formerly Middleware) ─────────────────────────────────────────────

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // ── Admin auth guard ─────────────────────────────────────────────────────────
  // Protect all /admin routes except /admin/login.
  // Room Preview diagnostics live under /api/room-preview/* and must never use admin auth.
  if (path.startsWith("/admin") && !path.startsWith("/admin/login")) {
    const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
    if (!token || !(await verifyAdminToken(token))) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/admin/login";
      loginUrl.searchParams.set("next", path);
      return NextResponse.redirect(loginUrl);
    }
  }

  const bypassRoomPreviewRateLimit =
    path.startsWith("/api/room-preview/") && isRoomPreviewRateLimitDisabled();

  // ── Rate limiting (API routes only) ─────────────────────────────────────────
  if (path.startsWith("/api/") && !bypassRoomPreviewRateLimit) {
    const ip = getClientIp(request.headers);

    for (const [fragment, limit, windowSeconds] of RATE_LIMIT_RULES) {
      if (path.includes(fragment)) {
        const result = await checkIpRateLimit(ip, {
          keyPrefix: `proxy:${fragment}`,
          limit,
          windowSeconds,
        });

        if (result.limited) {
          return NextResponse.json(
            { code: "RATE_LIMITED", error: "Too many requests. Please slow down." },
            {
              status: 429,
              headers: {
                "Retry-After":  String(result.retryAfterSeconds),
                "Content-Type": "application/json",
              },
            },
          );
        }

        break; // only apply the first matching rule
      }
    }
  }

  // ── Security headers (all routes) ───────────────────────────────────────────
  const response = NextResponse.next();
  const requestId = crypto.randomUUID();

  response.headers.set("X-Request-Id", requestId);

  for (const [name, value] of SECURITY_HEADERS) {
    response.headers.set(name, value);
  }

  return response;
}

export const config = {
  // Run on all routes except Next.js internals and static files.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
