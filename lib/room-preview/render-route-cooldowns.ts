// In-memory dedup Maps for rate-limit warning events emitted from the render
// route. One warning per key per RATE_LIMIT_WARN_COOLDOWN_MS is sufficient
// signal; subsequent rejections within the window are silent.
//
// These are module-level singletons so the dedup state survives across requests
// on the same serverless instance (same behavior as declaring them in route.ts).

export const RATE_LIMIT_WARN_COOLDOWN_MS = 60_000;

export const renderLimitWarnCooldown = new Map<string, number>();
export const deviceCooldownWarnMap   = new Map<string, number>();
export const screenBudgetWarnMap     = new Map<string, number>();

/**
 * Returns `true` when a warning event for `key` should be emitted, and updates
 * the map so the next call within the cooldown window returns `false`.
 *
 * Encodes the repeated dedup pattern:
 *   const last = map.get(key);
 *   if (last === undefined || now - last >= RATE_LIMIT_WARN_COOLDOWN_MS) {
 *     map.set(key, now);
 *     // emit event
 *   }
 */
export function shouldEmitRateLimitEvent(
  map: Map<string, number>,
  key: string,
): boolean {
  const now = Date.now();
  const last = map.get(key);
  if (last === undefined || now - last >= RATE_LIMIT_WARN_COOLDOWN_MS) {
    map.set(key, now);
    return true;
  }
  return false;
}
