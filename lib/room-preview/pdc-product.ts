import type { PdcProductResponse } from "@/lib/room-preview/pdc-client";
import type {
  ProductCategory,
  ProductType,
  RoomPreviewProduct,
  TargetSurface,
} from "@/lib/room-preview/types";

export type SkuClassification = {
  category: ProductCategory;
  productType: ProductType;
  targetSurface: TargetSurface;
};

/**
 * Category rule: a fixed SKU prefix decides the product family. Only the
 * comparison is case-normalized (via a local `normalized` copy) — the `sku`
 * value passed in, and the value forwarded to PDC by the caller, must stay
 * untouched because PDC treats SKUs as case-sensitive.
 *
 * "CRP" is checked before the single-character parquet/wallpaper switch so a
 * CRP-prefixed SKU is never mistaken for a "C"-prefixed unsupported family.
 *
 * Returns null for SKUs outside the supported families; those products must
 * never be saved to a session (UNSUPPORTED_PRODUCT_CATEGORY).
 */
export function classifySkuCategory(sku: string): SkuClassification | null {
  const normalized = sku.trim().toUpperCase();

  // Carpet tiles — 50x50cm modular floor tiles, distinct from parquet planks.
  if (normalized.startsWith("CRP")) {
    return { category: "CARPET_TILE", productType: "floor_material", targetSurface: "floor" };
  }

  switch (normalized.charAt(0)) {
    case "P":
      return { category: "PARQUET", productType: "floor_material", targetSurface: "floor" };
    case "W":
      return { category: "WALLPAPER", productType: "wall_material", targetSurface: "walls" };
    default:
      return null;
  }
}

export class PdcProductImageMissingError extends Error {
  constructor(sku: string) {
    super(`Product with SKU "${sku}" has no approved images.`);
    this.name = "PdcProductImageMissingError";
  }
}

/** Preview needs one representative image: prefer PDC's `main`, else the first approved image. */
function pickPreviewImage(images: PdcProductResponse["images"]): string | null {
  const main = images.find((image) => image.type === "main" && image.url);
  if (main) return main.url;
  return images.find((image) => image.url)?.url ?? null;
}

/**
 * Map a PDC API response onto the shape the room-preview flow already uses.
 * Throws {@link PdcProductImageMissingError} when the product has no usable
 * image — a product we cannot preview must not enter the session.
 */
export function mapPdcResponseToProduct(
  response: PdcProductResponse,
  classification: SkuClassification,
): RoomPreviewProduct {
  const imageUrl = pickPreviewImage(response.images ?? []);
  if (!imageUrl) {
    throw new PdcProductImageMissingError(response.sku);
  }

  return {
    id: response.sku,
    barcode: response.sku,
    name: response.product_name_ar || response.product_name_en || response.sku,
    productType: classification.productType,
    category: classification.category,
    targetSurface: classification.targetSurface,
    imageUrl,
    nameAr: response.product_name_ar || null,
    nameEn: response.product_name_en || null,
    images: (response.images ?? [])
      .filter((image) => image.url)
      .map((image) => ({ type: image.type, url: image.url })),
    ecommerceUrl: response.ecommerce_url ?? null,
    pdcPageUrl: response.pdc_page_url ?? null,
    source: "pdc",
  };
}
