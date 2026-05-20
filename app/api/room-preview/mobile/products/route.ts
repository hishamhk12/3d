import { NextResponse } from "next/server";
import { getRoomPreviewMockProducts } from "@/data/room-preview/mock-products";

export async function GET() {
  return NextResponse.json({
    ok: true,
    products: getRoomPreviewMockProducts(),
  });
}
