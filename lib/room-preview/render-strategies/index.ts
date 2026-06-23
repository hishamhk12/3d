import "server-only";

import type { ProductCategory } from "@/lib/room-preview/types";
import type { RenderStrategy } from "@/lib/room-preview/render-strategies/types";
import { parquetStrategy } from "@/lib/room-preview/render-strategies/parquet";
import { wallpaperStrategy } from "@/lib/room-preview/render-strategies/wallpaper";

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

export { parquetStrategy, wallpaperStrategy };
