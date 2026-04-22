import "server-only";

import { prisma } from "@/lib/server/prisma";
import { getLogger } from "@/lib/logger";

const log = getLogger("event-tracker");

export type EventType =
  | "user_entered"
  | "qr_scanned"
  | "room_opened"
  | "render_started"
  | "render_completed"
  | "render_failed";

export interface TrackEventInput {
  userSessionId: string;
  eventType: EventType;
  sessionId?: string;
  renderJobId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Write a tracking event to the database.
 *
 * Never throws — DB errors are logged as warnings and swallowed so analytics
 * failures never affect the caller. Callers should wrap this in `after()` so
 * the write is guaranteed to complete even after the HTTP response is sent.
 */
export async function trackEvent(input: TrackEventInput): Promise<void> {
  try {
    await prisma.event.create({
      data: {
        userSessionId: input.userSessionId,
        eventType: input.eventType,
        sessionId: input.sessionId ?? null,
        renderJobId: input.renderJobId ?? null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        metadata: (input.metadata ?? undefined) as any,
      },
    });
  } catch (err) {
    log.warn({ err, eventType: input.eventType, userSessionId: input.userSessionId },
      "Failed to track event — non-critical, pipeline unaffected",
    );
  }
}

/**
 * Look up the userSessionId attached to a RoomPreviewSession.
 * Returns null if the session does not exist or has no user session bound.
 *
 * Used by route handlers that only have the sessionId available.
 */
export async function getUserSessionIdForSession(
  sessionId: string,
): Promise<string | null> {
  try {
    const row = await prisma.roomPreviewSession.findUnique({
      where: { id: sessionId },
      select: { userSessionId: true },
    });
    return row?.userSessionId ?? null;
  } catch {
    return null;
  }
}
