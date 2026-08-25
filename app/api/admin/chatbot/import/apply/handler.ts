// POST /api/admin/chatbot/import/apply
//
// Admin-only destructive confirmation. The browser re-uploads the same file; it
// never reads or forwards the confirmation token. 3d reads the HttpOnly cookie
// and sends the token server-to-server to FastAPI.
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireAdminResponse } from "@/lib/admin/require-admin";
import { internalAdminFetchJson } from "@/lib/admin/fastapi-internal";
import {
  buildUpstreamImportForm,
  clearConfirmationCookie,
  IMPORT_CONFIRMATION_COOKIE,
  safeApplyResponse,
  validateImportFile,
} from "@/lib/admin/chatbot/import-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = await requireAdminResponse();
  if (denied) return denied;

  const token = (await cookies()).get(IMPORT_CONFIRMATION_COOKIE)?.value;
  if (!token) {
    const response = NextResponse.json({ error: "Import confirmation is not available" }, { status: 400 });
    clearConfirmationCookie(response);
    return response;
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    const response = NextResponse.json({ error: "Invalid multipart form data" }, { status: 400 });
    clearConfirmationCookie(response);
    return response;
  }

  const validation = validateImportFile(formData);
  if (!validation.ok) {
    const response = NextResponse.json({ error: validation.error }, { status: validation.status });
    clearConfirmationCookie(response);
    return response;
  }

  const upstream = await internalAdminFetchJson<Parameters<typeof safeApplyResponse>[0]>(
    "/internal/import/inventory/confirm",
    {
      method: "POST",
      body: buildUpstreamImportForm(validation.file, validation.filename, token),
      timeoutMs: 60_000,
    },
  );

  if (!upstream.ok) {
    const response = NextResponse.json({ error: "Could not apply import" }, { status: 502 });
    clearConfirmationCookie(response);
    return response;
  }

  const response = NextResponse.json(safeApplyResponse(upstream.data), { status: upstream.status });
  clearConfirmationCookie(response);
  return response;
}

