// GET /api/admin/chatbot/status - browser-safe admin status snapshot.
//
// Requires the existing 3d admin session, then calls exactly one FastAPI
// internal-admin endpoint server-to-server. The response intentionally contains
// only normalized status, counts, and feature flags. It never returns upstream
// URLs, JWTs, secrets, authorization headers, DB URLs, Python errors, or stacks.
import { NextResponse } from "next/server";
import { requireAdminResponse } from "@/lib/admin/require-admin";
import { internalAdminFetchJson } from "@/lib/admin/fastapi-internal";
import { prisma } from "@/lib/server/prisma";
import { isSellerChatEnabled } from "@/lib/seller/fastapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type NormalizedStatus = "healthy" | "degraded" | "unavailable" | "disabled" | "not_configured";

type FastapiComponent = {
  status?: string;
  ready?: boolean;
  reachable?: boolean;
  configured?: boolean;
};

type FastapiStatusPayload = {
  service?: FastapiComponent;
  database?: FastapiComponent;
  gemini?: FastapiComponent;
  inventory?: FastapiComponent & { rowCount?: number | null };
  imports?: FastapiComponent & { latestSuccessfulImportAt?: string | null };
  dataSource?: string;
  sap?: FastapiComponent;
  features?: {
    sellerChatEnabled?: boolean;
    autocompleteEnabled?: boolean;
    technicalDocumentsEnabled?: boolean;
    voiceEnabled?: boolean;
    webKnowledgeEnabled?: boolean;
  };
};

function normalizeStatus(status: string | undefined, healthyWhen = false): NormalizedStatus {
  if (status === "ready" || status === "healthy" || healthyWhen) return "healthy";
  if (status === "disabled") return "disabled";
  if (status === "not_configured") return "not_configured";
  if (status === "unavailable") return "unavailable";
  return "degraded";
}

function featureStatus(enabled: boolean | null | undefined): NormalizedStatus {
  if (enabled === true) return "healthy";
  if (enabled === false) return "disabled";
  return "unavailable";
}

function unavailablePayload(checkedAt: string, local: LocalStatus, fastapiStatus: NormalizedStatus) {
  return {
    checkedAt,
    fastapi: { status: fastapiStatus, reachable: fastapiStatus !== "unavailable" },
    database: { status: "unavailable" as NormalizedStatus, reachable: null },
    gemini: { status: "unavailable" as NormalizedStatus, configured: null },
    inventory: { status: "unavailable" as NormalizedStatus, rowCount: null },
    imports: { status: "unavailable" as NormalizedStatus, latestSuccessfulImportAt: null },
    dataSource: { status: "degraded" as NormalizedStatus, current: "excel" },
    sap: { status: "not_configured" as NormalizedStatus, configured: false },
    features: {
      sellerChat: {
        status: local.sellerChatEnabled ? "healthy" : "disabled",
        enabled: local.sellerChatEnabled,
      },
      autocomplete: { status: "unavailable" as NormalizedStatus, enabled: null },
      technicalDocuments: { status: "disabled" as NormalizedStatus, enabled: false },
      voice: { status: "disabled" as NormalizedStatus, enabled: false },
      webKnowledge: { status: "disabled" as NormalizedStatus, enabled: false },
    },
    local,
  };
}

type LocalStatus = {
  status: NormalizedStatus;
  sellerCount: number | null;
  showroomCount: number | null;
  sellerChatEnabled: boolean;
};

async function getLocalStatus(): Promise<LocalStatus> {
  const sellerChatEnabled = isSellerChatEnabled();
  try {
    const [sellerCount, showroomCount] = await Promise.all([
      prisma.seller.count(),
      prisma.showroom.count(),
    ]);
    return { status: "healthy", sellerCount, showroomCount, sellerChatEnabled };
  } catch {
    return { status: "degraded", sellerCount: null, showroomCount: null, sellerChatEnabled };
  }
}

export async function GET() {
  const denied = await requireAdminResponse();
  if (denied) return denied;

  const checkedAt = new Date().toISOString();
  const local = await getLocalStatus();
  const upstream = await internalAdminFetchJson<FastapiStatusPayload>(
    "/internal/admin/chatbot-status",
  );

  if (!upstream.ok) {
    const fastapiStatus: NormalizedStatus =
      upstream.status === 401 || upstream.status === 403 || upstream.error.code === "upstream"
        ? "degraded"
        : "unavailable";
    return NextResponse.json(unavailablePayload(checkedAt, local, fastapiStatus));
  }

  const data = upstream.data;
  const sellerChatEnabled = local.sellerChatEnabled;

  return NextResponse.json({
    checkedAt,
    fastapi: {
      status: normalizeStatus(data.service?.status, data.service?.ready === true),
      reachable: data.service?.ready === true,
    },
    database: {
      status: normalizeStatus(data.database?.status, data.database?.reachable === true),
      reachable: data.database?.reachable ?? null,
    },
    gemini: {
      status: normalizeStatus(data.gemini?.status, data.gemini?.configured === true),
      configured: data.gemini?.configured ?? null,
    },
    inventory: {
      status: normalizeStatus(data.inventory?.status),
      rowCount: typeof data.inventory?.rowCount === "number" ? data.inventory.rowCount : null,
    },
    imports: {
      status: normalizeStatus(data.imports?.status),
      latestSuccessfulImportAt:
        typeof data.imports?.latestSuccessfulImportAt === "string"
          ? data.imports.latestSuccessfulImportAt
          : null,
    },
    dataSource: {
      status: data.dataSource === "excel" ? "healthy" : "degraded",
      current: "excel",
    },
    sap: {
      status: "not_configured" as NormalizedStatus,
      configured: false,
    },
    features: {
      sellerChat: { status: sellerChatEnabled ? "healthy" : "disabled", enabled: sellerChatEnabled },
      autocomplete: {
        status: featureStatus(data.features?.autocompleteEnabled),
        enabled: data.features?.autocompleteEnabled ?? null,
      },
      technicalDocuments: {
        status: featureStatus(data.features?.technicalDocumentsEnabled),
        enabled: data.features?.technicalDocumentsEnabled ?? null,
      },
      voice: {
        status: featureStatus(data.features?.voiceEnabled),
        enabled: data.features?.voiceEnabled ?? null,
      },
      webKnowledge: {
        status: featureStatus(data.features?.webKnowledgeEnabled),
        enabled: data.features?.webKnowledgeEnabled ?? null,
      },
    },
    local,
  });
}

