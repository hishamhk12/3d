import type { FloorQuad, ProductCategory, TargetSurface } from "@/lib/room-preview/types";

/** Input passed to a strategy's prompt builder. Mirrors the data the Gemini
 *  provider already has at render time. */
export type RenderStrategyPromptInput = {
  productName: string | null;
  /** Floor polygon — only consumed by floor-targeting strategies. */
  floorPolygon?: FloorQuad | null;
  dimensions?: { width: number; height: number } | null;
  /** Prompt length variant (driven by render quality mode). */
  variant?: "fast" | "v4";
};

/**
 * How a strategy targets the surface geometry:
 *  - "floorQuad":  uses the room's floor polygon (parquet).
 *  - "promptOnly": no polygon/mask; the prompt alone constrains the region
 *                  (wallpaper MVP — wall polygon/mask is a future phase).
 */
export type RenderGeometryMode = "floorQuad" | "promptOnly";

export interface RenderStrategy {
  /** Strategy id used in diagnostics (e.g. "parquet" | "wallpaper"). */
  id: string;
  category: ProductCategory;
  targetSurface: TargetSurface;
  geometryMode: RenderGeometryMode;
  promptVersion: string;
  /** Build the main render prompt. */
  buildPrompt(input: RenderStrategyPromptInput): string;
  /** Build the short fallback prompt used on a timeout retry. */
  buildFallbackPrompt(productName: string | null): string;
}
