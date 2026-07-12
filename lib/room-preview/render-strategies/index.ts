import "server-only";

import type { ProductCategory } from "@/lib/room-preview/types";
import type { RenderStrategy } from "@/lib/room-preview/render-strategies/types";
import { parquetStrategy } from "@/lib/room-preview/render-strategies/parquet";
import { wallpaperStrategy } from "@/lib/room-preview/render-strategies/wallpaper";
import { carpetTilesStrategy } from "@/lib/room-preview/render-strategies/carpet-tiles";
import { wallCladdingStrategy } from "@/lib/room-preview/render-strategies/wall-cladding";
import { parquetWallpaperStrategy } from "@/lib/room-preview/render-strategies/parquet-wallpaper";
import { carpetTilesWallpaperStrategy } from "@/lib/room-preview/render-strategies/carpet-tiles-wallpaper";
import { parquetWallCladdingStrategy } from "@/lib/room-preview/render-strategies/parquet-wall-cladding";
import { carpetTilesWallCladdingStrategy } from "@/lib/room-preview/render-strategies/carpet-tiles-wall-cladding";

export type {
  RenderStrategy,
  RenderStrategyPromptInput,
  RenderGeometryMode,
} from "@/lib/room-preview/render-strategies/types";

/** Raised when a product carries a category (or floor:walls category pair) that has no render strategy. */
export class UnsupportedRenderCategoryError extends Error {
  constructor(public readonly category: string) {
    super(`Unsupported render category: ${category}`);
    this.name = "UnsupportedRenderCategoryError";
  }
}

const STRATEGIES: Record<ProductCategory, RenderStrategy> = {
  PARQUET: parquetStrategy,
  WALLPAPER: wallpaperStrategy,
  CARPET_TILE: carpetTilesStrategy,
  WALL_CLADDING: wallCladdingStrategy,
};

/**
 * Resolve the render strategy for a product category. The category MUST come
 * from product data (resolved from the qr-products subfolder), never guessed
 * from the image. Throws on an unknown category — there is no random fallback.
 */
export function resolveRenderStrategy(category: ProductCategory): RenderStrategy {
  const strategy = STRATEGIES[category];
  if (!strategy) {
    throw new UnsupportedRenderCategoryError(String(category));
  }
  return strategy;
}

/**
 * Floor category + wall category pair → composite strategy. Keyed by BOTH
 * surfaces (not just the floor category) because the "walls" surface can now
 * be either WALLPAPER or WALL_CLADDING, and each combination needs its own
 * prompt (a wall-cladding composite must never reuse the wallpaper composite's
 * always-tiled-pattern wall language).
 */
type CompositeStrategyKey = `${ProductCategory}:${ProductCategory}`;

function compositeStrategyKey(floorCategory: ProductCategory, wallCategory: ProductCategory): CompositeStrategyKey {
  return `${floorCategory}:${wallCategory}`;
}

const COMPOSITE_STRATEGIES: Partial<Record<CompositeStrategyKey, RenderStrategy>> = {
  [compositeStrategyKey("PARQUET", "WALLPAPER")]: parquetWallpaperStrategy,
  [compositeStrategyKey("CARPET_TILE", "WALLPAPER")]: carpetTilesWallpaperStrategy,
  [compositeStrategyKey("PARQUET", "WALL_CLADDING")]: parquetWallCladdingStrategy,
  [compositeStrategyKey("CARPET_TILE", "WALL_CLADDING")]: carpetTilesWallCladdingStrategy,
};

/**
 * Resolve the composite (floor + walls) render strategy from BOTH the floor
 * product's category and the walls product's category. Each supported
 * combination has its own composite prompt — throws on a combination with no
 * registered strategy, so an unsupported pairing never silently falls back to
 * the wrong prompt (e.g. a wall-cladding product must never render through
 * the wallpaper composite prompt, or vice versa).
 */
export function resolveCompositeRenderStrategy(
  floorCategory: ProductCategory,
  wallCategory: ProductCategory,
): RenderStrategy {
  const key = compositeStrategyKey(floorCategory, wallCategory);
  const strategy = COMPOSITE_STRATEGIES[key];
  if (!strategy) {
    throw new UnsupportedRenderCategoryError(key);
  }
  return strategy;
}

export {
  parquetStrategy,
  wallpaperStrategy,
  carpetTilesStrategy,
  wallCladdingStrategy,
  parquetWallpaperStrategy,
  carpetTilesWallpaperStrategy,
  parquetWallCladdingStrategy,
  carpetTilesWallCladdingStrategy,
};
