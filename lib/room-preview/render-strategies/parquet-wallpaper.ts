import "server-only";

import { COMPOSITE_REFERENCE_ORDER } from "@/lib/room-preview/selected-products";
import type {
  RenderStrategy,
  RenderStrategyPromptInput,
} from "@/lib/room-preview/render-strategies/types";

export const PARQUET_WALLPAPER_PROMPT_VERSION = "parquet-wallpaper-v1";

function sanitizeProductName(name: string): string {
  return name.trim().slice(0, 80).replace(/["\n\r\t]/g, " ");
}

function productLabel(name: string | null | undefined, fallback: string) {
  return name ? `"${sanitizeProductName(name)}"` : fallback;
}

export function buildParquetWallpaperRenderPrompt(input: RenderStrategyPromptInput): string {
  const floorName = productLabel(
    input.productNamesBySurface?.floor,
    "the flooring/parquet material shown in Reference image 1",
  );
  const wallpaperName = productLabel(
    input.productNamesBySurface?.walls,
    "the wallpaper material shown in Reference image 2",
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
- The polygon is not a wall guide and must not affect wallpaper placement.

`
    : "";

  return `This is a PHOTO EDITING task, not image generation from scratch.

You receive three images in this exact order:
1. Original room photo.
2. Reference image 1 = flooring/parquet material (${floorName}).
3. Reference image 2 = wallpaper material (${wallpaperName}).

${dimensionSection}${floorPolygonSection}TASK:
- Apply Reference image 1 only to the visible floor surface as parquet/flooring.
- Apply Reference image 2 only to clearly visible, paintable wall surfaces as wallpaper.

Preserve all furniture, ceiling, doors, windows, glass, curtains, decorations,
fixtures, lighting, shadows, camera angle, perspective, room geometry, and
composition.

Keep the parquet aligned with the floor perspective at a realistic plank scale.
Tile and repeat the wallpaper pattern consistently at a realistic architectural
scale. Keep the wallpaper vertically upright and aligned across wall corners.

Do not apply parquet to walls, ceiling, doors, windows, furniture, or decor.
Do not apply wallpaper to the floor, ceiling, doors, windows, glass, furniture,
curtains, decorations, or any non-wall surface.

Do not crop, zoom, redesign, restyle, or replace the room. Return the same image
dimensions and aspect ratio as the input room photo.`;
}

export function buildParquetWallpaperFallbackPrompt(input: RenderStrategyPromptInput): string {
  const floorName = productLabel(input.productNamesBySurface?.floor, "Reference image 1");
  const wallpaperName = productLabel(input.productNamesBySurface?.walls, "Reference image 2");

  return [
    "Edit the original room photo using the two product references.",
    `Reference image 1 is the flooring/parquet material (${floorName}); apply it only to the visible floor.`,
    `Reference image 2 is the wallpaper material (${wallpaperName}); apply it only to visible wall surfaces.`,
    "Preserve furniture, ceiling, doors, windows, glass, lighting, shadows, perspective, and room geometry.",
    "Do not crop, zoom, redesign, or change the image dimensions or aspect ratio.",
  ].join("\n");
}

export const parquetWallpaperStrategy: RenderStrategy = {
  id: "parquet-wallpaper",
  mode: "composite",
  category: "PARQUET",
  targetSurface: "floor",
  geometryMode: "floorQuad",
  promptVersion: PARQUET_WALLPAPER_PROMPT_VERSION,
  referenceOrder: COMPOSITE_REFERENCE_ORDER,
  buildPrompt(input) {
    return buildParquetWallpaperRenderPrompt(input);
  },
  buildFallbackPrompt(productName, input) {
    return buildParquetWallpaperFallbackPrompt({
      productName,
      productNamesBySurface: input?.productNamesBySurface ?? { floor: productName, walls: null },
    });
  },
};
