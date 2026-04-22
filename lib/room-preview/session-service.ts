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
  getSessionById,
  saveSessionState,
} from "@/lib/room-preview/session-repository";
import { findActiveScreenByToken } from "@/lib/room-preview/screen-repository";
import type {
  RoomPreviewSession,
  SelectedProduct,
  SelectedRoom,
} from "@/lib/room-preview/types";

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

async function persistTransition(nextSession: RoomPreviewSession) {
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

  return updatedSession;
}

export async function createRoomPreviewSession(screenToken?: string) {
  let screenId: string | undefined;

  if (screenToken) {
    const screen = await findActiveScreenByToken(screenToken);
    if (screen) screenId = screen.id;
  }

  const session = await createSession(screenId);
  const createdState = createRoomPreviewSessionState(session.id);

  return saveSessionState({
    ...session,
    status: createdState.status,
    mobileConnected: createdState.mobileConnected,
    selectedRoom: createdState.selectedRoom,
    selectedProduct: createdState.selectedProduct,
    renderResult: createdState.renderResult,
  });
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
  return persistTransition(nextSession);
}

export async function selectRoomForSession(sessionId: string, room: SelectedRoom) {
  const session = await getRequiredRoomPreviewSession(sessionId);
  const nextSession = selectRoomTransition(session, room);
  return persistTransition(nextSession);
}

export async function selectProductForSession(sessionId: string, product: SelectedProduct) {
  const session = await getRequiredRoomPreviewSession(sessionId);
  const productSelectedSession = selectProductTransition(session, product);
  const persistedSession = await persistTransition(productSelectedSession);
  return persistedSession;
}

export async function startRenderSession(sessionId: string) {
  const session = await getRequiredRoomPreviewSession(sessionId);
  const readyToRenderSession = markReadyToRenderTransition(session);
  return persistTransition(readyToRenderSession);
}

export {
  RoomPreviewSessionTransitionError,
};
