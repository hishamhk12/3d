// Canonical normalization for seller and showroom login codes.
//
// Codes are treated as case-insensitive. The canonical form is trimmed and
// uppercased (ASCII). The SAME normalization must be applied both when a seller
// is created and when a code is entered at login, so the unique constraint and
// the lookup always agree. Normalization runs server-side — never rely on the
// UI to normalize.

/** Trim + uppercase a login code into its canonical stored form. */
export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/** Seller code canonical form (alias of normalizeCode for call-site clarity). */
export const normalizeSellerCode = normalizeCode;

/** Showroom code canonical form (alias of normalizeCode for call-site clarity). */
export const normalizeShowroomCode = normalizeCode;

/**
 * A code is acceptable when, after normalization, it is non-empty and contains
 * no internal whitespace. (Real product/showroom codes never contain spaces.)
 */
export function isValidCode(raw: string): boolean {
  const normalized = normalizeCode(raw);
  return normalized.length > 0 && !/\s/.test(normalized);
}
