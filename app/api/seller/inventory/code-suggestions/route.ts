// GET /api/seller/inventory/code-suggestions?q=... — protected product-code
// autocomplete for the seller-chat composer.
//
// The browser calls ONLY this 3d route; the 3d server mints a short-lived
// external-seller token and calls the existing FastAPI code-suggestions endpoint
// server-to-server. Identity (seller + showroom) comes from the verified session,
// never from the browser — only the typed `q` fragment is read. Returns CODE-ONLY
// items (no stock quantities, no internal URL/JWT/secret).
import { NextResponse } from "next/server";
import { getLogger } from "@/lib/logger";
import { getCurrentSeller } from "@/lib/seller/auth";
import { callFastapiCodeSuggestions, isSellerChatEnabled } from "@/lib/seller/fastapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = getLogger("seller-code-suggestions");

export async function GET(req: Request) {
  if (!isSellerChatEnabled()) {
    log.warn({ errorCategory: "feature_disabled" }, "seller_code_suggestions_503");
    return NextResponse.json({ error: "الخدمة غير متاحة حالياً." }, { status: 503 });
  }

  const seller = await getCurrentSeller();
  if (!seller) {
    return NextResponse.json(
      { error: "يجب تسجيل الدخول للوصول إلى هذه الخدمة." },
      { status: 401 },
    );
  }

  // Only the typed fragment is honoured; any other query param is ignored.
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const suggestions = await callFastapiCodeSuggestions(seller, q);
  return NextResponse.json(suggestions);
}
