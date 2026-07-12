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

export const PARQUET_WALL_CLADDING_PROMPT_VERSION = "parquet-wall-cladding-v1";

function sanitizeProductName(name: string): string {
  return name.trim().slice(0, 80).replace(/["\n\r\t]/g, " ");
}

function productLabel(name: string | null | undefined, fallback: string) {
  return name ? `"${sanitizeProductName(name)}"` : fallback;
}

/**
 * Composite floor + wall-cladding prompt for PARQUET floors.
 *
 * The floor-side language mirrors parquet-wallpaper.ts's parquet rules
 * exactly (same product, same behavior required) — only the wall-side
 * language differs, because wall panels/cladding are not a flat tiled
 * pattern like wallpaper. Kept as its own file so parquet-wallpaper.ts (and
 * its existing PARQUET + WALLPAPER behavior) is never touched.
 */
export function buildParquetWallCladdingRenderPrompt(input: RenderStrategyPromptInput): string {
  const floorName = productLabel(
    input.productNamesBySurface?.floor,
    "the flooring/parquet material shown in Reference image 1",
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
2. Reference image 1 = flooring/parquet material (${floorName}).
3. Reference image 2 = wall panel / wall cladding material (${wallCladdingName}).

${dimensionSection}${floorPolygonSection}TASK:
- Apply Reference image 1 only to the visible floor surface as parquet/flooring.
- ${wallCladdingCompositeWallTaskLine(wallCladdingName)}

Preserve all furniture, ceiling, doors, windows, glass, curtains, decorations,
fixtures, lighting, shadows, camera angle, perspective, room geometry, and
composition.

Keep the parquet aligned with the floor perspective at a realistic plank scale.

${wallCladdingCompositeWallRules()}

Do not apply parquet to walls, ceiling, doors, windows, furniture, or decor.
${wallCladdingCompositeNegativeLine()}
Each product depends only on its own reference image — never blend the floor material into the wall or the wall material into the floor.

Do not crop, zoom, redesign, restyle, or replace the room. Return the same image
dimensions and aspect ratio as the input room photo.`;
}

export function buildParquetWallCladdingFallbackPrompt(input: RenderStrategyPromptInput): string {
  const floorName = productLabel(input.productNamesBySurface?.floor, "Reference image 1");
  const wallCladdingName = productLabel(input.productNamesBySurface?.walls, "Reference image 2");

  return [
    "Edit the original room photo using the two product references.",
    `Reference image 1 is the flooring/parquet material (${floorName}); apply it only to the visible floor.`,
    wallCladdingCompositeFallbackLine(wallCladdingName),
    "Preserve furniture, ceiling, doors, windows, glass, lighting, shadows, perspective, and room geometry.",
    "Do not crop, zoom, redesign, or change the image dimensions or aspect ratio.",
  ].join("\n");
}

export const parquetWallCladdingStrategy: RenderStrategy = {
  id: "parquet-wall-cladding",
  mode: "composite",
  category: "PARQUET",
  targetSurface: "floor",
  geometryMode: "floorQuad",
  promptVersion: PARQUET_WALL_CLADDING_PROMPT_VERSION,
  referenceOrder: COMPOSITE_REFERENCE_ORDER,
  buildPrompt(input) {
    return buildParquetWallCladdingRenderPrompt(input);
  },
  buildFallbackPrompt(productName, input) {
    return buildParquetWallCladdingFallbackPrompt({
      productName,
      productNamesBySurface: input?.productNamesBySurface ?? { floor: productName, walls: null },
    });
  },
};
