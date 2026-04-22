import { type NextRequest, NextResponse } from "next/server";
import { getLogger } from "@/lib/logger";
import {
  checkIpRateLimit,
  checkActiveSessionsPerIp,
  registerSessionForIp,
  getClientIp,
} from "@/lib/ip-rate-limit";
import { createRoomPreviewSession } from "@/lib/room-preview/session-service";
import { generateSessionToken } from "@/lib/room-preview/session-token";

const log = getLogger("sessions-api");

/** Max new sessions a single IP may create per window. */
const SESSION_CREATE_LIMIT = 10;
const SESSION_CREATE_WINDOW_SECONDS = 60;

/**
 * Max simultaneously active (non-terminal) sessions allowed per IP.
 * Prevents a single client/venue from holding many open sessions at once,
 * which would waste Gemini quota and DB connections.
 * 5 is generous enough for a venue with multiple screens on the same NAT.
 */
const MAX_ACTIVE_SESSIONS_PER_IP = 5;

export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);

  // ── 1. Rate limit: creation frequency ─────────────────────────────────────
  const rateLimit = await checkIpRateLimit(ip, {
    keyPrefix: "session-create",
    limit: SESSION_CREATE_LIMIT,
    windowSeconds: SESSION_CREATE_WINDOW_SECONDS,
  });

  if (rateLimit.limited) {
    log.warn({ ip }, "Session creation rate limit exceeded");
    return NextResponse.json(
      { error: "Too many requests. Please try again shortly." },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );
  }

  // ── 2. Rate limit: concurrent active sessions per IP ──────────────────────
  const underLimit = await checkActiveSessionsPerIp(ip, MAX_ACTIVE_SESSIONS_PER_IP);

  if (!underLimit) {
    log.warn({ ip, max: MAX_ACTIVE_SESSIONS_PER_IP }, "Active session limit exceeded");
    return NextResponse.json(
      { error: "Too many active sessions from your network. Please wait for existing sessions to expire." },
      { status: 429 },
    );
  }

  // ── 3. Create session ──────────────────────────────────────────────────────
  try {
    const screenToken = request.headers.get("x-screen-token") ?? undefined;
    const session = await createRoomPreviewSession(screenToken);
    const token = generateSessionToken(session.id);

    // Register the session against the IP's active-session tracker.
    // Non-blocking — a failure here does not roll back the created session.
    if (session.expiresAt) {
      await registerSessionForIp(ip, session.id, new Date(session.expiresAt).getTime());
    }

    return NextResponse.json({ ...session, token }, { status: 201 });
  } catch (err) {
    log.error({ err }, "Failed to create session");
    return NextResponse.json(
      { error: "Failed to create session" },
      { status: 500 },
    );
  }
}
