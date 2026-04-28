import { after, NextResponse } from "next/server";
import { guardSession } from "@/lib/room-preview/api-guard";
import { products } from "@/data/products";
import {
  isRoomPreviewSessionExpiredError,
  isRoomPreviewSessionNotFoundError,
  RoomPreviewSessionTransitionError,
  selectProductForSession,
  startRenderSession,
} from "@/lib/room-preview/session-service";
import { executeRenderPipeline } from "@/lib/room-preview/render-service";
import { trackSessionEvent } from "@/lib/room-preview/session-diagnostics";
import type { SelectedProduct } from "@/lib/room-preview/types";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: RouteContext<"/api/room-preview/sessions/[sessionId]/test-render">,
) {
  const { sessionId } = await context.params;

  const unauthorized = guardSession(request, sessionId);
  if (unauthorized) return unauthorized;

  await trackSessionEvent({
    sessionId,
    source: "server",
    eventType: "render_requested",
    level: "info",
    metadata: { testRender: true },
  });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const productCode =
    typeof body === "object" && body !== null && "productCode" in body
      ? String((body as Record<string, unknown>).productCode)
      : null;

  if (!productCode) {
    return NextResponse.json({ error: "productCode is required." }, { status: 400 });
  }

  const product = products.find((p) => p.code === productCode);
  if (!product) {
    return NextResponse.json({ error: `Unknown product code: ${productCode}` }, { status: 404 });
  }

  const selectedProduct: SelectedProduct = {
    id: product.code,
    barcode: null,
    name: product.name,
    productType: "floor_material",
    imageUrl: product.image,
  };

  try {
    await selectProductForSession(sessionId, selectedProduct);
    const session = await startRenderSession(sessionId);

    after(async () => {
      await executeRenderPipeline(sessionId);
    });

    return NextResponse.json(session, { status: 202 });
  } catch (error) {
    if (isRoomPreviewSessionNotFoundError(error)) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: 404 });
    }
    if (isRoomPreviewSessionExpiredError(error)) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: 410 });
    }
    if (error instanceof RoomPreviewSessionTransitionError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to start render." }, { status: 500 });
  }
}
