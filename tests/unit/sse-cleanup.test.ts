import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import EventEmitter from "node:events";

// ---------------------------------------------------------------------------
// Minimal stubs — we test the cleanup contract, not Redis or Next.js
// ---------------------------------------------------------------------------

// Simulate the Redis subscriber as a plain EventEmitter (same interface for
// .on / .off / .emit that ioredis uses for "message" events).
function makeRedisStub() {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  return emitter;
}

// Simulate subscribeRedis isolated from the rest of the codebase.
// This is a copy of the logic in lib/room-preview/session-events.ts so that
// the test stays unit-level and doesn't need the ioredis / Redis stack.
function makeSubscribeRedis(sub: EventEmitter) {
  const channelRefCount = new Map<string, number>();

  return function subscribeRedis(
    sessionId: string,
    listener: (msg: string) => void,
  ): () => void {
    const channel = `room-preview:session:${sessionId}`;
    const refCount = (channelRefCount.get(channel) ?? 0) + 1;
    channelRefCount.set(channel, refCount);

    const messageHandler = (ch: string, message: string) => {
      if (ch !== channel) return;
      listener(message);
    };

    sub.on("message", messageHandler);

    return () => {
      sub.off("message", messageHandler);
      const remaining = (channelRefCount.get(channel) ?? 1) - 1;
      if (remaining <= 0) {
        channelRefCount.delete(channel);
      } else {
        channelRefCount.set(channel, remaining);
      }
    };
  };
}

// Simulate the ReadableStream start/cancel logic from events/route.ts.
// Returns { stream, abortController } so tests can trigger both cleanup paths.
function makeStream(
  subscribeRedis: ReturnType<typeof makeSubscribeRedis>,
  sessionId: string,
) {
  const abortController = new AbortController();
  const request = { signal: abortController.signal };

  let closeStream: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let unsubscribe: (() => void) | undefined;
      let heartbeat: ReturnType<typeof setInterval> | undefined;

      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          close();
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe?.();
        request.signal.removeEventListener("abort", close);
        try { controller.close(); } catch { /* already closed */ }
      };

      closeStream = close;

      safeEnqueue("connected");

      unsubscribe = subscribeRedis(sessionId, (msg) => safeEnqueue(msg));
      heartbeat = setInterval(() => safeEnqueue("keepalive"), 60_000);
      request.signal.addEventListener("abort", close);
    },
    cancel() {
      closeStream?.();
    },
  });

  return { stream, abortController };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SSE cleanup — listener lifecycle", () => {
  let sub: EventEmitter;
  let subscribeRedis: ReturnType<typeof makeSubscribeRedis>;

  beforeEach(() => {
    sub = makeRedisStub();
    subscribeRedis = makeSubscribeRedis(sub);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("adds exactly one message listener per SSE connection", () => {
    expect(sub.listenerCount("message")).toBe(0);
    const { stream } = makeStream(subscribeRedis, "sess-1");
    expect(sub.listenerCount("message")).toBe(1);
    // Consume the stream so it doesn't leak in the test runner
    stream.cancel();
  });

  it("removes the listener when the stream is cancelled (client disconnect path)", async () => {
    const { stream } = makeStream(subscribeRedis, "sess-2");
    expect(sub.listenerCount("message")).toBe(1);
    await stream.cancel();
    expect(sub.listenerCount("message")).toBe(0);
  });

  it("removes the listener when request.signal aborts (abort path)", async () => {
    const { stream, abortController } = makeStream(subscribeRedis, "sess-3");
    expect(sub.listenerCount("message")).toBe(1);
    abortController.abort();
    // Let microtasks flush
    await Promise.resolve();
    expect(sub.listenerCount("message")).toBe(0);
    stream.cancel(); // idempotent — closed flag prevents double cleanup
  });

  it("double-calling close is idempotent — listener is removed only once", async () => {
    const { stream, abortController } = makeStream(subscribeRedis, "sess-4");
    expect(sub.listenerCount("message")).toBe(1);
    // Trigger both cleanup paths simultaneously
    abortController.abort();
    await stream.cancel();
    expect(sub.listenerCount("message")).toBe(0);
  });

  it("N concurrent connections add N listeners, all removed on cancel", async () => {
    const streams = Array.from({ length: 15 }, (_, i) =>
      makeStream(subscribeRedis, `sess-multi-${i}`),
    );
    expect(sub.listenerCount("message")).toBe(15);

    await Promise.all(streams.map(({ stream }) => stream.cancel()));
    expect(sub.listenerCount("message")).toBe(0);
  });

  it("messages are delivered while stream is open and stopped after close", async () => {
    const received: string[] = [];
    const { stream, abortController } = makeStream(
      (sessionId, listener) => subscribeRedis(sessionId, listener),
      "sess-msg",
    );

    // Tap the stream
    const reader = stream.getReader();

    sub.emit("message", "room-preview:session:sess-msg", "hello");
    sub.emit("message", "room-preview:session:sess-msg", "world");

    // Close
    abortController.abort();
    await Promise.resolve();

    // Any further emits must not reach the listener
    sub.emit("message", "room-preview:session:sess-msg", "ghost");

    // Read what was buffered
    let done = false;
    while (!done) {
      const result = await reader.read();
      done = result.done;
      if (!done && result.value !== "keepalive" && result.value !== "connected") {
        received.push(result.value as string);
      }
    }

    expect(received).toContain("hello");
    expect(received).toContain("world");
    expect(received).not.toContain("ghost");
  });
});
