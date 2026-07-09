import "server-only";

import type {
  RenderStrategy,
  RenderStrategyPromptInput,
} from "@/lib/room-preview/render-strategies/types";

export const CARPET_TILES_PROMPT_VERSION = "carpet-tiles-v1";

/**
 * Strip characters that could break prompt structure or enable injection.
 * Mirrors the parquet/wallpaper sanitizers (cap 80 chars, no quotes/newlines/tabs).
 */
function sanitizeProductName(name: string): string {
  return name.trim().slice(0, 80).replace(/["\n\r\t]/g, " ");
}

/**
 * Build the carpet-tiles render prompt.
 *
 * IMPORTANT: this is NOT the parquet prompt. CRP products are modular 50x50cm
 * square carpet tiles, not continuous wood planks and not one large rug — the
 * output must always show a visible tile grid/seams. Do not reuse the generic
 * floor prompt (prompt-template-v2) here; its PARQUET APPLICATION RULES
 * explicitly require "long continuous wooden planks, not square tiles", which
 * is the opposite of what carpet tiles need.
 */
export function buildCarpetTilesRenderPrompt(input: RenderStrategyPromptInput): string {
  const cleanedName = input.productName ? sanitizeProductName(input.productName) : null;

  const productLine = cleanedName
    ? `PRODUCT TO APPLY: "${cleanedName}" — match the color, texture, and finish shown in the second (product) image.`
    : "PRODUCT TO APPLY: the carpet tile product shown in the second image — match its color, texture, and finish exactly.";

  const dimensionSection = input.dimensions
    ? `OUTPUT SIZE REQUIREMENT:
- The input room photo is exactly ${input.dimensions.width}×${input.dimensions.height} pixels.
- Your output image MUST also be exactly ${input.dimensions.width}×${input.dimensions.height} pixels.
- Do NOT change the aspect ratio. Do NOT add padding or black bars.

`
    : "";

  const polygonSection = input.floorPolygon
    ? `FLOOR BOUNDARY (pixel coordinates in the room image, top-left origin):
- Top-left:     (${Math.round(input.floorPolygon[0].x)}, ${Math.round(input.floorPolygon[0].y)})
- Top-right:    (${Math.round(input.floorPolygon[1].x)}, ${Math.round(input.floorPolygon[1].y)})
- Bottom-right: (${Math.round(input.floorPolygon[2].x)}, ${Math.round(input.floorPolygon[2].y)})
- Bottom-left:  (${Math.round(input.floorPolygon[3].x)}, ${Math.round(input.floorPolygon[3].y)})
Apply the carpet tiles ONLY within this quadrilateral. Do NOT edit any pixel outside this boundary.

`
    : "";

  return `This is a PHOTO EDITING task, not an image generation task. You receive the original room photo (first image) and a carpet tile product reference (second image). Your job is to edit the room photo so that only the floor surface is replaced.

${productLine}

${dimensionSection}TASK: Apply the referenced product only to the visible floor, installed as modular square carpet tiles, approximately 50cm x 50cm each.

${polygonSection}CARPET TILE APPLICATION RULES:
- Treat the product strictly as modular square carpet tiles, approximately 50cm x 50cm — NOT a continuous carpet roll and NOT one large rug.
- The final floor MUST show a visible grid/seams between the square tiles across the whole visible floor area.
- Even if the product color or texture is uniform, subtle seams between the 50x50cm square carpet tiles must remain visible — do not render a single seamless surface.
- The tile grid must follow the room perspective: tile rows and columns converge naturally with the floor plane and vanishing lines.
- Keep the tile scale realistic for 50x50cm tiles relative to the room and furniture — tiles must not look too large or too small.
- Do not render this as a continuous carpet roll with no seams.
- Do not render this as one large rug or area rug.
- If the visible floor is partially blocked by furniture or objects, continue the same tile grid naturally behind the visible areas.
- Blend floor edges cleanly where the carpet tiles meet walls, doors, thresholds, and baseboards.

OUTPUT REQUIREMENTS:
- Keep the EXACT same image resolution as the input.
- Maintain the EXACT same aspect ratio.
- Do not crop, zoom, rotate, or reframe the image.
- Return a high-quality photorealistic result.

STRICT PRESERVATION RULES:
- Preserve the room geometry exactly as in the original image.
- Preserve the exact camera angle, perspective, lens feel, and vanishing lines.
- Preserve walls, doors, lighting, shadows, and reflections exactly as they are.
- Preserve furniture, ceiling, windows, glass, curtains, decorations, and any objects exactly as they are.
- Modify ONLY the floor surface.
- Do NOT change the composition of the image in any way.`;
}

/**
 * Short fallback prompt used on a timeout retry. Same seams/grid contract as
 * the main prompt, fewer tokens for a faster second pass.
 */
export function buildCarpetTilesFallbackPrompt(productName: string | null): string {
  const cleaned = productName ? sanitizeProductName(productName) : null;
  const productRef = cleaned ? `"${cleaned}"` : "the provided carpet tile product";
  return [
    `Apply ${productRef} only to the visible floor, installed as modular square carpet tiles, approximately 50cm x 50cm each.`,
    "The floor must show a visible grid/seams between tiles, following the room perspective — never a continuous carpet roll and never one large rug.",
    "Keep walls, furniture, doors, lighting, shadows, and perspective unchanged.",
    "Return the same image dimensions and aspect ratio as the input.",
  ].join("\n");
}

export const carpetTilesStrategy: RenderStrategy = {
  id: "carpet-tiles",
  category: "CARPET_TILE",
  targetSurface: "floor",
  geometryMode: "floorQuad",
  promptVersion: CARPET_TILES_PROMPT_VERSION,
  buildPrompt(input) {
    return buildCarpetTilesRenderPrompt(input);
  },
  buildFallbackPrompt(productName) {
    return buildCarpetTilesFallbackPrompt(productName);
  },
};
