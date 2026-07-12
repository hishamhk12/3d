import type { PdcProductResponse } from "@/lib/room-preview/pdc-client";
import {
  getWallCladdingAvailability,
  isAllowedWallCladdingSku,
} from "@/lib/room-preview/wall-cladding-catalog";
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

/** SKU-prefix families that resolve to WALL_CLADDING, checked in this order. */
const WALL_CLADDING_PREFIXES = ["MDF", "PWM", "PWP", "PWW"] as const;

/**
 * Category rule: a fixed SKU prefix decides the product family. Only the
 * comparison is case-normalized (via a local `normalized` copy) — the `sku`
 * value passed in, and the value forwarded to PDC by the caller, must stay
 * untouched because PDC treats SKUs as case-sensitive.
 *
 * Prefix check order (longer/more specific families first, so a shared
 * leading letter never wins by accident):
 *   1. CRP           → CARPET_TILE
 *   2. MDF/PWM/PWP/PWW → WALL_CLADDING, but ONLY when the SKU is also on the
 *      central allowlist (see wall-cladding-catalog.ts) — a matching prefix
 *      alone is not enough, so a future/unrelated MDF/PWM/PWP/PWW SKU from
 *      PDC never enters the flow just because it shares a family prefix with
 *      an approved product. A prefix match that fails the allowlist check
 *      returns null (unsupported) rather than falling through to the generic
 *      "P" branch below — an MDF/PWM/PWP/PWW SKU must never be misclassified
 *      as PARQUET just because it starts with "P".
 *   3. generic "P"   → PARQUET
 *   4. generic "W"   → WALLPAPER
 *
 * Returns null for SKUs outside the supported families (or a WALL_CLADDING
 * family SKU that isn't allowlisted yet); those products must never be saved
 * to a session (UNSUPPORTED_PRODUCT_CATEGORY).
 */
export function classifySkuCategory(sku: string): SkuClassification | null {
  const normalized = sku.trim().toUpperCase();

  // Carpet tiles — 50x50cm modular floor tiles, distinct from parquet planks.
  if (normalized.startsWith("CRP")) {
    return { category: "CARPET_TILE", productType: "floor_material", targetSurface: "floor" };
  }

  // Wall panels & wall cladding — checked before the generic "P" switch so
  // PWM/PWP/PWW SKUs are never mistaken for PARQUET.
  if (WALL_CLADDING_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    if (!isAllowedWallCladdingSku(normalized)) return null;
    return { category: "WALL_CLADDING", productType: "wall_cladding", targetSurface: "walls" };
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

  const availability =
    classification.category === "WALL_CLADDING"
      ? (getWallCladdingAvailability(response.sku) ?? undefined)
      : undefined;

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
    ...(availability ? { availability } : {}),
    pdcPageUrl: response.pdc_page_url ?? null,
    source: "pdc",
  };
}
