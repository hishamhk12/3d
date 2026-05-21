import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getRoomPreviewMockProducts } from "@/data/room-preview/mock-products";
import { getQrProductByCode } from "@/lib/room-preview/qr-products";

export async function GET(request: NextRequest) {
  const productCode = request.nextUrl.searchParams.get("code")?.trim();

  if (productCode) {
    const product = getQrProductByCode(productCode);

    if (!product) {
      return NextResponse.json(
        { ok: false, code: "PRODUCT_NOT_FOUND", error: "Product QR code was not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({
      ok: true,
      product,
    });
  }

  return NextResponse.json({
    ok: true,
    products: getRoomPreviewMockProducts(),
  });
}
