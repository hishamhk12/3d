import { NextResponse } from "next/server";
import { z } from "zod";
import { getLogger } from "@/lib/logger";
import { guardSession } from "@/lib/room-preview/api-guard";
import {
  getRoomPreviewMockProductByBarcode,
  getRoomPreviewMockProductById,
} from "@/data/room-preview/mock-products";
import {
  isRoomPreviewSessionExpiredError,
  isRoomPreviewSessionNotFoundError,
  RoomPreviewSessionTransitionError,
  selectProductForSession,
} from "@/lib/room-preview/session-service";
import { trackSessionEvent } from "@/lib/room-preview/session-diagnostics";
import type { SelectedProduct } from "@/lib/room-preview/types";

const log = getLogger("product-api");

const ProductBodySchema = z
  .object({
    productId: z.string().trim().min(1).optional(),
    barcode:   z.string().trim().min(1).optional(),
  })
  .refine((d) => d.productId != null || d.barcode != null, {
    message: "A product id or barcode is required.",
  });

function buildSessionProduct(product: {
  barcode: string | null;
  id: string;
  imageUrl: string;
  name: string;
  productType: "floor_material";
}) {
  return {
    id: product.id,
    barcode: product.barcode,
    name: product.name,
    productType: product.productType,
    imageUrl: product.imageUrl,
  } satisfies SelectedProduct;
}

export async function POST(
  request: Request,
  context: RouteContext<"/api/room-preview/sessions/[sessionId]/product">,
) {
  const { sessionId } = await context.params;

  const unauthorized = guardSession(request, sessionId);
  if (unauthorized) return unauthorized;

  // ── Parse + validate request body with Zod ────────────────────────────────
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    log.warn({ sessionId }, "Invalid product payload — unparseable JSON");
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = ProductBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    log.warn({ sessionId, issues: parsed.error.issues }, "Invalid product payload");
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid product payload." },
      { status: 400 },
    );
  }

  const { productId: rawProductId, barcode: rawBarcode } = parsed.data;

  let product = null;

  if (rawProductId) {
    product = getRoomPreviewMockProductById(rawProductId);

    if (!product) {
      log.warn({ sessionId, productId: rawProductId }, "Unknown product id");
      return NextResponse.json(
        { code: "PRODUCT_NOT_FOUND", error: "Unknown product id." },
        { status: 404 },
      );
    }
  } else if (rawBarcode) {
    product = getRoomPreviewMockProductByBarcode(rawBarcode);

    if (!product) {
      log.warn({ sessionId, barcode: rawBarcode }, "Invalid barcode");
      return NextResponse.json(
        { code: "PRODUCT_NOT_FOUND", error: "Invalid barcode." },
        { status: 404 },
      );
    }
  } else {
    log.warn({ sessionId }, "Missing product id and barcode");
    return NextResponse.json(
      { error: "A product id or barcode is required." },
      { status: 400 },
    );
  }

  let session = null;

  try {
    session = await selectProductForSession(sessionId, buildSessionProduct(product));
  } catch (error) {
    if (isRoomPreviewSessionNotFoundError(error)) {
      log.warn({ sessionId }, "Product save attempted for missing session");
      return NextResponse.json(
        { code: error.code, error: error.message },
        { status: 404 },
      );
    }

    if (isRoomPreviewSessionExpiredError(error)) {
      log.warn({ sessionId }, "Product save attempted for expired session");
      return NextResponse.json(
        { code: error.code, error: error.message },
        { status: 410 },
      );
    }

    if (error instanceof RoomPreviewSessionTransitionError) {
      log.warn(
        { sessionId, productId: product.id, currentStatus: error.currentStatus },
        "Invalid product selection transition",
      );
      return NextResponse.json(
        { code: error.code, error: error.message },
        { status: 400 },
      );
    }

    log.error({ err: error, sessionId, productId: product.id }, "Session disappeared during product save");
    return NextResponse.json({ error: "Failed to save product." }, { status: 500 });
  }

  if (!session.selectedProduct?.id || !session.selectedProduct.imageUrl) {
    log.error(
      { sessionId, productId: product.id, sessionProduct: session.selectedProduct },
      "Missing product state after save",
    );
    return NextResponse.json({ error: "Failed to save product." }, { status: 500 });
  }

  log.info(
    {
      sessionId,
      productId: session.selectedProduct.id,
      barcode: session.selectedProduct.barcode,
      productType: session.selectedProduct.productType,
      status: session.status,
    },
    "Product saved",
  );

  await trackSessionEvent({
    sessionId,
    source: "server",
    eventType: "product_selected",
    level: "info",
    statusAfter: session.status,
    metadata: {
      productId: session.selectedProduct.id,
      barcode: session.selectedProduct.barcode,
      productType: session.selectedProduct.productType,
    },
  });

  return NextResponse.json({
    success: true,
    product: session.selectedProduct,
    session,
  });
}
