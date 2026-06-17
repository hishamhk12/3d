// POST /api/admin/chatbot/import/preview
//
// Admin-only BFF endpoint for the safe two-step inventory import. The browser
// uploads to 3d only; 3d forwards server-to-server to FastAPI with the internal
// admin JWT. The FastAPI confirmation token is stored only in an HttpOnly cookie.
import { NextResponse } from "next/server";
import { requireAdminResponse } from "@/lib/admin/require-admin";
import { internalAdminFetchJson } from "@/lib/admin/fastapi-internal";
import {
  buildUpstreamImportForm,
  clearConfirmationCookie,
  safePreviewResponse,
  setConfirmationCookie,
  validateImportFile,
} from "@/lib/admin/chatbot/import-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = await requireAdminResponse();
  if (denied) return denied;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart form data" }, { status: 400 });
  }

  const validation = validateImportFile(formData);
  if (!validation.ok) {
    const response = NextResponse.json({ error: validation.error }, { status: validation.status });
    clearConfirmationCookie(response);
    return response;
  }

  const upstream = await internalAdminFetchJson<{
    confirmation?: { token?: unknown } | null;
  } & Parameters<typeof safePreviewResponse>[0]>("/internal/import/inventory/preview", {
    method: "POST",
    body: buildUpstreamImportForm(validation.file, validation.filename),
    timeoutMs: 30_000,
  });

  if (!upstream.ok) {
    const response = NextResponse.json({ error: "Could not preview import" }, { status: 502 });
    clearConfirmationCookie(response);
    return response;
  }

  const safe = safePreviewResponse(upstream.data);
  const response = NextResponse.json(safe);
  const token = upstream.data.confirmation?.token;
  if (typeof token === "string" && token) {
    setConfirmationCookie(response, token);
  } else {
    clearConfirmationCookie(response);
  }
  return response;
}

