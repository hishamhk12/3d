import "server-only";

import { prisma } from "@/lib/server/prisma";
import { LIVE_STATUSES } from "@/lib/room-preview/session-status";

export type DiagnosticsSessionFilters = {
  dateFrom?: string;
  dateTo?: string;
  openIssues?: boolean;
  status?: string;
  stuck?: boolean;
};

export type DiagnosticsSessionListItem = {
  createdAt: string;
  currentStep: string;
  durationSeconds: number;
  id: string;
  lastActivity: string;
  openIssueCount: number;
  status: string;
  stuck: boolean;
  updatedAt: string;
};

function safeDate(value: string | undefined, endOfDay = false) {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return undefined;
  if (endOfDay) parsed.setHours(23, 59, 59, 999);
  return parsed;
}

function currentStep(session: {
  mobileConnected: boolean;
  renderResult: unknown;
  selectedProduct: unknown;
  selectedRoom: unknown;
  status: string;
}) {
  if (session.status === "result_ready" || session.renderResult) return "render_completed";
  if (session.status === "rendering" || session.status === "ready_to_render") return "render_started";
  if (session.selectedProduct) return "product_selected";
  if (session.selectedRoom) return "room_uploaded";
  if (session.mobileConnected) return "mobile_connected";
  return "waiting_for_mobile";
}

function durationSeconds(start: Date, end: Date) {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
}

export async function getDiagnosticsSessions(
  filters: DiagnosticsSessionFilters = {},
): Promise<DiagnosticsSessionListItem[]> {
  const createdAt: { gte?: Date; lte?: Date } = {};
  const from = safeDate(filters.dateFrom);
  const to = safeDate(filters.dateTo, true);
  if (from) createdAt.gte = from;
  if (to) createdAt.lte = to;

  const where = {
    ...(Object.keys(createdAt).length > 0 ? { createdAt } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.openIssues ? { sessionIssues: { some: { status: "open" } } } : {}),
    ...(filters.stuck
      ? {
          sessionIssues: {
            some: {
              status: "open",
              issueType: { in: ["SESSION_STUCK", "RENDER_TIMEOUT", "ROOM_UPLOAD_STUCK", "MOBILE_OPENED_NO_PROGRESS", "QR_OPENED_NO_MOBILE_CONNECT"] },
            },
          },
        }
      : {}),
  };

  const rows = await prisma.roomPreviewSession.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 250,
    select: {
      id: true,
      status: true,
      mobileConnected: true,
      selectedRoom: true,
      selectedProduct: true,
      renderResult: true,
      createdAt: true,
      updatedAt: true,
      sessionEvents: {
        orderBy: { timestamp: "desc" },
        take: 1,
        select: { timestamp: true },
      },
      sessionIssues: {
        where: { status: "open" },
        select: { issueType: true },
      },
    },
  });

  const now = new Date();
  return rows.map((row) => {
    const stuck = row.sessionIssues.some((issue) =>
      ["SESSION_STUCK", "RENDER_TIMEOUT", "ROOM_UPLOAD_STUCK", "MOBILE_OPENED_NO_PROGRESS", "QR_OPENED_NO_MOBILE_CONNECT"].includes(issue.issueType),
    );
    const lastActivityDate = row.sessionEvents[0]?.timestamp ?? row.updatedAt;

    return {
      id: row.id,
      status: row.status,
      currentStep: currentStep(row),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      lastActivity: lastActivityDate.toISOString(),
      openIssueCount: row.sessionIssues.length,
      stuck,
      durationSeconds: durationSeconds(row.createdAt, (LIVE_STATUSES as readonly string[]).includes(row.status) ? now : row.updatedAt),
    };
  });
}

function latestBySource(
  events: Array<{ eventType: string; source: string; timestamp: Date; code: string | null; message: string | null }>,
  source: string,
) {
  const event = events.find((row) => row.source === source);
  return event
    ? {
        code: event.code,
        eventType: event.eventType,
        message: event.message,
        timestamp: event.timestamp.toISOString(),
      }
    : null;
}

export async function getSessionDiagnostics(sessionId: string) {
  const session = await prisma.roomPreviewSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      status: true,
      mobileConnected: true,
      selectedRoom: true,
      selectedProduct: true,
      renderResult: true,
      createdAt: true,
      updatedAt: true,
      screenId: true,
      renderJobs: {
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, status: true, createdAt: true, updatedAt: true },
      },
      sessionIssues: {
        orderBy: [{ status: "asc" }, { lastSeenAt: "desc" }],
        take: 100,
        select: {
          id: true,
          issueType: true,
          severity: true,
          status: true,
          userVisible: true,
          customerMessageKey: true,
          adminMessage: true,
          recommendedAction: true,
          firstSeenAt: true,
          lastSeenAt: true,
          count: true,
          metadata: true,
        },
      },
      sessionEvents: {
        orderBy: { timestamp: "asc" },
        take: 300,
        select: {
          id: true,
          timestamp: true,
          source: true,
          eventType: true,
          level: true,
          statusBefore: true,
          statusAfter: true,
          code: true,
          message: true,
          metadata: true,
        },
      },
    },
  });

  if (!session) return null;

  const newestEvents = [...session.sessionEvents].reverse();
  const lastKnownProblem =
    newestEvents.find((event) => event.level === "error" || event.level === "fatal" || event.code)?.code ??
    session.sessionIssues.find((issue) => issue.status === "open")?.issueType ??
    null;

  return {
    summary: {
      id: session.id,
      status: session.status,
      currentStep: currentStep(session),
      productSelected: Boolean(session.selectedProduct),
      roomUploaded: Boolean(session.selectedRoom),
      renderStarted: session.renderJobs.length > 0 || session.status === "ready_to_render" || session.status === "rendering",
      renderCompleted: Boolean(session.renderResult) || session.status === "result_ready" || session.status === "completed",
      screenConnected: Boolean(session.screenId || session.sessionEvents.some((event) => event.source === "screen")),
      mobileConnected: session.mobileConnected || session.sessionEvents.some((event) => event.source === "mobile"),
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    },
    issues: session.sessionIssues.map((issue) => ({
      ...issue,
      firstSeenAt: issue.firstSeenAt.toISOString(),
      lastSeenAt: issue.lastSeenAt.toISOString(),
    })),
    timeline: session.sessionEvents.map((event) => ({
      ...event,
      timestamp: event.timestamp.toISOString(),
    })),
    clientDiagnostics: {
      lastMobileEvent: latestBySource(newestEvents, "mobile"),
      lastScreenEvent: latestBySource(newestEvents, "screen"),
      lastRenderEvent: latestBySource(newestEvents, "renderer"),
      lastKnownProblem,
    },
  };
}
