import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getLogger } from "@/lib/logger";
import { ROOM_PREVIEW_TIMEOUTS } from "@/lib/room-preview/constants";
import { SCREEN_TOKEN_COOKIE } from "@/lib/room-preview/cookies";
import { verifySessionToken } from "@/lib/room-preview/session-token";
import { getRoomPreviewSession } from "@/lib/room-preview/session-service";
import { subscribeToRoomPreviewSessionEvents } from "@/lib/room-preview/session-events";

const log = getLogger("events-api");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const encoder = new TextEncoder();

function createSseMessage(eventName: string, data: string) {
  return encoder.encode(`event: ${eventName}\ndata: ${data}\n\n`);
}

function createSseComment(comment: string) {
  return encoder.encode(`: ${comment}\n\n`);
}

function createSseRetry(ms: number) {
  return encoder.encode(`retry: ${ms}\n\n`);
}

export async function GET(
  request: Request,
  context: RouteContext<"/api/room-preview/sessions/[sessionId]/events">,
) {
  const { sessionId } = await context.params;

  // EventSource cannot send custom headers, so the screen client sends the
  // token via the HttpOnly `rp-screen-token` cookie instead. Accept either
  // transport: header (API / mobile clients) or cookie (screen EventSource).
  const headerToken = request.headers.get("x-session-token");
  const cookieStore = await cookies();
  const cookieToken = cookieStore.get(SCREEN_TOKEN_COOKIE)?.value ?? null;
  const token = headerToken ?? cookieToken;

  if (!token || !verifySessionToken(token, sessionId)) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", error: "Invalid session token." },
      { status: 401 },
    );
  }

  const session = await getRoomPreviewSession(sessionId);

  if (!session) {
    return NextResponse.json(
      {
        code: "SESSION_NOT_FOUND",
        error: "Session not found.",
      },
      { status: 404 },
    );
  }

  // Shared reference so the ReadableStream cancel() hook can trigger cleanup
  // even when request.signal doesn't fire (which happens in some Next.js
  // disconnect paths).
  let closeStream: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      // Declare before close() so there is no temporal dead zone if close()
      // is invoked early (e.g. safeEnqueue throws on the initial messages).
      let unsubscribe: (() => void) | undefined;
      let heartbeat: ReturnType<typeof setInterval> | undefined;

      const safeEnqueue = (chunk: Uint8Array) => {
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

        log.info({ sessionId }, "SSE stream closed — all listeners removed");

        try {
          controller.close();
        } catch {
          // Stream may already be closed during disconnect.
        }
      };

      // Expose for the cancel() hook below.
      closeStream = close;

      safeEnqueue(createSseComment("connected"));
      // Tell the browser to reconnect after exactly 3 s on any disconnect.
      // Without this the reconnect delay is browser-defined (Chrome: 3 s,
      // others: up to 30 s), which causes a silent stale-state window on
      // the showroom TV when WiFi drops momentarily.
      safeEnqueue(createSseRetry(3000));
      safeEnqueue(
        createSseMessage(
          "session_updated",
          JSON.stringify({
            sessionId,
            type: "session_updated",
            session,
          }),
        ),
      );

      unsubscribe = subscribeToRoomPreviewSessionEvents(
        sessionId,
        (event) => {
          safeEnqueue(createSseMessage(event.type, JSON.stringify(event)));
        },
        () => {
          // Redis subscription failed — close the stream so the client's
          // onerror fires and it falls back to polling.
          log.error({ sessionId }, "Redis subscription failed — closing SSE stream");
          close();
        },
      );

      heartbeat = setInterval(() => {
        safeEnqueue(createSseComment("keepalive"));
      }, ROOM_PREVIEW_TIMEOUTS.SSE_KEEPALIVE_MS);

      request.signal.addEventListener("abort", close);
    },

    cancel() {
      // Fires when the ReadableStream is cancelled — this is a second cleanup
      // path that catches disconnects Next.js doesn't surface via request.signal.
      // The closed flag inside close() prevents double-cleanup.
      closeStream?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no",
    },
  });
}
