import "server-only";

import type { RoomPreviewSession, RoomPreviewSessionEvent } from "@/lib/room-preview/types";
import { isRedisEnabled, isRedisDisabledByFlag, getRedisPublisher, getRedisSubscriber } from "@/lib/redis";
import { getLogger } from "@/lib/logger";

const log = getLogger("session-events");

type SessionEventListener = (event: RoomPreviewSessionEvent) => void;

// ─── Channel naming ──────────────────────────────────────────────────────────

function getSessionChannel(sessionId: string) {
  return `room-preview:session:${sessionId}`;
}

/**
 * Global fan-out channel.
 *
 * Every session event is also published here so that future subscribers
 * (admin dashboard, analytics pipeline, debug tooling) can listen to all
 * activity without knowing individual session IDs in advance.
 *
 * Nothing subscribes to this channel in production yet — it is publish-only
 * and zero-cost when there are no subscribers.
 */
export const GLOBAL_EVENTS_CHANNEL = "room-preview:events";

// ─── In-memory fallback (single server) ──────────────────────────────────────

declare global {
  var roomPreviewSessionEventBus:
    | Map<string, Set<SessionEventListener>>
    | undefined;
}

function getInMemoryBus() {
  if (!globalThis.roomPreviewSessionEventBus) {
    globalThis.roomPreviewSessionEventBus = new Map();
  }
  return globalThis.roomPreviewSessionEventBus;
}

function subscribeInMemory(
  sessionId: string,
  listener: SessionEventListener,
): () => void {
  const bus = getInMemoryBus();
  const listeners = bus.get(sessionId) ?? new Set<SessionEventListener>();

  listeners.add(listener);
  bus.set(sessionId, listeners);

  return () => {
    const currentListeners = bus.get(sessionId);
    if (!currentListeners) return;

    currentListeners.delete(listener);
    if (currentListeners.size === 0) {
      bus.delete(sessionId);
    }
  };
}

function publishInMemory(sessionId: string, event: RoomPreviewSessionEvent) {
  const listeners = getInMemoryBus().get(sessionId);
  if (!listeners || listeners.size === 0) return;

  for (const listener of listeners) {
    listener(event);
  }
}

// ─── Redis Pub/Sub ───────────────────────────────────────────────────────────

function isRoomPreviewSessionEvent(value: unknown): value is RoomPreviewSessionEvent {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.sessionId === "string" &&
    obj.type === "session_updated" &&
    typeof obj.session === "object" &&
    obj.session !== null &&
    typeof (obj.session as Record<string, unknown>).id === "string"
  );
}

// ─── Subscription ref-counting ───────────────────────────────────────────────
//
// The subscriber is a single shared ioredis connection. Calling
// sub.unsubscribe(channel) removes the Redis-level subscription for ALL
// listeners on that channel, not just the caller's. Without ref-counting, if
// two SSE streams open for the same session and one closes, the second stream
// silently stops receiving events.
//
// Rule: subscribe to Redis only when the first listener attaches;
//       unsubscribe from Redis only when the last listener detaches.

const channelRefCount = new Map<string, number>();

// ─── Lightweight deduplication ───────────────────────────────────────────────
//
// Redis pub/sub is at-most-once, so duplicates from the broker are rare.
// The practical risk is application-level double-publish (e.g. publish called
// twice with identical state). We deduplicate on sessionId + session.updatedAt:
// every real state change goes through saveSessionState() which bumps updatedAt,
// so two different events for the same session will always have different keys.
//
// TTL is 10 s — long enough to catch any realistic race, short enough to never
// block a legitimate re-publish of a new state.

const DEDUP_TTL_MS = 10_000;
const seenEventKeys = new Map<string, number>(); // key → expiry epoch ms

function isDuplicateEvent(event: RoomPreviewSessionEvent): boolean {
  const key = `${event.sessionId}:${event.session.updatedAt}`;
  const now = Date.now();

  // Purge stale entries to keep the map bounded.
  for (const [k, expiry] of seenEventKeys) {
    if (expiry < now) seenEventKeys.delete(k);
  }

  if (seenEventKeys.has(key)) return true;
  seenEventKeys.set(key, now + DEDUP_TTL_MS);
  return false;
}

