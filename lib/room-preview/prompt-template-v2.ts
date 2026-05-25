import "server-only";

import type { FloorQuad } from "@/lib/room-preview/types";

/**
 * Bump this whenever the prompt structure changes in a way that would make
 * old and new render outputs incompatible. Stored on each render job so
 * A/B comparisons and rollbacks are auditable.
 */
export const PROMPT_VERSION      = "gemini-floor-v4";
export const PROMPT_VERSION_FAST = "gemini-floor-fast-v1";

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
  /** Exact pixel dimensions of the (possibly resized) input room image. */
  dimensions?: { width: number; height: number } | null;
}

// ─── Sentinel strings (must match gemini-provider.ts checks) ─────────────────

export const SENTINEL_FLOOR_NOT_VISIBLE = "FLOOR_NOT_VISIBLE";
export const SENTINEL_MATERIAL_UNCLEAR  = "MATERIAL_UNCLEAR";

/**
 * Strip characters that could break prompt structure or enable injection.
 * Caps length at 80 characters; product names longer than that add no value.
 */
export function sanitizeProductName(name: string): string {
  return name.trim().slice(0, 80).replace(/["\n\r\t]/g, " ");
}

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
  const { productName, floorPolygon, dimensions } = input;

  const productLine = productName
    ? `PRODUCT TO APPLY: "${productName}" — match the color, grain, tone, and finish shown in the second (product) image.`
    : "PRODUCT TO APPLY: the flooring product shown in the second image — match its color, grain, tone, and finish exactly.";

  const dimensionSection = dimensions
    ? `OUTPUT SIZE REQUIREMENT:
- The input room photo is exactly ${dimensions.width}×${dimensions.height} pixels.
- Your output image MUST also be exactly ${dimensions.width}×${dimensions.height} pixels.
- Do NOT generate a square image. Do NOT change the aspect ratio. Do NOT add padding or black bars.
`
    : "";

  const polygonSection = floorPolygon
    ? `FLOOR BOUNDARY (pixel coordinates in the room image, top-left origin):
- Top-left:     (${Math.round(floorPolygon[0].x)}, ${Math.round(floorPolygon[0].y)})
- Top-right:    (${Math.round(floorPolygon[1].x)}, ${Math.round(floorPolygon[1].y)})
- Bottom-right: (${Math.round(floorPolygon[2].x)}, ${Math.round(floorPolygon[2].y)})
- Bottom-left:  (${Math.round(floorPolygon[3].x)}, ${Math.round(floorPolygon[3].y)})
Apply the flooring ONLY within this quadrilateral. Do NOT edit any pixel outside this boundary.
`
    : "";

  return `This is a PHOTO EDITING task, not an image generation task. You receive the original room photo (first image) and a flooring product reference (second image). Your job is to edit the room photo so that only the floor surface is replaced.

${productLine}

${dimensionSection}TASK: Replace ONLY the visible FLOOR surface in the provided room image with the selected parquet product texture/reference.

${polygonSection}OUTPUT REQUIREMENTS:
- Keep the EXACT same image resolution as the input.
- Maintain the EXACT same aspect ratio.
- Do not crop, zoom, rotate, or reframe the image.
- Return a high-quality photorealistic result.

STRICT PRESERVATION RULES:
- Preserve the room geometry exactly as in the original image.
- Preserve the exact camera angle, perspective, lens feel, and vanishing lines.
- Preserve walls, ceiling, window, skirting, shadows, lighting, reflections, and all non-floor elements exactly as they are.
- Preserve doors, door frames, glass panels, mirrors, furniture, carpets, curtains, and any objects exactly as they are.
- Modify ONLY the floor surface.
- Do NOT change the composition of the image in any way.

PARQUET APPLICATION RULES:
- Apply the selected product as real installed parquet / wood flooring.
- The floor must be made of long continuous wooden planks, not square tiles.
- Planks must be much longer than they are wide.
- Planks should run in one consistent direction across the whole visible floor.
- Follow the room perspective exactly so plank lines converge naturally with the floor plane.
- Use one consistent vanishing direction for the plank layout.
- Keep plank seams subtle, thin, natural, and elegant.
- Do not over-emphasize plank borders.
- Do not create thick dark seams or grout-like lines.
- Keep realistic long board proportions suitable for real parquet installation.
- Preserve natural wood grain detail inside each plank.
- Preserve subtle plank-to-plank variation in tone and grain.
- Match the selected product reference color, grain, tone, and finish.
- If the visible floor is partially blocked by furniture or objects, continue the same plank direction naturally behind the visible areas.
- Blend floor edges cleanly where the parquet meets walls, doors, thresholds, and baseboards.

REALISM RULES:
- Preserve realistic light falloff on the floor.
- Preserve soft reflections if they exist in the original image.
- Preserve contact shadows from furniture, doors, walls, and objects.
- Keep the product texture sharp and detailed.
- Avoid obvious repetition, smudging, stretching, or over-smoothing.
- The final result must look like a real showroom installation photo, not a CGI mockup.

NEGATIVE RULES:
- Do NOT create square tiles.
- Do NOT create ceramic-like tiles.
- Do NOT create a ceramic tile grid.
- Do NOT create checkerboard flooring.
- Do NOT create square or near-square pieces.
- Do NOT create a grid of small rectangular blocks.
- Do NOT create bathroom or kitchen tile seams.
- Do NOT create thick dark grout lines.
- Do NOT rotate planks in multiple directions.
- Do NOT create random plank directions.
- Do NOT create short block parquet unless the product reference clearly and explicitly shows block parquet.
- Do NOT make the floor look like ceramic, porcelain, marble, vinyl tiles, or mosaic.
- Do NOT create a uniform wooden sheet without realistic long plank structure.
- Do NOT generate laminate-like blur.
- Do NOT alter wall color, doors, windows, furniture, carpet, glass, lighting, or room brightness.
- Do NOT apply wood texture to doors, walls, furniture, glass, mirrors, or carpets.
- Do NOT add furniture or extra objects.

QUALITY CHECK BEFORE OUTPUT:
- Confirm the modified area is ONLY the visible floor.
- Confirm the floor reads as long continuous parquet planks.
- Confirm all planks follow one consistent perspective direction.
- Confirm seams are subtle and natural, not tile grout.
- Confirm the result does NOT look like square ceramic tiles, checkerboard, or a grid of small blocks.
- Confirm all non-floor objects are preserved.

SUCCESS CONDITION:
- The final image must clearly show realistic long parquet planks, aligned in one consistent direction with subtle natural seams.
- The result must NOT look like square ceramic tiles, checkerboard flooring, or a grid of small blocks.

If no floor is visible, return exactly: ${SENTINEL_FLOOR_NOT_VISIBLE}`;
}

/**
 * Short, low-latency floor-replacement prompt for fast render mode.
 *
 * Preserves all safety constraints from v4 (aspect ratio, floor-only edit,
 * parquet planks, sentinels) while cutting token count ~3× to reduce Gemini
 * processing time.
 */
export function buildFloorRenderPromptFastV1(input: FloorRenderPromptV2Input): string {
  const { productName, floorPolygon, dimensions } = input;

  const productLine = productName
    ? `"${productName}" — match color, grain, tone, and finish shown in the second image.`
    : "the flooring product in the second image — match its color, grain, tone, and finish exactly.";

  const dimensionLine = dimensions
    ? `Output must be exactly ${dimensions.width}×${dimensions.height} px. Same aspect ratio as input. No padding, no black bars.\n`
    : "";

  const polygonLine = floorPolygon
    ? `Apply flooring only inside this floor boundary (pixel coords, top-left origin): TL(${Math.round(floorPolygon[0].x)},${Math.round(floorPolygon[0].y)}) TR(${Math.round(floorPolygon[1].x)},${Math.round(floorPolygon[1].y)}) BR(${Math.round(floorPolygon[2].x)},${Math.round(floorPolygon[2].y)}) BL(${Math.round(floorPolygon[3].x)},${Math.round(floorPolygon[3].y)}). Do not edit outside this region.\n`
    : "";

  return `TASK: Photo editing only — replace the visible floor in the room image with the flooring product shown in the second image.

PRODUCT: ${productLine}

${dimensionLine}${polygonLine}RULES:
- Replace ONLY the floor surface. Preserve walls, ceiling, doors, windows, furniture, lighting, shadows, and reflections exactly as in the original.
- Keep the exact camera angle, perspective, and framing. No crop, zoom, rotate, or reframe.
- Output must match input resolution and aspect ratio exactly.
- Apply the product as realistic long parquet planks running in one consistent direction following room perspective.
- Planks must be much longer than wide. Keep seams subtle and natural — not tile grout.
- Match product color, grain, tone, and finish from the reference image.
- Result must look like a real showroom installation photo, not a CGI render.

DO NOT create square tiles, ceramics, checkerboard, mosaic, grout lines, or any non-parquet flooring. Do not alter any non-floor pixels.

If no floor is visible, return exactly: ${SENTINEL_FLOOR_NOT_VISIBLE}
If the product material is unclear, return exactly: ${SENTINEL_MATERIAL_UNCLEAR}`;
}

/**
 * Central render-prompt dispatch. This file is the single prompt source for
 * room-preview rendering.
 *
 * @param variant  "fast" uses the shorter gemini-floor-fast-v1 prompt;
 *                 "v4" (default) uses the full gemini-floor-v4 prompt.
 */
export function buildRenderPrompt(
  productType: string | null,
  productName: string | null,
  floorQuad?: FloorQuad | null,
  dimensions?: { width: number; height: number } | null,
  variant?: "fast" | "v4",
): string {
  if (productType === "floor_material") {
    const cleanedName = productName ? sanitizeProductName(productName) : null;
    const input: FloorRenderPromptV2Input = {
      productName: cleanedName && cleanedName.length > 0 ? cleanedName : null,
      floorPolygon: floorQuad ?? null,
      dimensions: dimensions ?? null,
    };
    if (variant === "fast") {
      return buildFloorRenderPromptFastV1(input);
    }
    return buildFloorRenderPromptV2(input);
  }

  throw new Error(`Unsupported product type: ${String(productType)}`);
}
