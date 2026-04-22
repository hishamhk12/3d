import "server-only";

import { randomUUID } from "node:crypto";
import { getRedisClient, isRedisEnabled, isRedisDisabledByFlag } from "@/lib/redis";
import { getLogger } from "@/lib/logger";

const log = getLogger("gemini-semaphore");

// ─── Config ───────────────────────────────────────────────────────────────────

/**
 * Maximum concurrent Gemini API calls across all serverless instances.
 * Default of 8 is conservative for a paid Gemini tier (60 RPM).
 * Set GEMINI_MAX_CONCURRENT in your environment to tune this.
 */
function parseMaxConcurrent(raw: string | undefined, fallback: number): number {
  const n = parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const MAX_CONCURRENT = parseMaxConcurrent(
  process.env.GEMINI_MAX_CONCURRENT,
  8,
);

/**
 * Each slot expires after this many milliseconds if the function is killed
 * before it can release the semaphore. Must exceed maxDuration (300 s).
 */
const SLOT_TTL_MS = 330_000;

const SEMAPHORE_KEY = "render:gemini:active";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GeminiSlot = { slotId: string };

export type AcquireGeminiSlotResult =
  | { acquired: true; slot: GeminiSlot }
  | { acquired: false };

// ─── Lua scripts ─────────────────────────────────────────────────────────────

/**
 * KEYS[1] = semaphore sorted-set key
 * ARGV[1] = max concurrent (integer)
 * ARGV[2] = current time as unix ms (string) — used to purge expired slots
 * ARGV[3] = expiry time as unix ms (string)  — this slot's score
 * ARGV[4] = slot ID (unique string member)
 *
 * Returns 1 if acquired, 0 if at capacity.
 *
 * Uses a ZSET where each member is a slot ID and each score is the expiry
 * timestamp. Expired slots (score ≤ now) are purged on every acquire so the
 * semaphore is self-healing after serverless function crashes.
 */
const ACQUIRE_SCRIPT = `
local key    = KEYS[1]
local max    = tonumber(ARGV[1])
local now    = tonumber(ARGV[2])
local expiry = tonumber(ARGV[3])
local id     = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, '-inf', now)

local count = redis.call('ZCARD', key)
if count >= max then
  return 0
end

redis.call('ZADD', key, expiry, id)
redis.call('EXPIREAT', key, math.ceil(expiry / 1000) + 60)
return 1
`;

/**
 * KEYS[1] = semaphore key
 * ARGV[1] = slot ID to remove
 */
const RELEASE_SCRIPT = `
redis.call('ZREM', KEYS[1], ARGV[1])
return 1
`;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Acquire a Gemini concurrency slot.
 *
 * Returns `{ acquired: true, slot }` on success.
 * Returns `{ acquired: false }` when MAX_CONCURRENT is reached.
 *
 * Always returns `{ acquired: true }` when Redis is unavailable so a Redis
 * outage does not block all rendering (rate limiting becomes best-effort).
 *
 * Call `releaseGeminiSlot(slot)` in a finally block after the Gemini call.
 */
export async function acquireGeminiSlot(): Promise<AcquireGeminiSlotResult> {
  if (!isRedisEnabled()) {
    if (!isRedisDisabledByFlag()) {
      log.warn("Redis not configured — Gemini semaphore skipped. Set REDIS_URL.");
    }
    return { acquired: true, slot: { slotId: "noop" } };
  }

  const slotId = randomUUID();
  const now = Date.now();
  const expiry = now + SLOT_TTL_MS;

  try {
    const redis = getRedisClient();
    const result = await redis.eval(
      ACQUIRE_SCRIPT,
      1,
      SEMAPHORE_KEY,
      String(MAX_CONCURRENT),
      String(now),
      String(expiry),
      slotId,
    );

    if (result === 1) {
      return { acquired: true, slot: { slotId } };
    }

    log.warn({ MAX_CONCURRENT }, "Gemini semaphore at capacity — rejecting render");
    return { acquired: false };
  } catch (err) {
    log.error({ err }, "Gemini semaphore acquire failed — allowing request");
    return { acquired: true, slot: { slotId: "error-bypass" } };
  }
}

/**
 * Release a previously acquired Gemini slot.
 * Safe to call with a no-op slot (returned when Redis is unavailable).
 */
export async function releaseGeminiSlot(slot: GeminiSlot): Promise<void> {
  if (!isRedisEnabled() || slot.slotId === "noop" || slot.slotId === "error-bypass") {
    return;
  }

  try {
    const redis = getRedisClient();
    await redis.eval(RELEASE_SCRIPT, 1, SEMAPHORE_KEY, slot.slotId);
  } catch (err) {
    log.error({ err, slotId: slot.slotId }, "Gemini semaphore release failed — slot will expire via TTL");
  }
}
