// GET /api/seller/auth/me — returns the current seller, re-resolved from the 3d
// database via the verified session. Returns only display-safe fields; never the
// password hash, token, tokenVersion, or internal showroom id.
import { NextResponse } from "next/server";
import { getCurrentSeller } from "@/lib/seller/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const seller = await getCurrentSeller();
  if (!seller) {
    return NextResponse.json(
      { error: "يجب تسجيل الدخول للوصول إلى هذه الخدمة." },
      { status: 401 },
    );
  }

  return NextResponse.json({
    seller: {
      id: seller.id,
      name: seller.name,
      sellerCode: seller.sellerCode,
      showroomCode: seller.showroomCode,
    },
  });
}
