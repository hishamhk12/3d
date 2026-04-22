import "server-only";

import { Prisma } from "@/lib/generated/prisma";
import { SESSION_EXPIRY_MINUTES } from "@/lib/room-preview/constants";
import {
  ROOM_PREVIEW_SESSION_STATUSES,
  type RoomPreviewRenderResult,
  type RoomPreviewSessionStatus,
  type SelectedProduct,
  type SelectedRoom,
} from "@/lib/room-preview/types";
import {
  isRoomPreviewRenderResult,
  isSelectedProduct,
  isSelectedRoom,
} from "@/lib/room-preview/validators";
import { prisma } from "@/lib/server/prisma";

function buildExpiresAt() {
  const ms = SESSION_EXPIRY_MINUTES * 60 * 1000;
  return new Date(Date.now() + ms);
}

type SessionUpdateData = {
  status?: RoomPreviewSessionStatus;
  mobileConnected?: boolean;
  selectedRoom?: SelectedRoom | null;
  selectedProduct?: SelectedProduct | null;
  renderResult?: RoomPreviewRenderResult | null;
};

function toIsoString(value: Date | string) {
  return typeof value === "string" ? value : value.toISOString();
}

function toSelectedRoom(value: unknown): SelectedRoom | null {
  return isSelectedRoom(value) ? value : null;
}

function toSelectedProduct(value: unknown): SelectedProduct | null {
  return isSelectedProduct(value) ? value : null;
}

function toRenderResult(value: unknown): RoomPreviewRenderResult | null {
  return isRoomPreviewRenderResult(value) ? value : null;
}

function toStatus(raw: string): RoomPreviewSessionStatus {
  if (!(ROOM_PREVIEW_SESSION_STATUSES as readonly string[]).includes(raw)) {
    throw new Error(`Unexpected session status from DB: "${raw}"`);
  }
  return raw as RoomPreviewSessionStatus;
}

function mapSession(session: {
  id: string;
  status: string;
  mobileConnected: boolean;
  selectedRoom: unknown;
  selectedProduct: unknown;
  renderResult: unknown;
  expiresAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}) {
  return {
    id: session.id,
    status: toStatus(session.status),
    mobileConnected: session.mobileConnected,
    selectedRoom: toSelectedRoom(session.selectedRoom),
    selectedProduct: toSelectedProduct(session.selectedProduct),
    renderResult: toRenderResult(session.renderResult),
    expiresAt: session.expiresAt ? toIsoString(session.expiresAt) : null,
    createdAt: toIsoString(session.createdAt),
    updatedAt: toIsoString(session.updatedAt),
  };
}

function toJsonValue(
  value: SelectedRoom | SelectedProduct | RoomPreviewRenderResult | null | undefined,
) {
  if (value === undefined) {
    return undefined;
  }

  return value === null ? Prisma.JsonNull : value;
}

export async function createSession(screenId?: string) {
  const session = await prisma.roomPreviewSession.create({
    data: {
      status: "created",
      mobileConnected: false,
      selectedRoom: Prisma.JsonNull,
      selectedProduct: Prisma.JsonNull,
      renderResult: Prisma.JsonNull,
      expiresAt: buildExpiresAt(),
      ...(screenId ? { screenId } : {}),
    },
  });

  return mapSession(session);
}

/** Return screen-related fields needed for render checks (not part of the public session type). */
export async function getSessionScreenFields(sessionId: string) {
  return prisma.roomPreviewSession.findUnique({
    where: { id: sessionId },
    select: { screenId: true, lastRenderHash: true },
  });
}


export async function getSessionById(id: string) {
  const session = await prisma.roomPreviewSession.findUnique({
    where: { id },
  });

  return session ? mapSession(session) : null;
}

export async function updateSession(id: string, data: SessionUpdateData) {
  const session = await prisma.roomPreviewSession.update({
    where: { id },
    data: {
      status: data.status,
      mobileConnected: data.mobileConnected,
      selectedRoom: toJsonValue(data.selectedRoom),
      selectedProduct: toJsonValue(data.selectedProduct),
      renderResult: toJsonValue(data.renderResult),
    },
  });

  return mapSession(session);
}

export async function saveSessionState(session: {
  id: string;
  status: RoomPreviewSessionStatus;
  mobileConnected: boolean;
  selectedRoom: SelectedRoom | null;
  selectedProduct: SelectedProduct | null;
  renderResult: RoomPreviewRenderResult | null;
}) {
  return updateSession(session.id, {
    status: session.status,
    mobileConnected: session.mobileConnected,
    selectedRoom: session.selectedRoom,
    selectedProduct: session.selectedProduct,
    renderResult: session.renderResult,
  });
}

/**
 * Atomically transitions a session from `ready_to_render` → `rendering`.
 * Returns true if this process won the race, false if the session was already
 * claimed by another process or is in the wrong state.
 */
export async function tryClaimRenderingSlot(sessionId: string): Promise<boolean> {
  const result = await prisma.roomPreviewSession.updateMany({
    where: { id: sessionId, status: "ready_to_render" },
    data: { status: "rendering", updatedAt: new Date() },
  });
  return result.count > 0;
}

/**
 * Atomically increments `renderCount` **only if** the current count is below
 * `maxCount`.  Uses a single conditional UPDATE so there is no TOCTOU window.
 *
 * Returns `{ incremented: true }` when the slot was claimed.
 * Returns `{ incremented: false, currentCount }` when the limit is already
 * reached or the session does not exist.
 */
export async function tryIncrementRenderCount(
  sessionId: string,
  maxCount: number,
): Promise<{ incremented: true } | { incremented: false; currentCount: number }> {
  // $executeRaw returns the number of rows affected.
  const affected: number = await prisma.$executeRaw`
    UPDATE "RoomPreviewSession"
    SET    "renderCount" = "renderCount" + 1,
           "updatedAt"   = now()
    WHERE  id            = ${sessionId}
      AND  "renderCount" < ${maxCount}
  `;

  if (affected > 0) {
    return { incremented: true };
  }

  // Nothing was updated — find out why (limit reached vs. session missing).
  const row = await prisma.roomPreviewSession.findUnique({
    where: { id: sessionId },
    select: { renderCount: true },
  });

  return { incremented: false, currentCount: row?.renderCount ?? 0 };
}

/**
 * Decrements `renderCount` by 1 (clamped at 0).
 * Used to roll back an increment when the render pipeline fails unexpectedly,
 * so the user is not penalised for server-side errors.
 */
export async function decrementRenderCount(sessionId: string): Promise<void> {
  await prisma.roomPreviewSession.updateMany({
    where: { id: sessionId, renderCount: { gt: 0 } },
    data: { renderCount: { decrement: 1 } },
  });
}
