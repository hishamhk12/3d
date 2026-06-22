/**
 * Dismisses the mobile soft keyboard by blurring the active text field, if any.
 * A no-op unless a text input, textarea, or select currently holds focus — it
 * never blurs anything else and never touches the wider document. Used at the
 * Room Preview customer-gate → room-upload transition so iPhone Safari closes
 * the keyboard and the next step opens at full viewport height.
 */
export function dismissMobileKeyboard(): void {
  if (typeof document === "undefined") return;
  const active = document.activeElement;
  if (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    active instanceof HTMLSelectElement
  ) {
    active.blur();
  }
}

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
