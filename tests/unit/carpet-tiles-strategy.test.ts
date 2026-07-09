import { describe, expect, it } from "vitest";
import {
  carpetTilesStrategy,
  carpetTilesWallpaperStrategy,
  parquetStrategy,
  parquetWallpaperStrategy,
  resolveCompositeRenderStrategy,
  resolveRenderStrategy,
  UnsupportedRenderCategoryError,
  wallpaperStrategy,
} from "@/lib/room-preview/render-strategies";
import { isSupportedRenderProductCombination } from "@/lib/room-preview/selected-products";
import type { ProductCategory, SelectedProduct } from "@/lib/room-preview/types";

const PROMPT_INPUT = {
  productName: "Test Carpet Tile",
  floorPolygon: null,
  dimensions: { width: 1000, height: 800 },
  variant: "v4" as const,
};

function carpetTile(id = "CRP001"): SelectedProduct {
  return {
    id,
    barcode: id,
    name: id,
    productType: "floor_material",
    category: "CARPET_TILE",
    targetSurface: "floor",
    imageUrl: `https://cdn.example.com/carpet/${id}.jpg`,
  };
}

function parquet(id = "PQH111.152"): SelectedProduct {
  return {
    id,
    barcode: id,
    name: id,
    productType: "floor_material",
    category: "PARQUET",
    targetSurface: "floor",
    imageUrl: `/qr-products/parquet/${id}.jpg`,
  };
}

function wallpaper(id = "WPT01.1104-1"): SelectedProduct {
  return {
    id,
    barcode: id,
    name: id,
    productType: "wall_material",
    category: "WALLPAPER",
    targetSurface: "walls",
    imageUrl: `/qr-products/wallpaper/${id}.jpg`,
  };
}

describe("carpet-tiles — single render strategy", () => {
  it("router selects the carpet-tiles strategy for CARPET_TILE", () => {
    const strategy = resolveRenderStrategy("CARPET_TILE");
    expect(strategy).toBe(carpetTilesStrategy);
    expect(strategy.targetSurface).toBe("floor");
    expect(strategy.geometryMode).toBe("floorQuad");
    expect(strategy.promptVersion).toBe("carpet-tiles-v1");
  });

  it("adding CARPET_TILE does not change PARQUET or WALLPAPER routing", () => {
    expect(resolveRenderStrategy("PARQUET")).toBe(parquetStrategy);
    expect(resolveRenderStrategy("WALLPAPER")).toBe(wallpaperStrategy);
  });

  it("router still throws on an unsupported category — no random fallback", () => {
    expect(() => resolveRenderStrategy("CERAMIC" as unknown as ProductCategory)).toThrow(
      UnsupportedRenderCategoryError,
    );
  });

  it("carpet-tiles prompt contains every required instruction", () => {
    const prompt = carpetTilesStrategy.buildPrompt(PROMPT_INPUT);

    expect(prompt).toMatch(/only to the visible floor/i);
    expect(prompt).toMatch(/50cm x 50cm/);
    expect(prompt).toMatch(/square carpet tiles/i);
    expect(prompt).toMatch(/visible grid\/seams/i);
    expect(prompt).toMatch(/follow(s)? the room perspective/i);
    expect(prompt).toMatch(/realistic/i);
    expect(prompt).toMatch(/not.*continuous carpet roll|continuous carpet roll/i);
    expect(prompt).toMatch(/not.*one large rug|one large rug/i);
    expect(prompt).toMatch(/same image dimensions and aspect ratio|EXACT same aspect ratio/i);
    expect(prompt).toMatch(/uniform.*subtle seams|subtle seams.*must remain visible/i);

    // Furniture / walls / doors / lighting / shadows / reflections / geometry preserved.
    expect(prompt).toMatch(/furniture/i);
    expect(prompt).toMatch(/walls/i);
    expect(prompt).toMatch(/doors/i);
    expect(prompt).toMatch(/lighting/i);
    expect(prompt).toMatch(/shadows/i);
    expect(prompt).toMatch(/reflections/i);
    expect(prompt).toMatch(/perspective/i);
    expect(prompt).toMatch(/geometry/i);

    // Must never be described as parquet/planks.
    expect(prompt).not.toMatch(/parquet/i);
    expect(prompt).not.toMatch(/plank/i);
  });

  it("carpet-tiles fallback prompt keeps the seams/grid contract", () => {
    const fallback = carpetTilesStrategy.buildFallbackPrompt("Test Carpet Tile");
    expect(fallback).toMatch(/50cm x 50cm/);
    expect(fallback).toMatch(/grid\/seams/i);
    expect(fallback).toMatch(/never a continuous carpet roll/i);
    expect(fallback).toMatch(/never one large rug/i);
  });

  it("uses the floor polygon when provided, scoped to the floor boundary", () => {
    const prompt = carpetTilesStrategy.buildPrompt({
      ...PROMPT_INPUT,
      floorPolygon: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
    });
    expect(prompt).toMatch(/FLOOR BOUNDARY/);
    expect(prompt).toMatch(/Apply the carpet tiles ONLY within this quadrilateral/);
  });
});

