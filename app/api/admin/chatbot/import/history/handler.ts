// GET /api/admin/chatbot/import/history
//
// Protected 3d admin proxy for FastAPI import history. Returns only safe audit
// fields already provided by FastAPI and never exposes upstream URLs, JWTs,
// secrets, DB details, raw errors, or stack traces.
import { NextResponse } from "next/server";
import { requireAdminResponse } from "@/lib/admin/require-admin";
import { internalAdminFetchJson } from "@/lib/admin/fastapi-internal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ImportHistoryItem = {
  timestamp: string | null;
  filename: string | null;
  status: string | null;
  rowsImported: number | null;
  rowsFailed: number | null;
};

type FastapiHistory = {
  status?: string;
  items?: ImportHistoryItem[];
};

function safeItem(item: ImportHistoryItem): ImportHistoryItem {
  return {
    timestamp: typeof item.timestamp === "string" ? item.timestamp : null,
    filename: typeof item.filename === "string" ? item.filename : null,
    status: typeof item.status === "string" ? item.status : null,
    rowsImported: typeof item.rowsImported === "number" ? item.rowsImported : null,
    rowsFailed: typeof item.rowsFailed === "number" ? item.rowsFailed : null,
  };
}

export async function GET() {
  const denied = await requireAdminResponse();
  if (denied) return denied;

  const upstream = await internalAdminFetchJson<FastapiHistory>(
    "/internal/import/inventory/history",
  );

  if (!upstream.ok) {
    return NextResponse.json({
      status: "degraded",
      items: [],
      error: "Import history is temporarily unavailable.",
    });
  }

  return NextResponse.json({
    status: upstream.data.status === "ready" ? "ready" : "degraded",
    items: Array.isArray(upstream.data.items) ? upstream.data.items.map(safeItem) : [],
  });
}
