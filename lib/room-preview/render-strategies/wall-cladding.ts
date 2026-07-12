import "server-only";

import type {
  RenderStrategy,
  RenderStrategyPromptInput,
} from "@/lib/room-preview/render-strategies/types";

export const WALL_CLADDING_PROMPT_VERSION = "wall-cladding-v1";

/**
 * Strip characters that could break prompt structure or enable injection.
 * Mirrors the parquet/wallpaper/carpet-tiles sanitizers (cap 80 chars, no
 * quotes/newlines/tabs).
 */
function sanitizeProductName(name: string): string {
  return name.trim().slice(0, 80).replace(/["\n\r\t]/g, " ");
}

/**
 * Build the WALL_CLADDING render prompt.
 *
 * IMPORTANT: wall panels & wall cladding are visually distinct from wallpaper
 * — they may have real physical relief (panels, slats, grooves, joints) or be
 * flat, and the SKU alone does not reliably say which. This prompt therefore
 * instructs the model to read the product's physical character FROM the
 * supplied product reference image itself (never inventing 3D geometry that
 * isn't visible, never flattening a genuinely panelled product), rather than
 * reusing the wallpaper strategy's flat, always-tiled-pattern instructions.
 */
export function buildWallCladdingRenderPrompt(input: RenderStrategyPromptInput): string {
  const cleanedName = input.productName ? sanitizeProductName(input.productName) : null;

  const productLine = cleanedName
    ? `PRODUCT TO APPLY: "${cleanedName}" — the wall panel / wall cladding material shown in the second (product) image.`
    : "PRODUCT TO APPLY: the wall panel / wall cladding material shown in the second image.";

  const dimensionSection = input.dimensions
    ? `OUTPUT SIZE REQUIREMENT:
- The input room photo is exactly ${input.dimensions.width}×${input.dimensions.height} pixels.
- Your output image MUST also be exactly ${input.dimensions.width}×${input.dimensions.height} pixels.
- Do NOT change the aspect ratio. Do NOT add padding or black bars.

`
    : "";

  return `This is a PHOTO EDITING task, not an image generation task. You receive the original room photo (first image) and a wall panel / wall cladding product reference (second image).

${productLine}

${dimensionSection}TASK: Apply the exact wall panel or wall cladding material shown in the product reference image to the intended wall surface in the room image.

The product reference image is the source of truth for the material. Preserve its exact visual identity, including:
- color
- tone
- texture
- wood grain
- stone or marble veining
- pattern
- pattern scale
- panel width
- panel proportions
- groove direction
- slat spacing
- visible joints
- seams
- relief depth
- edge profile
- gloss or matte finish

First determine the physical character of the supplied product from the reference image.

If the product visibly contains panels, slats, grooves, flutes, joints, seams, or raised relief, install it as a real architectural wall panel system with realistic thickness, spacing, shadows, depth, and perspective.

If the supplied product is flat or has only a low-relief surface, apply it as a flat wall cladding material. Do not invent grooves, slats, frames, seams, raised panels, or 3D geometry that are not visible in the supplied product reference.

Do not treat the product as generic wallpaper, paint, or a newly designed decorative wall.

Apply the material only to the selected wall surface. If no wall selection or mask exists, use only the largest suitable visible vertical wall. Do not automatically cover every wall in the room.

Keep all material lines, grooves, slats, panel edges, joints, grain directions, and patterns aligned with the true perspective of the wall.

Use realistic architectural scale. Do not enlarge or shrink the panel dimensions unrealistically to fill the wall.

Continue the material naturally across the visible target wall while preserving believable panel repetition and installation joints.

Correctly respect and preserve:
- wall boundaries
- internal and external corners
- columns
- recesses
- doors
- windows
- openings
- electrical switches
- electrical sockets
- trims
- skirting boards
- wall-mounted televisions
- fixed wall units
- furniture
- curtains
- decorations
- foreground objects

The material must be correctly occluded behind all furniture, decorations, televisions, curtains, and foreground objects.

Do not place the wall material over doors, windows, glass, switches, sockets, trims, skirting boards, furniture, objects, curtains, the ceiling, or the floor.

Do not copy logos, product labels, text, borders, sample-card backgrounds, shadows, hands, packaging, or unrelated objects from the product reference image. Use only the actual material surface.

Do not alter:
- room structure
- wall geometry
- camera angle
- camera position
- lens perspective
- image framing
- lighting
- shadows unrelated to the installed material
- furniture
- decorations
- ceiling
- floor
- doors
- windows
- object positions

Do not crop, zoom, rotate, stretch, redesign, restyle, beautify, reconstruct, or generate a different room.

Do not add lighting strips, frames, moldings, borders, decorations, shelves, furniture, or architectural details unless they already exist in the original room image.

Preserve the exact original image dimensions and aspect ratio.

The final image must remain recognizably the same original room, with only the intended wall realistically finished using the exact supplied wall panel or wall cladding product.`;
}

/**
 * Short fallback prompt used on a timeout retry. Same "read the physical
 * character from the reference image" contract, fewer tokens for a faster
 * second pass.
 */
export function buildWallCladdingFallbackPrompt(productName: string | null): string {
  const cleaned = productName ? sanitizeProductName(productName) : null;
  const productRef = cleaned ? `"${cleaned}"` : "the provided wall panel / wall cladding product";
  return [
    `Apply the exact wall panel or wall cladding material ${productRef} to the visible wall surface, matching its color, texture, and finish exactly.`,
    "If the reference shows panels, slats, grooves, or raised relief, install it as a real panel system with realistic thickness, spacing, and shadows. If it is flat, apply it as a flat material — do not invent panels, grooves, or 3D relief that are not in the reference.",
    "Correctly occlude the material behind furniture, decorations, TVs, curtains, switches, sockets, trims, and skirting boards. Do not apply it to the floor, ceiling, doors, windows, or furniture.",
    "Keep the floor, ceiling, furniture, doors, windows, glass, lighting, shadows, and perspective unchanged.",
    "Return the same image dimensions and aspect ratio as the input.",
  ].join("\n");
}

export const wallCladdingStrategy: RenderStrategy = {
  id: "wall-cladding",
  category: "WALL_CLADDING",
  targetSurface: "walls",
  geometryMode: "promptOnly",
  promptVersion: WALL_CLADDING_PROMPT_VERSION,
  buildPrompt(input) {
    return buildWallCladdingRenderPrompt(input);
  },
  buildFallbackPrompt(productName) {
    return buildWallCladdingFallbackPrompt(productName);
  },
};
