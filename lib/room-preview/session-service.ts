import "server-only";

import { isEffectivelyExpired } from "@/lib/room-preview/session-status";
import { publishRoomPreviewSessionEvent } from "@/lib/room-preview/session-events";
import {
  createRoomPreviewSessionState,
  markReadyToRenderTransition,
  RoomPreviewSessionTransitionError,
  selectProductTransition,
  selectRoomTransition,
} from "@/lib/room-preview/session-machine";
import {
  abandonSessionById,
  createSession,
  expireSessionById,
  findActiveLiveSessions,
  getSessionById,
  saveSessionState,
  tryClaimMobileConnection,
} from "@/lib/room-preview/session-repository";
import { findActiveScreenByToken } from "@/lib/room-preview/screen-repository";
import { trackSessionEvent } from "@/lib/room-preview/session-diagnostics";
import { getLogger } from "@/lib/logger";
import type {
  RoomPreviewSession,
  SelectedProduct,
  SelectedRoom,
} from "@/lib/room-preview/types";

const log = getLogger("session-service");

export class RoomPreviewSessionNotFoundError extends Error {
  code = "SESSION_NOT_FOUND" as const;

  constructor(message = "Session not found.") {
    super(message);
    this.name = "RoomPreviewSessionNotFoundError";
  }
}

export function isRoomPreviewSessionNotFoundError(
  error: unknown,
): error is RoomPreviewSessionNotFoundError {
  return error instanceof RoomPreviewSessionNotFoundError;
}

export class RoomPreviewSessionExpiredError extends Error {
  code = "SESSION_EXPIRED" as const;

  constructor(message = "Session expired. Start a new session.") {
    super(message);
    this.name = "RoomPreviewSessionExpiredError";
  }
}

export function isRoomPreviewSessionExpiredError(
  error: unknown,
): error is RoomPreviewSessionExpiredError {
  return error instanceof RoomPreviewSessionExpiredError;
}

const isTimeExpired = isEffectivelyExpired;

async function getRequiredRoomPreviewSession(sessionId: string) {
  const session = await getSessionById(sessionId);

  if (!session) {
    throw new RoomPreviewSessionNotFoundError();
  }

  if (isTimeExpired(session)) {
    throw new RoomPreviewSessionExpiredError();
  }

  return session;
}

async function persistTransition(
  nextSession: RoomPreviewSession,
  statusBefore?: RoomPreviewSession["status"],
) {
  const updatedSession = await saveSessionState({
    id: nextSession.id,
    status: nextSession.status,
    mobileConnected: nextSession.mobileConnected,
    selectedRoom: nextSession.selectedRoom,
    selectedProduct: nextSession.selectedProduct,
    renderResult: nextSession.renderResult,
  });

  publishRoomPreviewSessionEvent(updatedSession.id, {
    type: "session_updated",
    session: updatedSession,
  });

  if (statusBefore && statusBefore !== updatedSession.status) {
    void trackSessionEvent({
      sessionId: updatedSession.id,
      source: "server",
      eventType: "session_status_changed",
      level: "info",
      statusBefore,
      statusAfter: updatedSession.status,
    });
  }

  return updatedSession;
}

