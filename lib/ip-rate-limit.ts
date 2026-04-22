import "server-only";

import { getLogger } from "@/lib/logger";
import { getRedisClient, isRedisEnabled, isRedisDisabledByFlag } from "@/lib/redis";

const log = getLogger("ip-rate-limit");

// ─── Types ────────────────────────────────────────────────────────────────────

export type RateLimitResult =
  | { limited: false }
  | { limited: true; retryAfterSeconds: number };

// ─── In-memory fallback (single-server best-effort) ───────────────────────────

type InMemoryEntry = { count: number; resetAt: number };

declare global {
  var ipRateLimitStore: Map<string, InMemoryEntry> | undefined;
}

function getInMemoryStore(): Map<string, InMemoryEntry> {
  if (!globalThis.ipRateLimitStore) {
    globalThis.ipRateLimitStore = new Map();
  }
  return globalThis.ipRateLimitStore;
}

function checkInMemory(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const store = getInMemoryStore();
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || entry.resetAt <= now) {
    // First request in this window — open a new window.
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { limited: false };
  }

  if (entry.count >= limit) {
    return {
      limited: true,
      retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000),
    };
  }

  entry.count += 1;
  return { limited: false };
}

// ─── Redis path ───────────────────────────────────────────────────────────────

async function checkRedis(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const redis = getRedisClient();

  // INCR is atomic. If this is the first hit in the window (count === 1),
  // set the expiry. There is a narrow race between INCR and EXPIRE on the
  // very first request of a window, but the worst outcome is a window that
  // never expires — acceptable for a best-effort limiter. A Lua script could
  // close this gap if stricter guarantees are ever needed.
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }

  if (count > limit) {
    const ttl = await redis.ttl(key);
    return {
      limited: true,
      retryAfterSeconds: ttl > 0 ? ttl : windowSeconds,
    };
  }

  return { limited: false };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Check and increment an IP-based fixed-window rate limit counter.
 *
 * - When Redis is available: uses `INCR` + `EXPIRE` — works correctly across
 *   multiple server instances.
 * - When Redis is unavailable: falls back to a process-local in-memory store
 *   (best-effort — not shared between instances, but still blocks local abuse).
 *
 * Always fails open on infrastructure errors so legitimate traffic is never
 * blocked by a Redis outage.
 */
export async function checkIpRateLimit(
  ip: string,
  options: {
    /** Unique prefix for this rate limit bucket (e.g. "session-create"). */
    keyPrefix: string;
    /** Maximum requests allowed within the window. */
    limit: number;
    /** Window duration in seconds. */
    windowSeconds: number;
  },
): Promise<RateLimitResult> {
  const { keyPrefix, limit, windowSeconds } = options;
  const key = `${keyPrefix}:${ip}`;

  if (isRedisEnabled()) {
    const redis = getRedisClient();
    // Skip Redis when the connection is still establishing or has permanently
    // ended — avoids waiting for connectTimeout (5 s) before failing over.
    // "ready" is the only state where commands are guaranteed to succeed.
    if (redis.status === "ready") {
      try {
        return await checkRedis(key, limit, windowSeconds);
      } catch (err) {
        log.error({ err, key }, "Redis rate limit check failed — falling back to in-memory");
      }
    }
  }

  return checkInMemory(key, limit, windowSeconds * 1000);
}

// ─── Active session tracking (ZSET, self-healing) ────────────────────────────

const ACTIVE_SESSION_KEY = (ip: string) => `sessions:active:${ip}`;

/**
 * KEYS[1] = active-session sorted-set for this IP
 * ARGV[1] = max allowed active sessions
 * ARGV[2] = current time as unix ms — used to purge expired entries
 *
 * Returns 1 if under the limit, 0 if at/over the limit.
 * Does NOT add the new session — call registerSessionForIp after DB creation.
 */
const CHECK_ACTIVE_SCRIPT = `
local key = KEYS[1]
local max = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', key, '-inf', now)
local count = redis.call('ZCARD', key)
if count >= max then
  return 0
end
return 1
`;

/**
 * KEYS[1] = active-session sorted-set for this IP
 * ARGV[1] = session ID (ZSET member)
 * ARGV[2] = expiry timestamp as unix ms (ZSET score)
 */
const REGISTER_ACTIVE_SCRIPT = `
local key    = KEYS[1]
local id     = ARGV[1]
local expiry = tonumber(ARGV[2])
redis.call('ZADD', key, expiry, id)
redis.call('EXPIREAT', key, math.ceil(expiry / 1000) + 60)
return 1
`;

/**
 * Check whether an IP is under the active-session limit.
 * Returns true if a new session may be created (under limit).
 * Returns true when Redis is unavailable (fails open).
 */
export async function checkActiveSessionsPerIp(
  ip: string,
  max: number,
): Promise<boolean> {
  if (!isRedisEnabled()) {
    if (!isRedisDisabledByFlag()) {
      log.warn({ ip }, "Redis not configured — active-session limit skipped. Set REDIS_URL to enforce it.");
    }
    return true;
  }

  const redis = getRedisClient();
  if (redis.status !== "ready") return true;

  try {
    const result = await redis.eval(
      CHECK_ACTIVE_SCRIPT,
      1,
      ACTIVE_SESSION_KEY(ip),
      String(max),
      String(Date.now()),
    );
    return result === 1;
  } catch (err) {
    log.error({ err, ip }, "Active session check failed — allowing request");
    return true;
  }
}

/**
 * Register a newly created session against the IP's active-session ZSET.
 * Call this after the session is persisted in the DB.
 * Non-fatal — a missed registration only means the count is slightly low.
 */
export async function registerSessionForIp(
  ip: string,
  sessionId: string,
  expiresAtMs: number,
): Promise<void> {
  if (!isRedisEnabled()) return;

  const redis = getRedisClient();
  if (redis.status !== "ready") return;

  try {
    await redis.eval(
      REGISTER_ACTIVE_SCRIPT,
      1,
      ACTIVE_SESSION_KEY(ip),
      sessionId,
      String(expiresAtMs),
    );
  } catch (err) {
    log.error({ err, ip, sessionId }, "Failed to register active session — count may be low");
  }
}

/**
 * Extract the real client IP from a request's headers.
 *
 * Checks `x-forwarded-for` (set by CDNs and reverse proxies) first, then
 * `x-real-ip` (set by Nginx), then falls back to `"unknown"`.
 *
 * The returned value is used only as a rate-limit key — it is never stored
 * long-term or logged at info level.
 */
export function getClientIp(headers: Headers): string {
  // On Vercel (primary deployment target) the platform prepends the real client
  // IP to x-forwarded-for, making the leftmost entry authoritative even if a
  // client injected fake entries to the right.
  // x-real-ip is an nginx convention; Vercel does not set it and passes any
  // client-supplied value through unchanged, so it must not be trusted first.
  // For full spoofing protection on non-Vercel platforms, replace this with
  // `ipAddress(req)` from @vercel/functions or configure a trusted-proxy depth.
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  const realIp = headers.get("x-real-ip");
  if (realIp?.trim()) return realIp.trim();

  return "unknown";
}
