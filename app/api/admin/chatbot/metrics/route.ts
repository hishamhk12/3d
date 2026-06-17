// GET /api/admin/chatbot/metrics
//
// Protected 3d admin proxy for FastAPI chatbot metrics. FastAPI returns only
// external-seller metadata; this route maps namespaced externalActorId values
// (`3d-seller:<sellerId>`) to safe 3d Seller fields server-side. Unknown/deleted
// sellers remain unavailable and never fail the response.
import { NextResponse } from "next/server";
import { requireAdminResponse } from "@/lib/admin/require-admin";
import { internalAdminFetchJson } from "@/lib/admin/fastapi-internal";
import { prisma } from "@/lib/server/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TopValue = { value: string; count: number };

type FastapiActivity = {
  timestamp: string | null;
  externalActorId: string | null;
  productCode: string | null;
  warehouse: string | null;
  intent: string | null;
};

type FastapiMetrics = {
  status?: string;
  questionsToday?: number;
  questionsThisWeek?: number;
  distinctExternalSellers?: number;
  topProductCodes?: TopValue[];
  topWarehouses?: TopValue[];
  aiVsFallback?: { ai?: number; fallback?: number };
  recentActivity?: FastapiActivity[];
};

type SellerSafe = {
  sellerCode: string | null;
  sellerName: string | null;
  showroomCode: string | null;
  available: boolean;
};

function safeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function safeTop(items: unknown): TopValue[] {
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    const rec = item as { value?: unknown; count?: unknown };
    if (typeof rec.value !== "string") return [];
    return [{ value: rec.value, count: safeNumber(rec.count) }];
  });
}

function sellerIdFromExternalActorId(actorId: string | null | undefined): string | null {
  if (typeof actorId !== "string") return null;
  const prefix = "3d-seller:";
  return actorId.startsWith(prefix) ? actorId.slice(prefix.length) || null : null;
}

async function mapSellers(activity: FastapiActivity[]): Promise<Map<string, SellerSafe>> {
  const ids = Array.from(
    new Set(activity.map((item) => sellerIdFromExternalActorId(item.externalActorId)).filter(Boolean)),
  ) as string[];
  if (ids.length === 0) return new Map();

  try {
    const sellers = await prisma.seller.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        sellerCode: true,
        name: true,
        showroom: { select: { code: true } },
      },
    });
    return new Map(
      sellers.map((seller) => [
        seller.id,
        {
          sellerCode: seller.sellerCode,
          sellerName: seller.name,
          showroomCode: seller.showroom?.code ?? null,
          available: true,
        },
      ]),
    );
  } catch {
    return new Map();
  }
}

function unavailableSeller(): SellerSafe {
  return { sellerCode: null, sellerName: null, showroomCode: null, available: false };
}

export async function GET() {
  const denied = await requireAdminResponse();
  if (denied) return denied;

  const upstream = await internalAdminFetchJson<FastapiMetrics>("/internal/admin/chatbot-metrics");

  if (!upstream.ok) {
    return NextResponse.json({
      status: "degraded",
      questionsToday: 0,
      questionsThisWeek: 0,
      distinctExternalSellers: 0,
      topProductCodes: [],
      topWarehouses: [],
      aiVsFallback: { ai: 0, fallback: 0 },
      recentActivity: [],
      error: "Chatbot metrics are temporarily unavailable.",
    });
  }

  const activity = Array.isArray(upstream.data.recentActivity) ? upstream.data.recentActivity : [];
  const sellerMap = await mapSellers(activity);

  return NextResponse.json({
    status: upstream.data.status === "ready" ? "ready" : "degraded",
    questionsToday: safeNumber(upstream.data.questionsToday),
    questionsThisWeek: safeNumber(upstream.data.questionsThisWeek),
    distinctExternalSellers: safeNumber(upstream.data.distinctExternalSellers),
    topProductCodes: safeTop(upstream.data.topProductCodes),
    topWarehouses: safeTop(upstream.data.topWarehouses),
    aiVsFallback: {
      ai: safeNumber(upstream.data.aiVsFallback?.ai),
      fallback: safeNumber(upstream.data.aiVsFallback?.fallback),
    },
    recentActivity: activity.map((item) => {
      const sellerId = sellerIdFromExternalActorId(item.externalActorId);
      return {
        timestamp: typeof item.timestamp === "string" ? item.timestamp : null,
        externalActorId: typeof item.externalActorId === "string" ? item.externalActorId : null,
        productCode: typeof item.productCode === "string" ? item.productCode : null,
        warehouse: typeof item.warehouse === "string" ? item.warehouse : null,
        intent: typeof item.intent === "string" ? item.intent : null,
        seller: sellerId ? (sellerMap.get(sellerId) ?? unavailableSeller()) : unavailableSeller(),
      };
    }),
  });
}
