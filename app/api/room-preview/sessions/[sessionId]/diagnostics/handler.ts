import { NextResponse } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import { getLogger } from "@/lib/logger";
import { isSessionIssueType } from "@/lib/room-preview/issue-catalog";
import { openSessionIssue, trackSessionEvent } from "@/lib/room-preview/session-diagnostics";
import { getRoomPreviewSession } from "@/lib/room-preview/session-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const log = getLogger("diagnostics-api");

// ─── In-memory guards ─────────────────────────────────────────────────────────
//
// These maps live in module scope so they persist across requests within the
// same Node.js process (dev server, long-lived prod instances).  On serverless
// cold starts each invocation begins fresh, which is fine — the client-side
// 5-second throttle is the primary line of defence; these provide a cheap
// server-side backstop that avoids DB pressure from unexpected bursts.

/** Rate limit: max N events per session per rolling window. */
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;
type RateLimitEntry = { count: number; windowStart: number };
const rateLimitMap = new Map<string, RateLimitEntry>();

/** Per-event dedup: same (sessionId, eventType) within window → drop. */
const DEDUPE_WINDOW_MS = 5_000;
const dedupeMap = new Map<string, number>(); // key → lastSeenMs

/** Session validity cache: avoids a DB round-trip on every POST. */
const SESSION_CACHE_TTL_MS = 30_000;
type SessionValidity = { valid: boolean; checkedAt: number };
const sessionValidityCache = new Map<string, SessionValidity>();

/** Evict stale entries so the maps don't grow unbounded on long-lived servers. */
function evictStaleEntries(now: number) {
  for (const [k, v] of rateLimitMap) {
    if (now - v.windowStart > RATE_LIMIT_WINDOW_MS * 2) rateLimitMap.delete(k);
  }
  for (const [k, ts] of dedupeMap) {
    if (now - ts > DEDUPE_WINDOW_MS * 4) dedupeMap.delete(k);
  }
  for (const [k, v] of sessionValidityCache) {
    if (now - v.checkedAt > SESSION_CACHE_TTL_MS * 2) sessionValidityCache.delete(k);
  }
}

// Run eviction at most once per minute to keep maps lean without blocking requests.
let lastEviction = 0;
function maybeEvict(now: number) {
  if (now - lastEviction > 60_000) {
    lastEviction = now;
    evictStaleEntries(now);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns true if the event should be dropped by the rate limiter.
 * Increments the counter and resets the window when expired.
 */
function isRateLimited(sessionId: string, now: number): boolean {
  const entry = rateLimitMap.get(sessionId);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(sessionId, { count: 1, windowStart: now });
    return false;
  }
  if (entry.count >= RATE_LIMIT_MAX) return true;
  entry.count += 1;
  return false;
}

/**
 * Returns true if the same eventType was already recorded for this session
 * within DEDUPE_WINDOW_MS (fast in-process dedup, mirrors the client throttle).
 */
function isDuplicate(sessionId: string, eventType: string, now: number): boolean {
  const key = `${sessionId}:${eventType}`;
  const last = dedupeMap.get(key);
  if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return true;
  dedupeMap.set(key, now);
  return false;
}

/**
 * Checks session validity via the cache first, falling back to a DB read.
 * Returns a string rejection reason, or null if the session is acceptable.
 */
async function checkSessionValidity(sessionId: string, now: number): Promise<string | null> {
  const cached = sessionValidityCache.get(sessionId);
  if (cached && now - cached.checkedAt < SESSION_CACHE_TTL_MS) {
    return cached.valid ? null : "session_invalid_cached";
  }

  let session;
  try {
    session = await getRoomPreviewSession(sessionId);
  } catch {
    sessionValidityCache.set(sessionId, { valid: false, checkedAt: now });
    return "session_lookup_failed";
  }

  if (!session) {
    sessionValidityCache.set(sessionId, { valid: false, checkedAt: now });
    return "session_not_found";
  }
  if (session.status === "expired") {
    sessionValidityCache.set(sessionId, { valid: false, checkedAt: now });
    return "session_expired";
  }

  sessionValidityCache.set(sessionId, { valid: true, checkedAt: now });
  return null;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const DiagnosticsBodySchema = z.object({
  source: z.enum(["mobile", "screen"]),
  eventType: z.string().trim().min(1).max(120),
  level: z.enum(["info", "warning", "error", "fatal"]).optional(),
  statusBefore: z.string().trim().max(80).nullable().optional(),
  statusAfter: z.string().trim().max(80).nullable().optional(),
  code: z.string().trim().max(120).nullable().optional(),
  message: z.string().trim().max(500).nullable().optional(),
  metadata: z.unknown().optional(),
});

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  const now = Date.now();

  maybeEvict(now);

  // ── 1. Rate limit check (no DB) ───────────────────────────────────────────
  if (isRateLimited(sessionId, now)) {
    log.warn(
      { sessionId, reason: "diagnostics_event_dropped_rate_limit" },
      "Diagnostics rate-limited",
    );
    return NextResponse.json({ ok: true, ignored: true });
  }

  // ── 2. Parse and validate body (no DB) ───────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = DiagnosticsBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid diagnostics payload." }, { status: 400 });
  }

  // ── 3. Per-event dedup (no DB) ────────────────────────────────────────────
  if (isDuplicate(sessionId, parsed.data.eventType, now)) {
    log.debug(
      { sessionId, eventType: parsed.data.eventType, reason: "diagnostics_event_deduped" },
      "Diagnostics deduped",
    );
    return NextResponse.json({ ok: true, ignored: true });
  }

  // ── 4. Session validity (DB, cached 30 s) ─────────────────────────────────
  const invalidReason = await checkSessionValidity(sessionId, now);
  if (invalidReason) {
    log.warn({ sessionId, reason: invalidReason }, "Diagnostics rejected");
    return new NextResponse(null, { status: 204 });
  }

  // ── 5. Persist event — fire-and-forget via after() ────────────────────────
  // The HTTP response is sent immediately; DB writes happen after it's flushed.
  // Diagnostics failures must never affect the customer flow.
  const eventData = parsed.data;
  after(async () => {
    await trackSessionEvent({
      sessionId,
      source: eventData.source,
      eventType: eventData.eventType,
      level: eventData.level,
      statusBefore: eventData.statusBefore,
      statusAfter: eventData.statusAfter,
      code: eventData.code,
      message: eventData.message,
      metadata: eventData.metadata,
    });

    if (eventData.code && isSessionIssueType(eventData.code)) {
      await openSessionIssue({
        sessionId,
        type: eventData.code,
        metadata: {
          source: eventData.source,
          eventType: eventData.eventType,
          ...(typeof eventData.metadata === "object" && eventData.metadata !== null
            ? (eventData.metadata as Record<string, unknown>)
            : {}),
        },
      });
    }
  });

  return NextResponse.json({ ok: true });
}
