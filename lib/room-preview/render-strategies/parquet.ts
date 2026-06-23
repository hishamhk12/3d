import "server-only";

import { buildRenderPrompt } from "@/lib/room-preview/prompt-template-v2";
import { buildFallbackPrompt } from "@/lib/room-preview/render-providers/gemini-retry-utils";
import type { RenderStrategy } from "@/lib/room-preview/render-strategies/types";

/**
 * PARQUET strategy — a thin wrapper around the EXISTING floor-replacement prompt.
 *
 * Behavior is intentionally identical to the pre-wallpaper code path: it calls
 * `buildRenderPrompt("floor_material", …)` (the unchanged gemini-floor-v4 / fast
 * template) with the floor polygon, and reuses the existing floor fallback
 * prompt. Do not change the prompt text here — that would alter parquet output.
 */
export const parquetStrategy: RenderStrategy = {
  id: "parquet",
  category: "PARQUET",
  targetSurface: "floor",
  geometryMode: "floorQuad",
  promptVersion: "parquet-v1",
  buildPrompt(input) {
    return buildRenderPrompt(
      "floor_material",
      input.productName,
      input.floorPolygon ?? null,
      input.dimensions ?? null,
      input.variant,
    );
  },
  buildFallbackPrompt(productName) {
    return buildFallbackPrompt(productName);
  },
};
