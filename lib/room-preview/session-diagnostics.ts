import "server-only";

import { Prisma } from "@/lib/generated/prisma";
import { getLogger } from "@/lib/logger";
import { SESSION_ISSUE_CATALOG, type SessionIssueStatus, type SessionIssueType } from "@/lib/room-preview/issue-catalog";
import type { RoomPreviewSessionStatus } from "@/lib/room-preview/types";
import { prisma } from "@/lib/server/prisma";

const log = getLogger("session-diagnostics");

export type SessionEventSource = "mobile" | "screen" | "server" | "renderer" | "admin";
export type SessionEventLevel = "info" | "warning" | "error" | "fatal";

type JsonLike = Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined;

function toJsonValue(value: unknown): JsonLike {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

function safeMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getOpenIssueDedupeKey(sessionId: string, type: SessionIssueType) {
  return `${sessionId}:${type}:open`;
}

export async function trackSessionEvent(input: {
  code?: string | null;
  eventType: string;
  level?: SessionEventLevel;
  message?: string | null;
  metadata?: unknown;
  sessionId: string;
  source: SessionEventSource;
  statusAfter?: RoomPreviewSessionStatus | string | null;
  statusBefore?: RoomPreviewSessionStatus | string | null;
  timestamp?: Date;
}): Promise<void> {
  try {
    await prisma.sessionEvent.create({
      data: {
        sessionId: input.sessionId,
        timestamp: input.timestamp,
        source: input.source,
        eventType: input.eventType,
        level: input.level ?? "info",
        statusBefore: input.statusBefore ?? null,
        statusAfter: input.statusAfter ?? null,
        code: input.code ?? null,
        message: input.message ?? null,
        metadata: toJsonValue(input.metadata),
      },
    });
  } catch (err) {
    log.warn(
      {
        err,
        eventType: input.eventType,
        sessionId: input.sessionId,
      },
      "Failed to track session event",
    );
  }
}

export async function openSessionIssue(input: {
  adminMessage?: string;
  customerMessageKey?: string | null;
  metadata?: unknown;
  recommendedAction?: string | null;
  sessionId: string;
  severity?: "warning" | "error" | "fatal";
  type: SessionIssueType;
  userVisible?: boolean;
}): Promise<void> {
  const definition = SESSION_ISSUE_CATALOG[input.type];
  const now = new Date();

  try {
    await prisma.sessionIssue.upsert({
      where: {
        dedupeKey: getOpenIssueDedupeKey(input.sessionId, input.type),
      },
      create: {
        sessionId: input.sessionId,
        issueType: input.type,
        dedupeKey: getOpenIssueDedupeKey(input.sessionId, input.type),
        severity: input.severity ?? definition.severity,
        status: "open",
        userVisible: input.userVisible ?? definition.userVisible,
        customerMessageKey: input.customerMessageKey ?? definition.customerMessageKey,
        adminMessage: input.adminMessage ?? definition.adminMessage,
        recommendedAction: input.recommendedAction ?? definition.recommendedAction,
        firstSeenAt: now,
        lastSeenAt: now,
        count: 1,
        metadata: toJsonValue(input.metadata),
      },
      update: {
        lastSeenAt: now,
        count: { increment: 1 },
        severity: input.severity ?? definition.severity,
        userVisible: input.userVisible ?? definition.userVisible,
        customerMessageKey: input.customerMessageKey ?? definition.customerMessageKey,
        adminMessage: input.adminMessage ?? definition.adminMessage,
        recommendedAction: input.recommendedAction ?? definition.recommendedAction,
        metadata: toJsonValue(input.metadata),
      },
    });

    await trackSessionEvent({
      sessionId: input.sessionId,
      source: "server",
      eventType: "session_issue_opened",
      level: definition.severity === "warning" ? "warning" : "error",
      code: input.type,
      message: input.adminMessage ?? definition.adminMessage,
      metadata: input.metadata,
    });
  } catch (err) {
    log.warn(
      {
        err,
        issueType: input.type,
        sessionId: input.sessionId,
      },
      "Failed to open session issue",
    );
  }
}

export async function resolveSessionIssue(input: {
  metadata?: unknown;
  sessionId: string;
  status?: Extract<SessionIssueStatus, "resolved" | "ignored">;
  type: SessionIssueType;
}): Promise<void> {
  const nextStatus = input.status ?? "resolved";
  const now = new Date();

  try {
    await prisma.sessionIssue.updateMany({
      where: {
        sessionId: input.sessionId,
        issueType: input.type,
        status: "open",
      },
      data: {
        status: nextStatus,
        dedupeKey: null,
        lastSeenAt: now,
        metadata: toJsonValue(input.metadata),
      },
    });

    await trackSessionEvent({
      sessionId: input.sessionId,
      source: "server",
      eventType: "session_issue_resolved",
      level: "info",
      code: input.type,
      message: `${input.type} ${nextStatus}`,
      metadata: input.metadata,
    });
  } catch (err) {
    log.warn(
      {
        err,
        issueType: input.type,
        sessionId: input.sessionId,
      },
      "Failed to resolve session issue",
    );
  }
}

export function diagnosticsErrorMetadata(error: unknown) {
  return {
    message: safeMessage(error),
    name: error instanceof Error ? error.name : typeof error,
  };
}
