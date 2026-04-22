import "server-only";

import Redis from "ioredis";
import { getLogger } from "@/lib/logger";

// ─── Configuration ────────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL;

/**
 * Feature flag: set ENABLE_REDIS=false in .env.local to completely bypass
 * Redis without touching REDIS_URL. All consumers fall back to safe defaults.
 * Default is true (Redis is used whenever REDIS_URL is set).
 */
const REDIS_FLAG_ENABLED = process.env.ENABLE_REDIS !== "false";

if (!REDIS_FLAG_ENABLED && process.env.NODE_ENV === "development") {
  // Single startup notice — consumers are silent when Redis is intentionally off.
  console.debug("[redis] ENABLE_REDIS=false — Redis is disabled. All calls will use safe in-process fallbacks.");
}

/**
 * Whether Redis is available and enabled.
 * Returns false when ENABLE_REDIS=false OR REDIS_URL is not set.
 * All consumers call this before touching any Redis client.
 */
export function isRedisEnabled(): boolean {
  return REDIS_FLAG_ENABLED && Boolean(REDIS_URL);
}

/**
 * True when Redis was explicitly turned off via ENABLE_REDIS=false.
 * Consumers use this to decide whether to log a warning (unexpected
 * unavailability) or stay silent (intentional opt-out).
 */
export function isRedisDisabledByFlag(): boolean {
  return !REDIS_FLAG_ENABLED;
}

// ─── Singleton connections ────────────────────────────────────────────────────

let _pub: Redis | null = null;
let _sub: Redis | null = null;
let _cmd: Redis | null = null;

function warnIfInsecureUpstash(url: string, log: ReturnType<typeof getLogger>) {
  if (url.includes(".upstash.io") && !url.startsWith("rediss://")) {
    log.warn(
      "REDIS_URL connects to Upstash without TLS. " +
      "Connections are unencrypted over the public internet. " +
      "Fix: use rediss://default:<password>@<endpoint>.upstash.io:6380",
    );
  }
}

type ExtraOptions = {
  /**
   * How many times a queued command is retried while the connection is
   * being re-established before throwing MaxRetriesPerRequestError.
   *
   * - pub / sub: keep at null (wait indefinitely — reconnect is handled by
   *   retryStrategy and we want commands to survive brief blips).
   * - cmd: set to 0 so rate-limit / cache commands fail immediately when
   *   Redis is unreachable and the caller can fall back to in-memory.
   */
  maxRetriesPerRequest?: number | null;
};

function createRedisClient(label: string, extra: ExtraOptions = {}): Redis {
  if (!REDIS_URL) {
    throw new Error(`Cannot create Redis ${label} client — REDIS_URL is not configured.`);
  }

  const log = getLogger(`redis:${label}`);

  warnIfInsecureUpstash(REDIS_URL, log);

  const client = new Redis(REDIS_URL, {
    // Fail the TCP handshake quickly so error events fire fast instead of
    // leaving callers hanging for the OS default (often 20-75 s).
    connectTimeout: 5_000,
    maxRetriesPerRequest: extra.maxRetriesPerRequest ?? 3,
    retryStrategy(times) {
      // First 10 attempts: fast backoff (200 ms → 2 s).
      // After that: slow down to once every 30 s to avoid log spam during
      // prolonged Upstash outages (paused database, network partition, etc.).
      const delay = times <= 10 ? Math.min(times * 200, 2_000) : 30_000;
      if (times === 1 || times === 5 || times % 10 === 0) {
        log.warn({ delay, attempt: times }, "Redis unreachable — still retrying…");
      }
      return delay;
    },
    lazyConnect: true,
  });

  // connect  — TCP handshake done, but AUTH/SELECT not yet complete
  client.on("connect", () => {
    log.info("Connected.");
  });

  // ready — AUTH/SELECT complete, client is fully usable
  client.on("ready", () => {
    log.info("Ready.");
  });

  client.on("error", (err) => {
    log.error({ err }, "Connection error");
  });

  // close — TCP connection dropped (reconnect will follow unless end fires)
  client.on("close", () => {
    log.warn("Connection closed.");
  });

  // end — ioredis gave up reconnecting (retryStrategy returned null/undefined)
  // This means the client is permanently dead and must be recreated.
  client.on("end", () => {
    log.error("Connection ended — all reconnection attempts exhausted. Events will not propagate until the process restarts.");
  });

  return client;
}

/**
 * Get the Redis **publisher** client (for sending events).
 * Reuses a singleton connection.
 */
export function getRedisPublisher(): Redis {
  if (!_pub) {
    _pub = createRedisClient("pub");
    _pub.connect().catch(() => {/* handled by error event */});
  }
  return _pub;
}

/**
 * Get the Redis **subscriber** client (for receiving events).
 * This is a dedicated connection — ioredis requires a separate client for subscriptions.
 * ioredis auto-resubscribes to all channels on reconnection by default (autoResubscribe: true).
 */
export function getRedisSubscriber(): Redis {
  if (!_sub) {
    _sub = createRedisClient("sub");
    // Each concurrent SSE stream adds one "message" listener to this shared
    // connection. Node's default cap is 10 — remove it so legitimate concurrent
    // connections don't trigger MaxListenersExceededWarning.
    _sub.setMaxListeners(0);
    _sub.connect().catch(() => {/* handled by error event */});
  }
  return _sub;
}

/**
 * Get the Redis **general-purpose** client (for rate limiting, locks, caching).
 * Separate from pub/sub connections — subscribe mode blocks all other commands.
 *
 * maxRetriesPerRequest: 0 — commands fail immediately when the connection is
 * down so callers (rate limiter, semaphore) can fall back to their in-memory
 * implementation without blocking the request for seconds.
 */
export function getRedisClient(): Redis {
  if (!_cmd) {
    _cmd = createRedisClient("cmd", { maxRetriesPerRequest: 0 });
    _cmd.connect().catch(() => {/* handled by error event */});
  }
  return _cmd;
}

/**
 * Gracefully close Redis connections (for cleanup/shutdown).
 */
export async function closeRedisConnections(): Promise<void> {
  const promises: Promise<void>[] = [];

  if (_pub) {
    promises.push(_pub.quit().then(() => { _pub = null; }));
  }

  if (_sub) {
    promises.push(_sub.quit().then(() => { _sub = null; }));
  }

  if (_cmd) {
    promises.push(_cmd.quit().then(() => { _cmd = null; }));
  }

  await Promise.allSettled(promises);
}
