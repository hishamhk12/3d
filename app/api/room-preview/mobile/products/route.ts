import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getRoomPreviewMockProducts } from "@/data/room-preview/mock-products";
import { resolveProductByCode } from "@/lib/room-preview/product-resolver";

export async function GET(request: NextRequest) {
  const productCode = request.nextUrl.searchParams.get("code")?.trim();

  if (productCode) {
    const result = await resolveProductByCode(productCode);

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, code: result.code, error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json({
      ok: true,
      product: result.product,
    });
  }

  return NextResponse.json({
    ok: true,
    products: getRoomPreviewMockProducts(),
  });
}
