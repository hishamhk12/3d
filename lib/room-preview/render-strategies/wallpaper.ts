import "server-only";

import type {
  RenderStrategy,
  RenderStrategyPromptInput,
} from "@/lib/room-preview/render-strategies/types";

export const WALLPAPER_PROMPT_VERSION = "wallpaper-v1";

/**
 * Strip characters that could break prompt structure or enable injection.
 * Mirrors the parquet sanitizer (cap 80 chars, no quotes/newlines/tabs).
 */
function sanitizeProductName(name: string): string {
  return name.trim().slice(0, 80).replace(/["\n\r\t]/g, " ");
}

/**
 * Build the wallpaper render prompt.
 *
 * IMPORTANT: this prompt is wall-only. It must NOT contain any floor-replacement
 * instructions (no "replace the floor", no "parquet", no "planks", no
 * "flooring"). "floor" appears only in PRESERVATION / negative rules so the
 * model keeps the floor untouched.
 */
export function buildWallpaperRenderPrompt(input: RenderStrategyPromptInput): string {
  const cleanedName = input.productName ? sanitizeProductName(input.productName) : null;

  const productLine = cleanedName
    ? `PRODUCT TO APPLY: "${cleanedName}" — match the color, pattern, texture, and finish shown in the second (wallpaper) image.`
    : "PRODUCT TO APPLY: the wallpaper design shown in the second image — match its color, pattern, texture, and finish exactly.";

  const dimensionSection = input.dimensions
    ? `OUTPUT SIZE REQUIREMENT:
- The input room photo is exactly ${input.dimensions.width}×${input.dimensions.height} pixels.
- Your output image MUST also be exactly ${input.dimensions.width}×${input.dimensions.height} pixels.
- Do NOT change the aspect ratio. Do NOT add padding or black bars.

`
    : "";

  return `This is a PHOTO EDITING task, not an image generation task. You receive the original room photo (first image) and a wallpaper design reference (second image).

${productLine}

${dimensionSection}TASK: Apply the supplied wallpaper design only to clearly visible, paintable wall surfaces.

Preserve the original floor, ceiling, furniture, doors, windows, glass,
curtains, decorations, lighting, shadows, camera angle, perspective,
room geometry, and composition.

Tile and repeat the wallpaper pattern consistently at a realistic architectural scale.
Keep the pattern vertically upright and correctly aligned across visible wall surfaces.
Respect wall corners, perspective depth, and natural occlusion behind furniture and objects.

Do not apply the wallpaper to the floor, ceiling, doors, windows, glass,
furniture, curtains, decorations, or any non-wall surface.

Do not crop, zoom, redesign, or restyle the room.
Return the same image dimensions and aspect ratio as the input.`;
}

/**
 * Short fallback prompt used on a timeout retry. Same wall-only contract,
 * fewer tokens for a faster second pass.
 */
export function buildWallpaperFallbackPrompt(productName: string | null): string {
  const cleaned = productName ? sanitizeProductName(productName) : null;
  const productRef = cleaned ? `"${cleaned}"` : "the provided wallpaper design";
  return [
    `Apply the supplied wallpaper design ${productRef} only to the clearly visible wall surfaces.`,
    "Keep the floor, ceiling, furniture, doors, windows, glass, lighting, shadows, and perspective unchanged.",
    "Tile the pattern at a realistic scale, keep it vertically upright, and respect corners and occlusion.",
    "Do not apply it to any non-wall surface. Return the same dimensions and aspect ratio as the input.",
  ].join("\n");
}

export const wallpaperStrategy: RenderStrategy = {
  id: "wallpaper",
  category: "WALLPAPER",
  targetSurface: "walls",
  geometryMode: "promptOnly",
  promptVersion: WALLPAPER_PROMPT_VERSION,
  buildPrompt(input) {
    return buildWallpaperRenderPrompt(input);
  },
  buildFallbackPrompt(productName) {
    return buildWallpaperFallbackPrompt(productName);
  },
};