function subscribeRedis(
  sessionId: string,
  listener: SessionEventListener,
  onSubscribeError?: () => void,
): () => void {
  const channel = getSessionChannel(sessionId);
  const sub = getRedisSubscriber();

  // Increment ref count; only issue SUBSCRIBE to Redis on the first listener.
  const refCount = (channelRefCount.get(channel) ?? 0) + 1;
  channelRefCount.set(channel, refCount);

  if (refCount === 1) {
    sub.subscribe(channel).catch((err) => {
      log.error({ err, channel }, "Failed to subscribe to channel");
      onSubscribeError?.();
    });
    log.info({ channel, sessionId }, "Redis: subscribed to channel");
  } else {
    log.info({ channel, sessionId, refCount }, "Redis: reused existing channel subscription");
  }

  const messageHandler = (ch: string, message: string) => {
    if (ch !== channel) return;

    try {
      const parsed: unknown = JSON.parse(message);
      if (!isRoomPreviewSessionEvent(parsed)) {
        log.warn({ channel, parsed }, "Unexpected Redis message shape");
        return;
      }

      if (isDuplicateEvent(parsed)) {
        log.warn({ channel, sessionId, updatedAt: parsed.session.updatedAt }, "Duplicate event suppressed");
        return;
      }

      log.info({ channel, sessionId, eventType: parsed.type }, "Redis event received — forwarding to SSE");
      listener(parsed);
    } catch (err) {
      log.error({ err, channel }, "Failed to parse Redis message");
    }
  };

  sub.on("message", messageHandler);

  return () => {
    sub.off("message", messageHandler);

    const remaining = (channelRefCount.get(channel) ?? 1) - 1;
    if (remaining <= 0) {
      channelRefCount.delete(channel);
      sub.unsubscribe(channel).catch(() => {/* best effort */});
      log.info({ channel, sessionId }, "Redis: unsubscribed from channel (last listener gone)");
    } else {
      channelRefCount.set(channel, remaining);
      log.info({ channel, sessionId, remaining }, "Redis: listener detached, channel kept open");
    }
  };
}

function publishRedis(sessionId: string, event: RoomPreviewSessionEvent) {
  const sessionChannel = getSessionChannel(sessionId);
  const pub = getRedisPublisher();
  const payload = JSON.stringify(event);

  // Publish to the per-session channel (targeted SSE delivery).
  pub.publish(sessionChannel, payload)
    .then((receiverCount) => {
      log.info({ channel: sessionChannel, sessionId, eventType: event.type, receiverCount }, "Redis event published");
    })
    .catch((err) => {
      log.error({ err, channel: sessionChannel }, "Failed to publish to session channel");
    });

  // Also publish to the global fan-out channel (admin dashboard / analytics).
  // Fire-and-forget: global channel failures must never affect session delivery.
  pub.publish(GLOBAL_EVENTS_CHANNEL, payload).catch((err) => {
    log.error({ err, channel: GLOBAL_EVENTS_CHANNEL }, "Failed to publish to global channel");
  });
}

// ─── Public API (auto-selects Redis or memory) ───────────────────────────────

/**
 * Subscribe to session events.
 * Returns an unsubscribe function.
 *
 * - When REDIS_URL is set → uses Redis Pub/Sub (works across multiple servers).
 * - When REDIS_URL is not set → uses in-memory bus (single server only).
 *
 * @param onSubscribeError Called if the Redis subscription itself fails, so the
 *   caller can close its stream and let the client fall back to polling.
 */
export function subscribeToRoomPreviewSessionEvents(
  sessionId: string,
  listener: SessionEventListener,
  onSubscribeError?: () => void,
): () => void {
  if (isRedisEnabled()) {
    return subscribeRedis(sessionId, listener, onSubscribeError);
  }

  if (!isRedisDisabledByFlag()) {
    log.warn(
      { sessionId },
      "Redis not configured — SSE falling back to in-memory bus. " +
      "Events will NOT propagate across serverless instances. Set REDIS_URL.",
    );
  }
  return subscribeInMemory(sessionId, listener);
}

/**
 * Publish a session event.
 *
 * - When REDIS_URL is set → publishes via Redis (all servers receive it).
 * - When REDIS_URL is not set → publishes to in-memory listeners only.
 */
export function publishRoomPreviewSessionEvent(
  sessionId: string,
  payload: {
    session: RoomPreviewSession;
    type: RoomPreviewSessionEvent["type"];
  },
) {
  const event = {
    sessionId,
    type: payload.type,
    session: payload.session,
  } satisfies RoomPreviewSessionEvent;

  if (isRedisEnabled()) {
    publishRedis(sessionId, event);
    return;
  }

  if (!isRedisDisabledByFlag()) {
    log.warn(
      { sessionId, eventType: event.type },
      "Redis not configured — publishing to in-memory bus only. Set REDIS_URL.",
    );
  }
  publishInMemory(sessionId, event);
}