describe("carpet-tiles-wallpaper — composite render strategy", () => {
  it("resolveCompositeRenderStrategy maps PARQUET floors to the existing parquet-wallpaper strategy", () => {
    expect(resolveCompositeRenderStrategy("PARQUET")).toBe(parquetWallpaperStrategy);
  });

  it("resolveCompositeRenderStrategy maps CARPET_TILE floors to the carpet-tiles-wallpaper strategy", () => {
    expect(resolveCompositeRenderStrategy("CARPET_TILE")).toBe(carpetTilesWallpaperStrategy);
  });

  it("throws for a floor category with no composite strategy (e.g. WALLPAPER as a floor category)", () => {
    expect(() => resolveCompositeRenderStrategy("WALLPAPER")).toThrow(UnsupportedRenderCategoryError);
  });

  it("carpet-tiles-wallpaper prompt never says parquet and keeps the seams/grid contract", () => {
    const prompt = carpetTilesWallpaperStrategy.buildPrompt({
      ...PROMPT_INPUT,
      productNamesBySurface: { floor: "Gray Carpet Tile", walls: "Ivory Wallpaper" },
    });

    expect(prompt).toMatch(/modular square carpet tiles, approximately 50cm x 50cm/);
    expect(prompt).toMatch(/visible grid\/seams/i);
    expect(prompt).toMatch(/only to clearly visible, paintable wall surfaces/i);
    expect(prompt).not.toMatch(/parquet/i);
    expect(prompt).not.toMatch(/plank/i);
  });

  it("carpet-tiles-wallpaper strategy metadata matches the composite contract", () => {
    expect(carpetTilesWallpaperStrategy.mode).toBe("composite");
    expect(carpetTilesWallpaperStrategy.promptVersion).toBe("carpet-tiles-wallpaper-v1");
    expect(carpetTilesWallpaperStrategy.referenceOrder).toEqual(["floor", "walls"]);
  });

  it("does not change the existing parquet-wallpaper strategy or its prompt version", () => {
    expect(parquetWallpaperStrategy.promptVersion).toBe("parquet-wallpaper-v1");
    expect(parquetWallpaperStrategy.referenceOrder).toEqual(["floor", "walls"]);
  });
});

describe("supported product combinations", () => {
  it("CARPET_TILE alone is a supported (single-product) combination", () => {
    expect(isSupportedRenderProductCombination({ floor: carpetTile() })).toBe(true);
  });

  it("CARPET_TILE + WALLPAPER is a supported composite combination", () => {
    expect(
      isSupportedRenderProductCombination({ floor: carpetTile(), walls: wallpaper() }),
    ).toBe(true);
  });

  it("PARQUET + WALLPAPER remains supported (unchanged)", () => {
    expect(
      isSupportedRenderProductCombination({ floor: parquet(), walls: wallpaper() }),
    ).toBe(true);
  });

  it("PARQUET alone remains supported (unchanged)", () => {
    expect(isSupportedRenderProductCombination({ floor: parquet() })).toBe(true);
  });
});
