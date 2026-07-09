import "server-only";

import type { ProductCategory } from "@/lib/room-preview/types";
import type { RenderStrategy } from "@/lib/room-preview/render-strategies/types";
import { parquetStrategy } from "@/lib/room-preview/render-strategies/parquet";
import { wallpaperStrategy } from "@/lib/room-preview/render-strategies/wallpaper";
import { carpetTilesStrategy } from "@/lib/room-preview/render-strategies/carpet-tiles";
import { parquetWallpaperStrategy } from "@/lib/room-preview/render-strategies/parquet-wallpaper";
import { carpetTilesWallpaperStrategy } from "@/lib/room-preview/render-strategies/carpet-tiles-wallpaper";

export type {
  RenderStrategy,
  RenderStrategyPromptInput,
  RenderGeometryMode,
} from "@/lib/room-preview/render-strategies/types";

/** Raised when a product carries a category that has no render strategy. */
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

/** Floor categories that support a floor+wallpaper composite render, mapped to their composite strategy. */
const COMPOSITE_STRATEGIES: Partial<Record<ProductCategory, RenderStrategy>> = {
  PARQUET: parquetWallpaperStrategy,
  CARPET_TILE: carpetTilesWallpaperStrategy,
};

/**
 * Resolve the composite (floor + wallpaper) render strategy from the FLOOR
 * product's category. Each supported floor category has its own composite
 * prompt (parquet vs carpet tiles use different floor-application language) —
 * throws on a floor category with no composite strategy, so an unsupported
 * combination never silently falls back to the wrong prompt.
 */
export function resolveCompositeRenderStrategy(floorCategory: ProductCategory): RenderStrategy {
  const strategy = COMPOSITE_STRATEGIES[floorCategory];
  if (!strategy) {
    throw new UnsupportedRenderCategoryError(String(floorCategory));
  }
  return strategy;
}

export {
  parquetStrategy,
  wallpaperStrategy,
  carpetTilesStrategy,
  parquetWallpaperStrategy,
  carpetTilesWallpaperStrategy,
};
