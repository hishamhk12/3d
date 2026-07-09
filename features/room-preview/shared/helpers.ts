/**
 * Returns a human-readable label for a product type in the given locale.
 * Shared between the mobile and screen session clients.
 */
export function getProductTypeLabel(productType: string | null, locale: "ar" | "en"): string | null {
  if (productType === "floor_material") {
    return locale === "ar" ? "مادة أرضية" : "Floor material";
  }
  return productType;
}

/**
 * Returns a human-readable label for a product CATEGORY in the given locale.
 *
 * CARPET_TILE is deliberately labelled "بلاطات موكيت" ("carpet tiles") — never
 * "سجادة" (rug/carpet) or "carpet roll" — since the product is modular 50x50cm
 * square tiles, not a roll or a single rug.
 */
export function getProductCategoryLabel(
  category: "PARQUET" | "WALLPAPER" | "CARPET_TILE" | null | undefined,
  locale: "ar" | "en",
): string | null {
  if (category === "PARQUET") return locale === "ar" ? "باركيه" : "Parquet";
  if (category === "WALLPAPER") return locale === "ar" ? "ورق جدران" : "Wallpaper";
  if (category === "CARPET_TILE") return locale === "ar" ? "بلاطات موكيت" : "Carpet Tiles";
  return null;
}
