import "server-only";

import { buildFloorRenderPromptV2 } from "@/lib/room-preview/prompt-template-v2";
import type { FloorQuad } from "@/lib/room-preview/types";

// ─── Version ──────────────────────────────────────────────────────────────────

/**
 * Bump this whenever the prompt structure changes in a way that would make
 * old and new render outputs incompatible. Stored on each render job so
 * A/B comparisons and rollbacks are auditable.
 */
export const PROMPT_VERSION = "gemini-floor-v3";

// ─── Sanitization ─────────────────────────────────────────────────────────────

/**
 * Strip characters that could break prompt structure or enable injection.
 * Caps length at 80 characters — product names longer than that add no value.
 */
export function sanitizeProductName(name: string): string {
  return name.trim().slice(0, 80).replace(/["\n\r\t]/g, " ");
}

// ─── Generic dispatch ─────────────────────────────────────────────────────────

/**
 * Build the render prompt for the given product type.
 *
 * @param productType  Must be "floor_material" — other types throw.
 * @param productName  Raw product name; sanitized internally.
 * @param floorQuad    Optional 4-point polygon (pixel coords) describing the
 *                     floor region in the room image. When provided the model
 *                     can precisely target the floor pixels.
 */
export function buildRenderPrompt(
  productType: string | null,
  productName: string | null,
  floorQuad?: FloorQuad | null,
): string {
  if (productType === "floor_material") {
    const cleanedName = productName ? sanitizeProductName(productName) : null;
    return buildFloorRenderPromptV2({
      productName: cleanedName && cleanedName.length > 0 ? cleanedName : null,
      floorPolygon: floorQuad ?? null,
    });
  }

  throw new Error(`Unsupported product type: ${String(productType)}`);
}