export async function createRoomPreviewSession(screenToken?: string) {
  let screenId: string | undefined;

  if (screenToken) {
    const screen = await findActiveScreenByToken(screenToken);
    if (screen) screenId = screen.id;
  }

  if (process.env.ROOM_PREVIEW_SINGLE_SCREEN_MODE === "true") {
    log.info("single_screen_mode_enabled");

    const activeSessions = await findActiveLiveSessions();

    if (activeSessions.length >= 1) {
      const [newest, ...duplicates] = activeSessions;

      if (duplicates.length > 0) {
        await Promise.all(duplicates.map((s) => expireSessionById(s.id)));
        void trackSessionEvent({
          sessionId: newest.id,
          source: "server",
          eventType: "single_screen_duplicates_expired",
          level: "warning",
          metadata: { expiredIds: duplicates.map((s) => s.id), count: duplicates.length },
        });
      }

      void trackSessionEvent({
        sessionId: newest.id,
        source: "server",
        eventType: "single_screen_session_reused",
        level: "info",
        metadata: { status: newest.status, screenId: screenId ?? null },
      });

      return newest;
    }
  }

  const createdState = createRoomPreviewSessionState("pending");
  const savedSession = await createSession(screenId, {
    status: createdState.status,
    mobileConnected: createdState.mobileConnected,
    selectedRoom: createdState.selectedRoom,
    selectedProduct: createdState.selectedProduct,
    renderResult: createdState.renderResult,
  });

  if (process.env.ROOM_PREVIEW_SINGLE_SCREEN_MODE === "true") {
    void trackSessionEvent({
      sessionId: savedSession.id,
      source: "server",
      eventType: "single_screen_session_created",
      level: "info",
      statusAfter: savedSession.status,
      metadata: { screenId: screenId ?? null },
    });
  }

  void trackSessionEvent({
    sessionId: savedSession.id,
    source: "server",
    eventType: "session_created",
    level: "info",
    statusAfter: savedSession.status,
    metadata: { screenId: screenId ?? null },
  });

  return savedSession;
}

export async function getRoomPreviewSession(sessionId: string) {
  const session = await getSessionById(sessionId);
  if (session && isTimeExpired(session)) {
    return { ...session, status: "expired" as const };
  }
  return session;
}

export async function connectMobileToSession(sessionId: string) {
  // Read first to surface NOT_FOUND and EXPIRED before touching the DB.
  const session = await getSessionById(sessionId);

  if (!session) {
    throw new RoomPreviewSessionNotFoundError();
  }

  if (isTimeExpired(session)) {
    throw new RoomPreviewSessionExpiredError();
  }

  // Atomic claim: only one phone can win; concurrent callers get count = 0.
  const claimed = await tryClaimMobileConnection(sessionId);

  if (!claimed) {
    // Re-read to build an accurate error message (status may have changed).
    const current = await getSessionById(sessionId);
    throw new RoomPreviewSessionTransitionError(
      "This session is not waiting for a mobile connection.",
      current?.status ?? session.status,
    );
  }

  // Fetch the committed state to broadcast and return.
  const updatedSession = await getSessionById(sessionId);
  if (!updatedSession) {
    throw new RoomPreviewSessionNotFoundError();
  }

  publishRoomPreviewSessionEvent(updatedSession.id, {
    type: "session_updated",
    session: updatedSession,
  });

  void trackSessionEvent({
    sessionId: updatedSession.id,
    source: "server",
    eventType: "session_status_changed",
    level: "info",
    statusBefore: session.status,
    statusAfter: updatedSession.status,
  });

  return updatedSession;
}

export async function selectRoomForSession(sessionId: string, room: SelectedRoom) {
  const session = await getRequiredRoomPreviewSession(sessionId);
  const nextSession = selectRoomTransition(session, room);
  return persistTransition(nextSession, session.status);
}

export async function selectProductForSession(sessionId: string, product: SelectedProduct) {
  const session = await getRequiredRoomPreviewSession(sessionId);
  const previousProduct = session.selectedProduct;
  const productSelectedSession = selectProductTransition(session, product);
  const persistedSession = await persistTransition(productSelectedSession, session.status);
  return { session: persistedSession, previousProduct };
}

export async function startRenderSession(sessionId: string) {
  const session = await getRequiredRoomPreviewSession(sessionId);
  const readyToRenderSession = markReadyToRenderTransition(session);
  return persistTransition(readyToRenderSession, session.status);
}

export async function abandonRoomPreviewSession(sessionId: string) {
  const session = await getSessionById(sessionId);

  if (!session) {
    throw new RoomPreviewSessionNotFoundError();
  }

  const updatedSession = await abandonSessionById(sessionId);

  publishRoomPreviewSessionEvent(updatedSession.id, {
    type: "session_updated",
    session: updatedSession,
  });

  void trackSessionEvent({
    sessionId: updatedSession.id,
    source: "mobile",
    eventType: "session_abandoned",
    level: "info",
    statusBefore: session.status,
    statusAfter: "expired",
  });

  return updatedSession;
}

export {
  RoomPreviewSessionTransitionError,
};
