// POST /api/admin/chatbot/import/cancel - clears pending import confirmation.
import { NextResponse } from "next/server";
import { requireAdminResponse } from "@/lib/admin/require-admin";
import { clearConfirmationCookie } from "@/lib/admin/chatbot/import-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const denied = await requireAdminResponse();
  if (denied) return denied;

  const response = NextResponse.json({ cancelled: true });
  clearConfirmationCookie(response);
  return response;
}

