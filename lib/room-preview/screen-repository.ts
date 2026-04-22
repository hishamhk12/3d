import "server-only";

import { getLogger } from "@/lib/logger";
import { getRedisClient, isRedisEnabled } from "@/lib/redis";
import { prisma } from "@/lib/server/prisma";
import { hashScreenToken, isValidScreenTokenFormat } from "@/lib/room-preview/screen-token";

const log = getLogger("screen-repository");

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum gap between renders on the same screen (seconds). */
export const SCREEN_COOLDOWN_SECONDS = 300;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function utcDateString(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function secondsUntilMidnightUTC(): number {
  const midnight = new Date();
  midnight.setUTCHours(24, 0, 0, 0);
  return Math.ceil((midnight.getTime() - Date.now()) / 1000);
}

const screenBudgetKey = (screenId: string, dateStr: string) =>
  `screen-budget:${screenId}:${dateStr}`;

// ─── Types ────────────────────────────────────────────────────────────────────

export type ScreenCooldownResult =
  | { limited: false }
  | { limited: true; retryAfterSeconds: number };

export type ScreenBudgetResult =
  | { allowed: true }
  | { allowed: false; reason: "over_budget" };

// ─── Screen lookup ────────────────────────────────────────────────────────────

/**
 * Verify a screen token and return the matching active screen.
 * Returns null if the token is invalid, malformed, or the screen is inactive.
 */
export async function findActiveScreenByToken(token: string) {
  if (!isValidScreenTokenFormat(token)) return null;

  const hash = hashScreenToken(token);

  const screen = await prisma.screen.findUnique({
    where: { secretHash: hash },
    select: { id: true, name: true, dailyBudget: true, isActive: true, lastRenderAt: true },
  });

  if (!screen?.isActive) return null;
  return screen;
}

/** Get an active screen by its database ID. */
export async function getActiveScreenById(screenId: string) {
  const screen = await prisma.screen.findUnique({
    where: { id: screenId },
    select: { id: true, name: true, dailyBudget: true, isActive: true, lastRenderAt: true },
  });

  if (!screen?.isActive) return null;
  return screen;
}

// ─── Cooldown ─────────────────────────────────────────────────────────────────

/**
 * Check whether the per-render cooldown is still active for a screen.
 * Uses the in-memory `lastRenderAt` value — no extra DB query needed.
 */
export function checkScreenCooldown(lastRenderAt: Date | null): ScreenCooldownResult {
  if (!lastRenderAt) return { limited: false };

  const elapsedSeconds = (Date.now() - lastRenderAt.getTime()) / 1000;
  const remaining = Math.ceil(SCREEN_COOLDOWN_SECONDS - elapsedSeconds);

  return remaining > 0
    ? { limited: true, retryAfterSeconds: remaining }
    : { limited: false };
}

/**
 * Persist the render start time on the screen.
 * Survives Redis restarts because it lives in the DB.
 */
export async function touchScreenLastRenderAt(screenId: string): Promise<void> {
  await prisma.screen.update({
    where: { id: screenId },
    data: { lastRenderAt: new Date() },
  });
}

// ─── Daily budget ─────────────────────────────────────────────────────────────

/**
 * Atomically increment the screen's daily render counter and check it against
 * the configured budget.
 *
 * Redis is the primary store (atomic INCR, TTL to midnight UTC).
 * Falls back to counting today's RenderJobs in PostgreSQL when Redis is down.
 *
 * When this returns `{ allowed: true }` and Redis is available, the counter
 * has already been incremented — call `decrementScreenBudget` on pre-pipeline
 * failure to avoid phantom counts.
 */
export async function checkAndIncrementScreenBudget(
  screenId: string,
  dailyBudget: number,
): Promise<ScreenBudgetResult> {
  const dateStr = utcDateString();
  const key = screenBudgetKey(screenId, dateStr);

  if (isRedisEnabled()) {
    try {
      const redis = getRedisClient();
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, secondsUntilMidnightUTC());
      }
      if (count > dailyBudget) {
        await redis.decr(key);
        return { allowed: false, reason: "over_budget" };
      }
      return { allowed: true };
    } catch (err) {
      log.error({ err, screenId }, "Redis budget check failed — falling back to DB count");
    }
  }

  // DB fallback: count render jobs for this screen's sessions created today.
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const count = await prisma.renderJob.count({
    where: { session: { screenId }, createdAt: { gte: startOfDay } },
  });

  return count >= dailyBudget
    ? { allowed: false, reason: "over_budget" }
    : { allowed: true };
}

/**
 * Decrement the screen's daily Redis counter.
 * Call this to roll back an increment when the render fails before the pipeline starts.
 */
export async function decrementScreenBudget(screenId: string): Promise<void> {
  if (!isRedisEnabled()) return;

  const dateStr = utcDateString();
  const key = screenBudgetKey(screenId, dateStr);

  try {
    const redis = getRedisClient();
    const val = await redis.decr(key);
    if (val < 0) await redis.set(key, "0");
  } catch (err) {
    log.error({ err, screenId }, "Failed to decrement screen budget counter");
  }
}

// ─── Session render hash (dedupe) ─────────────────────────────────────────────

/** Persist the render input hash on the session for future dedupe checks. */
export async function saveSessionRenderHash(
  sessionId: string,
  hash: string,
): Promise<void> {
  await prisma.roomPreviewSession.update({
    where: { id: sessionId },
    data: { lastRenderHash: hash },
  });
}
