import "server-only";

import { COMPOSITE_REFERENCE_ORDER } from "@/lib/room-preview/selected-products";
import {
  wallCladdingCompositeFallbackLine,
  wallCladdingCompositeNegativeLine,
  wallCladdingCompositeWallRules,
  wallCladdingCompositeWallTaskLine,
} from "@/lib/room-preview/render-strategies/wall-cladding-composite-shared";
import type {
  RenderStrategy,
  RenderStrategyPromptInput,
} from "@/lib/room-preview/render-strategies/types";

export const CARPET_TILES_WALL_CLADDING_PROMPT_VERSION = "carpet-tiles-wall-cladding-v1";

function sanitizeProductName(name: string): string {
  return name.trim().slice(0, 80).replace(/["\n\r\t]/g, " ");
}

function productLabel(name: string | null | undefined, fallback: string) {
  return name ? `"${sanitizeProductName(name)}"` : fallback;
}

/**
 * Composite floor + wall-cladding prompt for CRP (carpet tile) floors.
 *
 * The floor-side language mirrors carpet-tiles-wallpaper.ts's carpet-tile
 * rules exactly (visible 50x50cm grid/seams, never a roll or one large rug)
 * — only the wall-side language differs. Kept as its own file so
 * carpet-tiles-wallpaper.ts (and its existing CARPET_TILE + WALLPAPER
 * behavior) is never touched.
 */
export function buildCarpetTilesWallCladdingRenderPrompt(input: RenderStrategyPromptInput): string {
  const floorName = productLabel(
    input.productNamesBySurface?.floor,
    "the carpet tile material shown in Reference image 1",
  );
  const wallCladdingName = productLabel(
    input.productNamesBySurface?.walls,
    "the wall panel / wall cladding material shown in Reference image 2",
  );

  const dimensionSection = input.dimensions
    ? `OUTPUT SIZE REQUIREMENT:
- The input room photo is exactly ${input.dimensions.width}x${input.dimensions.height} pixels.
- Your output image MUST also be exactly ${input.dimensions.width}x${input.dimensions.height} pixels.
- Do NOT change the aspect ratio. Do NOT add padding or black bars.

`
    : "";

  const floorPolygonSection = input.floorPolygon
    ? `FLOOR REGION GUIDE:
- Use this floor polygon only as a guide for the flooring area: ${JSON.stringify(input.floorPolygon)}.
- The polygon is not a wall guide and must not affect wall cladding placement.

`
    : "";

  return `This is a PHOTO EDITING task, not image generation from scratch.

You receive three images in this exact order:
1. Original room photo.
2. Reference image 1 = carpet tile flooring material (${floorName}).
3. Reference image 2 = wall panel / wall cladding material (${wallCladdingName}).

${dimensionSection}${floorPolygonSection}TASK:
- Apply Reference image 1 only to the visible floor, installed as modular square carpet tiles, approximately 50cm x 50cm each.
- ${wallCladdingCompositeWallTaskLine(wallCladdingName)}

Preserve all furniture, ceiling, doors, windows, glass, curtains, decorations,
fixtures, lighting, shadows, camera angle, perspective, room geometry, and
composition.

CARPET TILE FLOOR RULES:
- Treat the floor product strictly as modular square carpet tiles, approximately 50cm x 50cm — NOT a continuous carpet roll and NOT one large rug.
- The final floor MUST show a visible grid/seams between the square tiles, following the room perspective.
- Even if the product color or texture is uniform, subtle seams between the 50x50cm tiles must remain visible.
- Keep the tile scale realistic relative to the room and furniture.

${wallCladdingCompositeWallRules()}

Do not apply carpet tiles to walls, ceiling, doors, windows, furniture, or decor.
${wallCladdingCompositeNegativeLine()}
Each product depends only on its own reference image — never blend the floor material into the wall or the wall material into the floor.

Do not crop, zoom, redesign, restyle, or replace the room. Return the same image
dimensions and aspect ratio as the input room photo.`;
}

export function buildCarpetTilesWallCladdingFallbackPrompt(input: RenderStrategyPromptInput): string {
  const floorName = productLabel(input.productNamesBySurface?.floor, "Reference image 1");
  const wallCladdingName = productLabel(input.productNamesBySurface?.walls, "Reference image 2");

  return [
    "Edit the original room photo using the two product references.",
    `Reference image 1 is the carpet tile flooring material (${floorName}); apply it only to the visible floor as modular 50x50cm square tiles with visible grid/seams — not a roll, not one large rug.`,
    wallCladdingCompositeFallbackLine(wallCladdingName),
    "Preserve furniture, ceiling, doors, windows, glass, lighting, shadows, perspective, and room geometry.",
    "Do not crop, zoom, redesign, or change the image dimensions or aspect ratio.",
  ].join("\n");
}

export const carpetTilesWallCladdingStrategy: RenderStrategy = {
  id: "carpet-tiles-wall-cladding",
  mode: "composite",
  category: "CARPET_TILE",
  targetSurface: "floor",
  geometryMode: "floorQuad",
  promptVersion: CARPET_TILES_WALL_CLADDING_PROMPT_VERSION,
  referenceOrder: COMPOSITE_REFERENCE_ORDER,
  buildPrompt(input) {
    return buildCarpetTilesWallCladdingRenderPrompt(input);
  },
  buildFallbackPrompt(productName, input) {
    return buildCarpetTilesWallCladdingFallbackPrompt({
      productName,
      productNamesBySurface: input?.productNamesBySurface ?? { floor: productName, walls: null },
    });
  },
};
