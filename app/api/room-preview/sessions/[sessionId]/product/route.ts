import { NextResponse } from "next/server";
import { z } from "zod";
import { getLogger } from "@/lib/logger";
import { guardSession } from "@/lib/room-preview/api-guard";
import {
  getRoomPreviewMockProductByBarcode,
  getRoomPreviewMockProductById,
} from "@/data/room-preview/mock-products";
import { resolveProductByCode } from "@/lib/room-preview/product-resolver";
import {
  isRoomPreviewSessionExpiredError,
  isRoomPreviewSessionNotFoundError,
  RoomPreviewSessionTransitionError,
  removeProductFromSession,
  selectProductForSession,
} from "@/lib/room-preview/session-service";
import { trackSessionEvent } from "@/lib/room-preview/session-diagnostics";
import {
  getSelectedProductDiagnostics,
  getSelectedProductForSurface,
} from "@/lib/room-preview/selected-products";
import type {
  RoomPreviewProduct,
  RoomPreviewSession,
  SelectedProduct,
  TargetSurface,
} from "@/lib/room-preview/types";

const log = getLogger("product-api");

const ProductBodySchema = z
  .object({
    productId: z.string().trim().min(1).optional(),
    barcode:   z.string().trim().min(1).optional(),
    productCode: z.string().trim().min(1).optional(),
  })
  .refine((d) => d.productId != null || d.barcode != null || d.productCode != null, {
    message: "A product id, barcode, or product code is required.",
  });

const ProductSurfaceSchema = z.enum(["floor", "walls"]);

