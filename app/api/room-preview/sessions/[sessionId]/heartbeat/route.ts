import { type NextRequest, NextResponse } from "next/server";
import { MOBILE_TOKEN_COOKIE, SCREEN_TOKEN_COOKIE } from "@/lib/room-preview/cookies";
import { getBearerSessionToken } from "@/lib/room-preview/api-guard";
import { verifySessionToken } from "@/lib/room-preview/session-token";
import {
  getSessionPresence,
  updateSessionPresence,
} from "@/lib/room-preview/session-repository";
import { trackSessionEvent } from "@/lib/room-preview/session-diagnostics";

type RouteParams = { params: Promise<{ sessionId: string }> };

const TERMINAL_STATUSES = new Set(["expired", "completed"]);
const STALE_THRESHOLD_MS = 75_000;

function getCookieValue(request: NextRequest, name: string): string | null {
  return request.cookies.get(name)?.value ?? null;
}

function resolveSource(
  request: NextRequest,
  sessionId: string,
): "mobile" | "screen" | null {
  const bearerToken = getBearerSessionToken(request);
  const xToken = request.headers.get("x-session-token");
  const mobileToken = getCookieValue(request, MOBILE_TOKEN_COOKIE);
  const screenToken = getCookieValue(request, SCREEN_TOKEN_COOKIE);

  // Bearer and x-session-token are used by mobile non-cookie clients.
  const mobileCandidates = [bearerToken, xToken, mobileToken].filter(Boolean) as string[];
  for (const token of mobileCandidates) {
    if (verifySessionToken(token, sessionId)) return "mobile";
  }
  if (screenToken && verifySessionToken(screenToken, sessionId)) return "screen";

  return null;
}

/**
 * POST /api/room-preview/sessions/[sessionId]/heartbeat
 *
 * Accepted by both the mobile client (rp-mobile-token / x-session-token) and
 * the screen client (rp-screen-token). Updates lastMobileSeenAt or
 * lastScreenSeenAt and emits a presence event only on first ping or after a
 * gap > 75 s (stale reconnect).
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { sessionId } = await params;

  const source = resolveSource(request, sessionId);
  if (!source) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", error: "Valid session token required." },
      { status: 401 },
    );
  }

  const presence = await getSessionPresence(sessionId);
  if (!presence) {
    return NextResponse.json(
      { code: "SESSION_NOT_FOUND", error: "Session not found." },
      { status: 404 },
    );
  }

  if (TERMINAL_STATUSES.has(presence.status)) {
    return NextResponse.json({ ok: false, terminal: true, status: presence.status });
  }

  const lastSeenAt =
    source === "mobile" ? presence.lastMobileSeenAt : presence.lastScreenSeenAt;

  const now = Date.now();
  const isFirstPing = lastSeenAt === null;
  const isReconnect =
    !isFirstPing && now - new Date(lastSeenAt).getTime() > STALE_THRESHOLD_MS;

  await updateSessionPresence(sessionId, source);

  if (isFirstPing || isReconnect) {
    const eventType = isFirstPing
      ? source === "mobile"
        ? "mobile_heartbeat_started"
        : "screen_heartbeat_started"
      : source === "mobile"
        ? "mobile_reconnected"
        : "screen_reconnected";

    void trackSessionEvent({
      sessionId,
      source: "server",
      eventType,
      level: "info",
      metadata: isReconnect
        ? { gapMs: now - new Date(lastSeenAt!).getTime() }
        : undefined,
    });
  }

  return NextResponse.json({ ok: true });
}
