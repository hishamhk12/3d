import wallCladdingAllowlistJson from "@/data/room-preview/wall-cladding-sku-allowlist.json";

/**
 * Commercial availability of a WALL_CLADDING SKU. Display/filtering only —
 * never read by a render strategy or the Gemini pipeline.
 */
export type WallCladdingAvailability = "regular" | "clearance";

/**
 * Single source of truth for which WALL_CLADDING SKUs are currently allowed
 * into the room-preview flow, and their commercial status.
 *
 * WALL_CLADDING is resolved by SKU-prefix family (MDF / PWM / PWP / PWW — see
 * classifySkuCategory in pdc-product.ts), but a matching prefix alone is not
 * enough: only the SKUs listed in
 * data/room-preview/wall-cladding-sku-allowlist.json are accepted right now,
 * so an unrelated future MDF/PWM/PWP/PWW SKU from PDC never enters the flow
 * by accident just because it shares a prefix with an approved product.
 *
 * Do not duplicate this list in components or render strategies — import the
 * helpers below instead.
 */
const WALL_CLADDING_SKU_ALLOWLIST: Readonly<Record<string, WallCladdingAvailability>> =
  wallCladdingAllowlistJson as Record<string, WallCladdingAvailability>;

const NORMALIZED_ALLOWLIST: ReadonlyMap<string, WallCladdingAvailability> = new Map(
  Object.entries(WALL_CLADDING_SKU_ALLOWLIST).map(([code, availability]) => [
    code.trim().toUpperCase(),
    availability,
  ]),
);

function normalize(sku: string): string {
  return sku.trim().toUpperCase();
}

/** True when the SKU is an approved WALL_CLADDING product (allowlist match, case-insensitive). */
export function isAllowedWallCladdingSku(sku: string): boolean {
  return NORMALIZED_ALLOWLIST.has(normalize(sku));
}

/** Commercial availability for an approved WALL_CLADDING SKU, or null if not on the allowlist. */
export function getWallCladdingAvailability(sku: string): WallCladdingAvailability | null {
  return NORMALIZED_ALLOWLIST.get(normalize(sku)) ?? null;
}

/** All currently-approved WALL_CLADDING SKUs, original casing as authored in the allowlist. */
export function listAllowedWallCladdingSkus(): string[] {
  return Object.keys(WALL_CLADDING_SKU_ALLOWLIST);
}
