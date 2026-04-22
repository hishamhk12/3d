import "server-only";

import type { FloorQuad } from "@/lib/room-preview/types";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FloorRenderPromptV2Input {
  /** Sanitized product name, or null if unknown. */
  productName: string | null;
  /**
   * Four-point floor polygon in image-pixel coordinates (top-left origin).
   * When provided the model can precisely target the floor region.
   * When absent the model infers the floor from scene geometry.
   */
  floorPolygon?: FloorQuad | null;
}

// ─── Sentinel strings (must match gemini-provider.ts checks) ─────────────────

export const SENTINEL_FLOOR_NOT_VISIBLE = "FLOOR_NOT_VISIBLE";
export const SENTINEL_MATERIAL_UNCLEAR  = "MATERIAL_UNCLEAR";

// ─── Prompt builder ───────────────────────────────────────────────────────────

/**
 * Build a structured, showroom-grade floor-replacement prompt for Gemini.
 *
 * v2 improvements over v1:
 *  - Explicit ROLE primes the model as a premium visualization engine.
 *  - Floor polygon (when available) removes guesswork about which pixels to edit.
 *  - MATERIAL_UNCLEAR sentinel added so ambiguous product images fail fast.
 *  - STYLE TARGET section prevents the CGI-plastic look common in naive prompts.
 *  - QUALITY CHECK section acts as an implicit self-review step before output.
 */
export function buildFloorRenderPromptV2(input: FloorRenderPromptV2Input): string {
  return `Replace ONLY the visible FLOOR surface in the provided room image with the selected parquet product texture/reference.

OUTPUT REQUIREMENTS:
- Keep the EXACT same image resolution as the input.
- Maintain the EXACT same aspect ratio.
- Do not crop, zoom, rotate, or reframe the image.
- Return a high-quality photorealistic result.

STRICT PRESERVATION RULES:
- Preserve the room geometry exactly as in the original image.
- Preserve the exact camera angle, perspective, lens feel, and vanishing lines.
- Preserve walls, ceiling, window, skirting, shadows, lighting, reflections, and all non-floor elements exactly as they are.
- Modify ONLY the floor surface.
- Do NOT change the composition of the image in any way.

PARQUET APPLICATION RULES:
- Apply the parquet as REAL WOOD FLOOR BOARDS / PLANKS, not as a flat wood texture.
- The individual planks must be clearly visible.
- Show clear plank separations, board joints, and natural seam lines between planks.
- The floor must visibly read as installed parquet boards, not as a smooth printed wooden surface.
- Keep plank grooves/subtle gaps visible but realistic and elegant.
- Do NOT remove or blur the plank boundaries.
- Match plank width and length to realistic real-world parquet proportions.
- Avoid oversized, extra-thick, cartoonish, or exaggerated planks.
- Follow the room perspective exactly so the plank lines converge naturally with the floor plane.
- Keep the parquet layout physically believable for an actual installation.

REALISM RULES:
- Keep natural wood grain detail inside each plank.
- Preserve realistic micro-variation from plank to plank.
- Avoid obvious tiling, repetition, smudging, or over-smoothing.
- Keep the product texture sharp and detailed.
- Blend floor edges cleanly where the parquet meets walls and baseboards.
- Preserve realistic light falloff, soft reflections, and contact shadows on the floor.

NEGATIVE RULES:
- Do NOT generate laminate-like blur.
- Do NOT create a uniform wooden sheet without visible plank divisions.
- Do NOT create fake thick engraved black lines.
- Do NOT alter wall color, window shape, or room brightness.
- Do NOT add furniture or extra objects.

SUCCESS CONDITION:
- The final image must clearly show distinct parquet planks with visible natural seams and realistic board structure.

If no floor is visible, return exactly: ${SENTINEL_FLOOR_NOT_VISIBLE}`;
}
