import "server-only";

import { getLogger } from "@/lib/logger";
import { LIVE_STATUSES } from "@/lib/room-preview/session-status";
import { openSessionIssue } from "@/lib/room-preview/session-diagnostics";
import type { SessionIssueType } from "@/lib/room-preview/issue-catalog";
import { prisma } from "@/lib/server/prisma";

const log = getLogger("stuck-detection");

function parseMs(envName: string, fallback: number) {
  const raw = process.env[envName];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const STUCK_SESSION_THRESHOLDS = {
  waitingForMobileMs: parseMs("DIAGNOSTICS_WAITING_FOR_MOBILE_MS", 2 * 60_000),
  mobileNoProgressMs: parseMs("DIAGNOSTICS_MOBILE_NO_PROGRESS_MS", 2 * 60_000),
  roomUploadMs: parseMs("DIAGNOSTICS_ROOM_UPLOAD_STUCK_MS", 90_000),
  renderMs: parseMs("DIAGNOSTICS_RENDER_STUCK_MS", 7 * 60_000),
  activeStatusMs: parseMs("DIAGNOSTICS_ACTIVE_STATUS_STUCK_MS", 10 * 60_000),
};

type EventRow = {
  eventType: string;
  timestamp: Date;
};

function latestEvent(events: EventRow[], eventType: string) {
  return events.find((event) => event.eventType === eventType) ?? null;
}

function hasEventAfter(events: EventRow[], eventTypes: string[], timestamp: Date) {
  return events.some(
    (event) => event.timestamp > timestamp && eventTypes.includes(event.eventType),
  );
}

async function openDetectedIssue(
  sessionId: string,
  type: SessionIssueType,
  metadata: Record<string, unknown>,
) {
  await openSessionIssue({ sessionId, type, metadata });
}

export async function detectStuckSessions(): Promise<number> {
  const now = Date.now();
  let detected = 0;

  try {
    const sessions = await prisma.roomPreviewSession.findMany({
      where: { status: { in: [...LIVE_STATUSES] } },
      orderBy: { updatedAt: "asc" },
      take: 250,
      select: {
        id: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        mobileConnected: true,
        selectedRoom: true,
        selectedProduct: true,
        renderResult: true,
        sessionEvents: {
          orderBy: { timestamp: "desc" },
          take: 120,
          select: { eventType: true, timestamp: true },
        },
      },
    });

    for (const session of sessions) {
      const events = session.sessionEvents;
      const ageSinceUpdatedMs = now - session.updatedAt.getTime();
      const mobileLoaded = latestEvent(events, "mobile_page_loaded");
      const qrOpened = latestEvent(events, "qr_opened");
      const uploadStarted = latestEvent(events, "room_upload_started");
      const renderStarted = latestEvent(events, "render_started");

      if (
        session.status === "waiting_for_mobile" &&
        ageSinceUpdatedMs > STUCK_SESSION_THRESHOLDS.waitingForMobileMs &&
        !mobileLoaded
      ) {
        detected += 1;
        await openDetectedIssue(
          session.id,
          qrOpened ? "QR_OPENED_NO_MOBILE_CONNECT" : "SESSION_STUCK",
          {
            status: session.status,
            thresholdMs: STUCK_SESSION_THRESHOLDS.waitingForMobileMs,
            updatedAt: session.updatedAt.toISOString(),
          },
        );
      }

      if (
        mobileLoaded &&
        now - mobileLoaded.timestamp.getTime() > STUCK_SESSION_THRESHOLDS.mobileNoProgressMs &&
        !hasEventAfter(
          events,
          ["product_selected", "room_upload_started", "room_upload_completed", "render_requested"],
          mobileLoaded.timestamp,
        ) &&
        !session.selectedRoom &&
        !session.selectedProduct
      ) {
        detected += 1;
        await openDetectedIssue(session.id, "MOBILE_OPENED_NO_PROGRESS", {
          mobileLoadedAt: mobileLoaded.timestamp.toISOString(),
          thresholdMs: STUCK_SESSION_THRESHOLDS.mobileNoProgressMs,
        });
      }

      if (
        uploadStarted &&
        now - uploadStarted.timestamp.getTime() > STUCK_SESSION_THRESHOLDS.roomUploadMs &&
        !hasEventAfter(
          events,
          ["room_upload_completed", "room_upload_failed"],
          uploadStarted.timestamp,
        )
      ) {
        detected += 1;
        await openDetectedIssue(session.id, "ROOM_UPLOAD_STUCK", {
          uploadStartedAt: uploadStarted.timestamp.toISOString(),
          thresholdMs: STUCK_SESSION_THRESHOLDS.roomUploadMs,
        });
      }

      if (
        renderStarted &&
        now - renderStarted.timestamp.getTime() > STUCK_SESSION_THRESHOLDS.renderMs &&
        !hasEventAfter(events, ["render_completed", "render_failed", "render_timeout"], renderStarted.timestamp)
      ) {
        detected += 1;
        await openDetectedIssue(session.id, "RENDER_TIMEOUT", {
          renderStartedAt: renderStarted.timestamp.toISOString(),
          thresholdMs: STUCK_SESSION_THRESHOLDS.renderMs,
        });
      }

      if (
        ageSinceUpdatedMs > STUCK_SESSION_THRESHOLDS.activeStatusMs &&
        session.status !== "waiting_for_mobile"
      ) {
        detected += 1;
        await openDetectedIssue(session.id, "SESSION_STUCK", {
          status: session.status,
          thresholdMs: STUCK_SESSION_THRESHOLDS.activeStatusMs,
          updatedAt: session.updatedAt.toISOString(),
        });
      }
    }
  } catch (err) {
    log.warn({ err }, "Failed to detect stuck sessions");
  }

  return detected;
}
