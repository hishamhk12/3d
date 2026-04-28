import "server-only";

import { isEffectivelyExpired } from "@/lib/room-preview/session-status";
import { publishRoomPreviewSessionEvent } from "@/lib/room-preview/session-events";
import {
  connectMobileTransition,
  createRoomPreviewSessionState,
  markReadyToRenderTransition,
  RoomPreviewSessionTransitionError,
  selectProductTransition,
  selectRoomTransition,
} from "@/lib/room-preview/session-machine";
import {
  createSession,
  expireSessionById,
  findActiveLiveSessions,
  getSessionById,
  saveSessionState,
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
  const session = await getRequiredRoomPreviewSession(sessionId);
  const nextSession = connectMobileTransition(session);
  return persistTransition(nextSession, session.status);
}

export async function selectRoomForSession(sessionId: string, room: SelectedRoom) {
  const session = await getRequiredRoomPreviewSession(sessionId);
  const nextSession = selectRoomTransition(session, room);
  return persistTransition(nextSession, session.status);
}

export async function selectProductForSession(sessionId: string, product: SelectedProduct) {
  const session = await getRequiredRoomPreviewSession(sessionId);
  const productSelectedSession = selectProductTransition(session, product);
  const persistedSession = await persistTransition(productSelectedSession, session.status);
  return persistedSession;
}

export async function startRenderSession(sessionId: string) {
  const session = await getRequiredRoomPreviewSession(sessionId);
  const readyToRenderSession = markReadyToRenderTransition(session);
  return persistTransition(readyToRenderSession, session.status);
}

export {
  RoomPreviewSessionTransitionError,
};
