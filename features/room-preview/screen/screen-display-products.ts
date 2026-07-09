import type {
  RoomPreviewSession,
  SelectedProduct,
  TargetSurface,
} from "@/lib/room-preview/types";

/** Fixed display order: floor first, walls second (future surfaces append here). */
const SURFACE_ORDER = ["floor", "walls"] as const satisfies readonly TargetSurface[];

/**
 * Products the TV screen should display.
 *
 * Uses selectedProductsBySurface when present — every selected product with an
 * id or barcode is listed (a missing imageUrl renders as a placeholder tile,
 * never a hidden card). Falls back to the legacy primary selectedProduct only
 * when the by-surface map is empty, so the screen never shows just the primary
 * product while a second product is selected.
 */
export function getScreenDisplayProducts(
  session: Pick<RoomPreviewSession, "selectedProduct" | "selectedProductsBySurface">,
): SelectedProduct[] {
  const bySurface = session.selectedProductsBySurface;
  const products: SelectedProduct[] = [];

  for (const surface of SURFACE_ORDER) {
    const product = bySurface?.[surface];
    if (product && (product.id || product.barcode)) {
      products.push(product);
    }
  }

  if (products.length > 0) return products;

  const primary = session.selectedProduct;
  return primary && (primary.id || primary.barcode) ? [primary] : [];
}