function buildSessionProduct(product: RoomPreviewProduct) {
  return {
    id: product.id,
    barcode: product.barcode,
    name: product.name,
    productType: product.productType,
    category: product.category,
    targetSurface: product.targetSurface,
    imageUrl: product.imageUrl,
    nameAr: product.nameAr ?? null,
    nameEn: product.nameEn ?? null,
    images: product.images ?? [],
    ecommerceUrl: product.ecommerceUrl ?? null,
    pdcPageUrl: product.pdcPageUrl ?? null,
    source: product.source ?? "local",
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

  const { productId: rawProductId, barcode: rawBarcode, productCode: rawProductCode } = parsed.data;

  const rawCode = rawProductCode ?? rawProductId ?? rawBarcode;
  if (!rawCode) {
    log.warn({ sessionId }, "Missing product id and barcode");
    return NextResponse.json(
      { error: "A product id, barcode, or product code is required." },
      { status: 400 },
    );
  }

  // Dev-only: the product-list fallback UI posts mock product ids/barcodes
  // that only exist in the bundled mock catalog, not in PDC.
  let product: RoomPreviewProduct | null = null;
  if (process.env.NODE_ENV === "development" && !rawProductCode) {
    product =
      (rawProductId ? getRoomPreviewMockProductById(rawProductId) : null) ??
      (rawBarcode ? getRoomPreviewMockProductByBarcode(rawBarcode) : null);
  }

  if (!product) {
    const resolved = await resolveProductByCode(rawCode);

    if (!resolved.ok) {
      log.warn(
        { sessionId, productCode: rawCode, code: resolved.code },
        "Product lookup failed",
      );
      return NextResponse.json(
        { code: resolved.code, error: resolved.error },
        { status: resolved.status },
      );
    }

    product = resolved.product;
  }

  const t0 = Date.now();
  log.info({ sessionId, productId: product.id }, "product_route_received");

  let session: RoomPreviewSession | null = null;
  let previousProduct: SelectedProduct | null = null;
  let previousProductsBySurface: RoomPreviewSession["selectedProductsBySurface"] = undefined;
  const selectedProduct = buildSessionProduct(product);

  try {
    ({ session, previousProduct, previousProductsBySurface } = await selectProductForSession(sessionId, selectedProduct));
    log.info({ sessionId, productId: product.id, ms: Date.now() - t0 }, "product_db_updated");
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

  const savedSurfaceProduct = session
    ? getSelectedProductForSurface(session, selectedProduct.targetSurface ?? "floor")
    : null;

  if (!session || !savedSurfaceProduct?.id || !savedSurfaceProduct.imageUrl) {
    log.error(
      { sessionId, productId: product.id, sessionProduct: session?.selectedProduct, savedSurfaceProduct },
      "Missing product state after save",
    );
    return NextResponse.json({ error: "Failed to save product." }, { status: 500 });
  }

  const selectedProductDiagnostics = getSelectedProductDiagnostics(session.selectedProductsBySurface);

  log.info(
    {
      event: "product_selected_image_url",
      sessionId,
      productId: savedSurfaceProduct.id,
      productImageUrl: savedSurfaceProduct.imageUrl,
      barcode: savedSurfaceProduct.barcode,
      productType: savedSurfaceProduct.productType,
      category: savedSurfaceProduct.category ?? "PARQUET",
      targetSurface: savedSurfaceProduct.targetSurface ?? "floor",
      ...selectedProductDiagnostics,
      status: session.status,
    },
    "Product saved",
  );

  const newProductId = savedSurfaceProduct.id;
  const previousSurfaceProduct =
    previousProductsBySurface?.[savedSurfaceProduct.targetSurface ?? "floor"] ??
    (previousProduct?.targetSurface === savedSurfaceProduct.targetSurface ? previousProduct : null);
  const isSameProduct = previousSurfaceProduct?.id === newProductId;

  // Skip noisy duplicate events when the customer re-taps the same product.
  if (!isSameProduct) {
    const hasExistingProduct = previousSurfaceProduct !== null;
    const eventType = hasExistingProduct ? "product_replaced" : "product_added";

    void trackSessionEvent({
      sessionId,
      source: "server",
      eventType,
      level: "info",
      statusAfter: session.status,
      metadata: {
        productCode: savedSurfaceProduct.id,
        newProductId,
        productImageUrl: savedSurfaceProduct.imageUrl,
        newSku: savedSurfaceProduct.barcode ?? undefined,
        category: savedSurfaceProduct.category ?? "PARQUET",
        targetSurface: savedSurfaceProduct.targetSurface ?? "floor",
        ...selectedProductDiagnostics,
        ...(previousSurfaceProduct !== null && {
          previousProductId: previousSurfaceProduct.id,
          previousSku: previousSurfaceProduct.barcode ?? undefined,
        }),
      },
    });
  }

  return NextResponse.json({
    success: true,
    product: savedSurfaceProduct,
    session,
  });
}

export async function DELETE(
  request: Request,
  context: RouteContext<"/api/room-preview/sessions/[sessionId]/product">,
) {
  const { sessionId } = await context.params;

  const unauthorized = guardSession(request, sessionId);
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  const parsedSurface = ProductSurfaceSchema.safeParse(url.searchParams.get("surface"));
  if (!parsedSurface.success) {
    return NextResponse.json(
      { error: "surface must be either floor or walls." },
      { status: 400 },
    );
  }

  const surface: TargetSurface = parsedSurface.data;

  try {
    const { session, previousProductsBySurface } = await removeProductFromSession(sessionId, surface);
    const selectedProductDiagnostics = getSelectedProductDiagnostics(session.selectedProductsBySurface);
    const removedProduct = previousProductsBySurface?.[surface] ?? null;

    void trackSessionEvent({
      sessionId,
      source: "server",
      eventType: "product_removed",
      level: "info",
      statusAfter: session.status,
      metadata: {
        productCode: removedProduct?.id ?? null,
        targetSurface: surface,
        surface,
        removedProductId: removedProduct?.id ?? null,
        removedSku: removedProduct?.barcode ?? null,
        ...selectedProductDiagnostics,
      },
    });

    return NextResponse.json({
      success: true,
      product: session.selectedProduct,
      session,
    });
  } catch (error) {
    if (isRoomPreviewSessionNotFoundError(error)) {
      return NextResponse.json(
        { code: error.code, error: error.message },
        { status: 404 },
      );
    }

    if (isRoomPreviewSessionExpiredError(error)) {
      return NextResponse.json(
        { code: error.code, error: error.message },
        { status: 410 },
      );
    }

    if (error instanceof RoomPreviewSessionTransitionError) {
      return NextResponse.json(
        { code: error.code, error: error.message },
        { status: 400 },
      );
    }

    log.error({ err: error, sessionId, surface }, "Failed to remove selected product");
    return NextResponse.json({ error: "Failed to remove product." }, { status: 500 });
  }
}
