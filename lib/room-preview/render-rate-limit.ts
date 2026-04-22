import "server-only";

import { getLogger } from "@/lib/logger";
import { getRedisClient, isRedisEnabled, isRedisDisabledByFlag } from "@/lib/redis";

const log = getLogger("render-rate-limit");

// ─── Constants ────────────────────────────────────────────────────────────────

/** 5 minutes in seconds — device cooldown TTL */
export const DEVICE_COOLDOWN_SECONDS = 300;

/**
 * Render lock TTL — covers the maximum render duration (maxDuration=300) plus
 * a 30-second buffer so the lock never expires while a legitimate render is
 * still running.
 */
const RENDER_LOCK_TTL_SECONDS = 330;

// ─── Redis key factories ──────────────────────────────────────────────────────

const deviceKey = (deviceId: string) => `device:${deviceId}`;
const renderLockKey = (sessionId: string) => `render-lock:${sessionId}`;

// ─── Types ────────────────────────────────────────────────────────────────────

export type DeviceCooldownResult =
  | { limited: false }
  | { limited: true; ttl: number };

export type RenderLockResult =
  | { acquired: true }
  | { acquired: false };

// ─── Device cooldown ─────────────────────────────────────────────────────────

/**
 * Check whether a device is currently in the 5-minute render cooldown.
 *
 * Falls back to `{ limited: false }` when Redis is not configured so that
 * single-server deployments without Redis still function (rate limiting is
 * best-effort in that case).
 */
export async function checkDeviceCooldown(
  deviceId: string,
): Promise<DeviceCooldownResult> {
  if (!isRedisEnabled()) {
    if (!isRedisDisabledByFlag()) {
      log.warn({ deviceId }, "Redis not configured — device cooldown skipped. Set REDIS_URL.");
    }
    return { limited: false };
  }

  try {
    const redis = getRedisClient();
    const ttl = await redis.ttl(deviceKey(deviceId));

    // ttl > 0  → key exists and has remaining TTL
    // ttl = -1 → key exists with no TTL (should not happen)
    // ttl = -2 → key does not exist
    if (ttl > 0) {
      return { limited: true, ttl };
    }

    return { limited: false };
  } catch (err) {
    // Redis failure must not block the render — log and allow.
    log.error({ err, deviceId }, "Failed to check device cooldown — allowing request");
    return { limited: false };
  }
}

/**
 * Arm the 5-minute cooldown for a device.
 * Called after the render pipeline completes successfully.
 */
export async function setDeviceCooldown(deviceId: string): Promise<void> {
  if (!isRedisEnabled()) return;

  try {
    const redis = getRedisClient();
    await redis.set(deviceKey(deviceId), "1", "EX", DEVICE_COOLDOWN_SECONDS);
  } catch (err) {
    // Non-fatal — worst case the device can render again sooner than expected.
    log.error({ err, deviceId }, "Failed to set device cooldown");
  }
}

// ─── Render lock (idempotency guard) ─────────────────────────────────────────

/**
 * Try to acquire an exclusive render lock for a session using SET NX EX.
 *
 * Prevents duplicate renders caused by button spam or network retries.
 * The lock is released in the route handler's `finally` block, or expires
 * automatically after `RENDER_LOCK_TTL_SECONDS` if the process crashes.
 *
 * Falls back to `{ acquired: true }` when Redis is unavailable — the DB-level
 * `tryClaimRenderingSlot` (status: ready_to_render → rendering) then acts as
 * the sole duplicate-execution guard.
 */
export async function acquireRenderLock(
  sessionId: string,
): Promise<RenderLockResult> {
  if (!isRedisEnabled()) {
    if (!isRedisDisabledByFlag()) {
      log.warn({ sessionId }, "Redis not configured — render lock skipped. Set REDIS_URL.");
    }
    return { acquired: true };
  }

  try {
    const redis = getRedisClient();
    const result = await redis.set(
      renderLockKey(sessionId),
      "1",
      "EX",
      RENDER_LOCK_TTL_SECONDS,
      "NX",
    );

    return result === "OK" ? { acquired: true } : { acquired: false };
  } catch (err) {
    // Redis failure — allow the request; DB-level guard still protects us.
    log.error({ err, sessionId }, "Failed to acquire render lock — allowing request");
    return { acquired: true };
  }
}

/**
 * Release the render lock for a session.
 * Always called in `finally` — safe to call even if no lock was acquired.
 */
export async function releaseRenderLock(sessionId: string): Promise<void> {
  if (!isRedisEnabled()) return;

  try {
    const redis = getRedisClient();
    await redis.del(renderLockKey(sessionId));
  } catch (err) {
    // Non-fatal — the lock expires automatically via TTL.
    log.error({ err, sessionId }, "Failed to release render lock");
  }
}
