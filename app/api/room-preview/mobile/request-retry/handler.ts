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
import { getSessionById } from "@/lib/room-preview/session-repository";
import { trackSessionEvent } from "@/lib/room-preview/session-diagnostics";
import {
  COMPOSITE_REFERENCE_ORDER,
  getSelectedProductCount,
  getPrimarySelectedProduct,
  getSelectedProductDiagnostics,
  normalizeSelectedProducts,
} from "@/lib/room-preview/selected-products";
import type { RoomPreviewProduct, SelectedProduct } from "@/lib/room-preview/types";

const log = getLogger("mobile-request-retry-api");

export const dynamic = "force-dynamic";

const RequestRetryBodySchema = z.object({
  sessionId: z.string().trim().min(1),
  mode: z.enum(["same_product", "change_product"]).optional().default("same_product"),
  productId: z.string().trim().min(1).optional(),
  barcode: z.string().trim().min(1).optional(),
});

function buildSessionProduct(product: RoomPreviewProduct) {
  return {
    id: product.id,
    barcode: product.barcode,
    name: product.name,
    productType: product.productType,
    category: product.category,
    targetSurface: product.targetSurface,
    imageUrl: product.imageUrl,
  } satisfies SelectedProduct;
}

async function resolveRetryProduct(body: z.infer<typeof RequestRetryBodySchema>) {
  if (body.productId) {
    const product = getRoomPreviewMockProductById(body.productId);
    return product ? buildSessionProduct(product) : null;
  }

  if (body.barcode) {
    const product = getRoomPreviewMockProductByBarcode(body.barcode);
    return product ? buildSessionProduct(product) : null;
  }

  const session = await getSessionById(body.sessionId);
  const selectedProduct = session ? getPrimarySelectedProduct(normalizeSelectedProducts(session)) : null;
  return selectedProduct?.id &&
    selectedProduct.name &&
    selectedProduct.imageUrl &&
    (selectedProduct.productType === "floor_material" ||
      selectedProduct.productType === "wall_material" ||
      selectedProduct.productType === "wall_cladding")
    ? selectedProduct
    : null;
}

export async function POST(request: Request) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, code: "INVALID_JSON", error: "Invalid request body." },
      { status: 400 },
    );
  }

  const parsed = RequestRetryBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        code: "INVALID_RETRY_PAYLOAD",
        error: parsed.error.issues[0]?.message ?? "Invalid retry payload.",
      },
      { status: 400 },
    );
  }

  const body = parsed.data;
  const unauthorized = guardSession(request, body.sessionId);
  if (unauthorized) return unauthorized;

  const product = await resolveRetryProduct(body);
  if (!product) {
    return NextResponse.json(
      { ok: false, code: "PRODUCT_NOT_FOUND", error: "Unknown product id or barcode." },
      { status: 404 },
    );
  }

  const previousSession = await getSessionById(body.sessionId);

  try {
    const { session } = await selectProductForSession(body.sessionId, product);
    const selectedProductsBySurface = normalizeSelectedProducts(session);
    const selectedProductCount = getSelectedProductCount(selectedProductsBySurface);
    const selectedProductDiagnostics = getSelectedProductDiagnostics(selectedProductsBySurface);

    await trackSessionEvent({
      sessionId: body.sessionId,
      source: "mobile",
      eventType: "retry_requested",
      level: "info",
      statusBefore: previousSession?.status,
      statusAfter: session.status,
      metadata: {
        mode: body.mode,
        productId: product.id,
        changedProduct:
          (normalizeSelectedProducts(previousSession ?? { selectedProduct: null })[product.targetSurface ?? "floor"])?.id !==
          product.id,
        renderMode: selectedProductCount === 2 ? "composite" : "single",
        ...(selectedProductCount === 2
          ? {
              referenceOrder: COMPOSITE_REFERENCE_ORDER,
              promptVersion: "parquet-wallpaper-v1",
            }
          : {}),
        ...selectedProductDiagnostics,
      },
    });

    return NextResponse.json({
      ok: true,
      success: true,
      product: session.selectedProduct,
      session,
    });
  } catch (error) {
    if (isRoomPreviewSessionNotFoundError(error)) {
      return NextResponse.json(
        { ok: false, code: error.code, error: error.message },
        { status: 404 },
      );
    }

    if (isRoomPreviewSessionExpiredError(error)) {
      return NextResponse.json(
        { ok: false, code: error.code, error: error.message },
        { status: 410 },
      );
    }

    if (error instanceof RoomPreviewSessionTransitionError) {
      return NextResponse.json(
        { ok: false, code: error.code, error: error.message },
        { status: 400 },
      );
    }

    log.error({ err: error, sessionId: body.sessionId }, "Failed to request retry");
    return NextResponse.json(
      { ok: false, code: "REQUEST_RETRY_FAILED", error: "Failed to request retry." },
      { status: 500 },
    );
  }
}
