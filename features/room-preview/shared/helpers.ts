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
