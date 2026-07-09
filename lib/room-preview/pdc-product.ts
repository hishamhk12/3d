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
 * Phase-1 category rule: the first character of the SKU decides the product
 * family. Only the first character is case-normalized for the check — the SKU
 * itself must stay untouched because PDC treats SKUs as case-sensitive.
 *
 * Returns null for SKUs outside the supported families; those products must
 * never be saved to a session (UNSUPPORTED_PRODUCT_CATEGORY).
 */
export function classifySkuCategory(sku: string): SkuClassification | null {
  switch (sku.trim().charAt(0).toUpperCase()) {
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
