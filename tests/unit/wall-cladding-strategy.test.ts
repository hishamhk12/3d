import { describe, expect, it } from "vitest";
import {
  carpetTilesWallCladdingStrategy,
  carpetTilesWallpaperStrategy,
  parquetStrategy,
  parquetWallCladdingStrategy,
  parquetWallpaperStrategy,
  resolveCompositeRenderStrategy,
  resolveRenderStrategy,
  UnsupportedRenderCategoryError,
  wallCladdingStrategy,
  wallpaperStrategy,
} from "@/lib/room-preview/render-strategies";
import { isSupportedRenderProductCombination } from "@/lib/room-preview/selected-products";
import type { SelectedProduct } from "@/lib/room-preview/types";

const PROMPT_INPUT = {
  productName: "Oak Wall Panel",
  floorPolygon: null,
  dimensions: { width: 1200, height: 900 },
  variant: "v4" as const,
};

function wallCladding(id = "PWM02.020"): SelectedProduct {
  return {
    id,
    barcode: id,
    name: id,
    productType: "wall_cladding",
    category: "WALL_CLADDING",
    targetSurface: "walls",
    imageUrl: `/qr-products/wall-cladding/${id}.jpg`,
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

function carpetTile(id = "CRP001"): SelectedProduct {
  return {
    id,
    barcode: id,
    name: id,
    productType: "floor_material",
    category: "CARPET_TILE",
    targetSurface: "floor",
    imageUrl: `/qr-products/carpet-tile/${id}.jpg`,
  };
}

describe("wall-cladding — single render strategy", () => {
  it("router selects the wall-cladding strategy for WALL_CLADDING", () => {
    const strategy = resolveRenderStrategy("WALL_CLADDING");
    expect(strategy).toBe(wallCladdingStrategy);
    expect(strategy.targetSurface).toBe("walls");
    expect(strategy.geometryMode).toBe("promptOnly");
    expect(strategy.promptVersion).toBe("wall-cladding-v1");
  });

  it("adding WALL_CLADDING does not change PARQUET/WALLPAPER routing", () => {
    expect(resolveRenderStrategy("PARQUET")).toBe(parquetStrategy);
    expect(resolveRenderStrategy("WALLPAPER")).toBe(wallpaperStrategy);
  });

  it("wall-cladding prompt reads the physical character from the reference image instead of assuming flat wallpaper", () => {
    const prompt = wallCladdingStrategy.buildPrompt(PROMPT_INPUT);

    expect(prompt).toMatch(/determine the physical character of the supplied product/i);
    expect(prompt).toMatch(/panels, slats, grooves, flutes, joints, seams, or raised relief/i);
    expect(prompt).toMatch(/install it as a real architectural wall panel system/i);
    expect(prompt).toMatch(/flat.*wall cladding material/i);
    expect(prompt).toMatch(/do not invent grooves, slats, frames, seams/i);
    expect(prompt).toMatch(/do not treat the product as generic wallpaper/i);
  });

  it("wall-cladding prompt requires occlusion and preserves fixtures/openings", () => {
    const prompt = wallCladdingStrategy.buildPrompt(PROMPT_INPUT);

    expect(prompt).toMatch(/electrical switches/i);
    expect(prompt).toMatch(/electrical sockets/i);
    expect(prompt).toMatch(/skirting boards/i);
    expect(prompt).toMatch(/wall-mounted televisions/i);
    expect(prompt).toMatch(/correctly occluded behind/i);
    expect(prompt).toMatch(/do not place the wall material over doors, windows/i);
  });

  it("wall-cladding prompt preserves output dimensions/aspect ratio and never redesigns the room", () => {
    const prompt = wallCladdingStrategy.buildPrompt(PROMPT_INPUT);

    expect(prompt).toMatch(/1200×900 pixels/);
    expect(prompt).toMatch(/do not crop, zoom, rotate, stretch, redesign, restyle/i);
    expect(prompt).toMatch(/preserve the exact original image dimensions and aspect ratio/i);
  });

  it("wall-cladding fallback prompt keeps the physical-character contract in fewer tokens", () => {
    const fallback = wallCladdingStrategy.buildFallbackPrompt("Oak Wall Panel");
    expect(fallback).toMatch(/panels, slats, grooves, or raised relief/i);
    expect(fallback).toMatch(/do not invent panels, grooves, or 3D relief/i);
    expect(fallback).toMatch(/occlude/i);
    expect(fallback).toMatch(/same image dimensions and aspect ratio/i);
  });

  it("router still throws on an unsupported category — no random fallback", () => {
    expect(() => resolveRenderStrategy("CERAMIC" as never)).toThrow(UnsupportedRenderCategoryError);
  });
});

describe("composite render strategies — floor + walls category pair", () => {
  it("resolves PARQUET + WALLPAPER to the existing parquet-wallpaper strategy (unchanged)", () => {
    expect(resolveCompositeRenderStrategy("PARQUET", "WALLPAPER")).toBe(parquetWallpaperStrategy);
  });

  it("resolves CARPET_TILE + WALLPAPER to the existing carpet-tiles-wallpaper strategy (unchanged)", () => {
    expect(resolveCompositeRenderStrategy("CARPET_TILE", "WALLPAPER")).toBe(carpetTilesWallpaperStrategy);
  });

  it("resolves PARQUET + WALL_CLADDING to the new parquet-wall-cladding strategy", () => {
    expect(resolveCompositeRenderStrategy("PARQUET", "WALL_CLADDING")).toBe(parquetWallCladdingStrategy);
  });

  it("resolves CARPET_TILE + WALL_CLADDING to the new carpet-tiles-wall-cladding strategy", () => {
    expect(resolveCompositeRenderStrategy("CARPET_TILE", "WALL_CLADDING")).toBe(
      carpetTilesWallCladdingStrategy,
    );
  });

  it("throws for combinations with no registered composite strategy", () => {
    expect(() => resolveCompositeRenderStrategy("WALLPAPER", "WALLPAPER")).toThrow(
      UnsupportedRenderCategoryError,
    );
    expect(() => resolveCompositeRenderStrategy("WALL_CLADDING", "WALL_CLADDING")).toThrow(
      UnsupportedRenderCategoryError,
    );
    expect(() => resolveCompositeRenderStrategy("PARQUET", "PARQUET")).toThrow(
      UnsupportedRenderCategoryError,
    );
  });
});

describe("parquet-wall-cladding — composite prompt", () => {
  const input = {
    ...PROMPT_INPUT,
    productNamesBySurface: { floor: "Grey Oak Parquet", walls: "Oak Wall Panel" },
  };

  it("keeps the parquet floor-application language unchanged", () => {
    const prompt = parquetWallCladdingStrategy.buildPrompt(input);
    expect(prompt).toMatch(/apply reference image 1 only to the visible floor surface as parquet\/flooring/i);
    expect(prompt).toMatch(/realistic plank scale/i);
  });

  it("uses wall-cladding language (not wallpaper tiling language) for the wall surface", () => {
    const prompt = parquetWallCladdingStrategy.buildPrompt(input);
    expect(prompt).toMatch(/wall panel \/ wall cladding material/i);
    expect(prompt).toMatch(/install it as a real architectural wall panel system/i);
    expect(prompt).not.toMatch(/tile and repeat the wallpaper pattern/i);
  });

  it("never mixes floor material onto the wall or vice versa", () => {
    const prompt = parquetWallCladdingStrategy.buildPrompt(input);
    expect(prompt).toMatch(/do not apply parquet to walls/i);
    expect(prompt).toMatch(/do not apply wall panel \/ wall cladding material to the floor/i);
    expect(prompt).toMatch(/never blend the floor material into the wall/i);
  });

  it("does not change the existing parquet-wallpaper strategy's prompt version", () => {
    expect(parquetWallpaperStrategy.promptVersion).toBe("parquet-wallpaper-v1");
  });

  it("strategy metadata matches the composite contract", () => {
    expect(parquetWallCladdingStrategy.mode).toBe("composite");
    expect(parquetWallCladdingStrategy.promptVersion).toBe("parquet-wall-cladding-v1");
    expect(parquetWallCladdingStrategy.referenceOrder).toEqual(["floor", "walls"]);
    expect(parquetWallCladdingStrategy.geometryMode).toBe("floorQuad");
  });

  it("fallback prompt keeps both product references distinct", () => {
    const fallback = parquetWallCladdingStrategy.buildFallbackPrompt("Grey Oak Parquet", input);
    expect(fallback).toMatch(/flooring\/parquet material/i);
    expect(fallback).toMatch(/wall panel \/ wall cladding material/i);
  });
});

describe("carpet-tiles-wall-cladding — composite prompt", () => {
  const input = {
    ...PROMPT_INPUT,
    productNamesBySurface: { floor: "Grey Carpet Tile", walls: "Oak Wall Panel" },
  };

  it("keeps the carpet-tile seams/grid contract unchanged and never says parquet", () => {
    const prompt = carpetTilesWallCladdingStrategy.buildPrompt(input);
    expect(prompt).toMatch(/modular square carpet tiles, approximately 50cm x 50cm/i);
    expect(prompt).toMatch(/visible grid\/seams/i);
    expect(prompt).not.toMatch(/parquet/i);
    expect(prompt).not.toMatch(/plank/i);
  });

  it("uses wall-cladding language (not wallpaper tiling language) for the wall surface", () => {
    const prompt = carpetTilesWallCladdingStrategy.buildPrompt(input);
    expect(prompt).toMatch(/wall panel \/ wall cladding material/i);
    expect(prompt).toMatch(/install it as a real architectural wall panel system/i);
    expect(prompt).not.toMatch(/tile and repeat the wallpaper pattern/i);
  });

  it("never mixes floor material onto the wall or vice versa", () => {
    const prompt = carpetTilesWallCladdingStrategy.buildPrompt(input);
    expect(prompt).toMatch(/do not apply carpet tiles to walls/i);
    expect(prompt).toMatch(/do not apply wall panel \/ wall cladding material to the floor/i);
  });

  it("does not change the existing carpet-tiles-wallpaper strategy's prompt version", () => {
    expect(carpetTilesWallpaperStrategy.promptVersion).toBe("carpet-tiles-wallpaper-v1");
  });

  it("strategy metadata matches the composite contract", () => {
    expect(carpetTilesWallCladdingStrategy.mode).toBe("composite");
    expect(carpetTilesWallCladdingStrategy.promptVersion).toBe("carpet-tiles-wall-cladding-v1");
    expect(carpetTilesWallCladdingStrategy.referenceOrder).toEqual(["floor", "walls"]);
  });
});

describe("supported product combinations — WALL_CLADDING", () => {
  it("WALL_CLADDING alone is a supported (single-product) combination", () => {
    expect(isSupportedRenderProductCombination({ walls: wallCladding() })).toBe(true);
  });

  it("PARQUET + WALL_CLADDING is a supported composite combination", () => {
    expect(
      isSupportedRenderProductCombination({ floor: parquet(), walls: wallCladding() }),
    ).toBe(true);
  });

  it("CARPET_TILE + WALL_CLADDING is a supported composite combination", () => {
    expect(
      isSupportedRenderProductCombination({ floor: carpetTile(), walls: wallCladding() }),
    ).toBe(true);
  });

  it("PARQUET + WALLPAPER remains supported (unaffected by WALL_CLADDING)", () => {
    expect(isSupportedRenderProductCombination({ floor: parquet(), walls: wallpaper() })).toBe(true);
  });

  it("a WALL_CLADDING product placed on the floor surface is rejected once a second surface is selected", () => {
    // isSupportedRenderProductCombination only runs its per-surface category
    // check on the composite (both-surfaces-selected) path — a single
    // selection is trusted by key alone. Pairing with a valid walls product
    // is what actually exercises the floor-surface category check.
    const misplaced: SelectedProduct = { ...wallCladding(), targetSurface: "floor" };
    expect(isSupportedRenderProductCombination({ floor: misplaced, walls: wallpaper() })).toBe(false);
  });

  it("a PARQUET product placed on the walls surface is rejected once a second surface is selected", () => {
    const misplaced: SelectedProduct = { ...parquet(), targetSurface: "walls" };
    expect(isSupportedRenderProductCombination({ floor: parquet(), walls: misplaced })).toBe(false);
  });

  it("the walls slot can only ever hold one product — WALLPAPER and WALL_CLADDING can never coexist in the same session (enforced by SelectedProductsBySurface's shape: a single `walls` key)", () => {
    const products: { floor?: SelectedProduct; walls?: SelectedProduct } = { walls: wallpaper() };
    // Selecting WALL_CLADDING for the same surface always REPLACES the prior
    // walls product — there is no data shape that can hold both at once.
    products.walls = wallCladding();
    expect(products.walls.category).toBe("WALL_CLADDING");
    expect(isSupportedRenderProductCombination(products)).toBe(true);
  });
});
