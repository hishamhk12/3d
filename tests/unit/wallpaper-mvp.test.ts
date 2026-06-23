import { describe, it, expect } from "vitest";

import {
  getQrProductByCode,
  listQrProducts,
} from "@/lib/room-preview/qr-products";
import {
  resolveRenderStrategy,
  parquetStrategy,
  wallpaperStrategy,
  UnsupportedRenderCategoryError,
} from "@/lib/room-preview/render-strategies";
import { buildRenderPrompt } from "@/lib/room-preview/prompt-template-v2";
import {
  isSelectedProduct,
  normalizeSelectedProductClassification,
} from "@/lib/room-preview/validators";
import type { ProductCategory, SelectedProduct } from "@/lib/room-preview/types";

// Real product codes present on disk after the Phase 1 move.
const PARQUET_CODE = "PQH111.152";
const WALLPAPER_CODE = "WPT01.1104-1";

function toSelectedProduct(p: NonNullable<ReturnType<typeof getQrProductByCode>>): SelectedProduct {
  // Mirrors buildSessionProduct() in the product route.
  return {
    id: p.id,
    barcode: p.barcode,
    name: p.name,
    productType: p.productType,
    category: p.category,
    targetSurface: p.targetSurface,
    imageUrl: p.imageUrl,
  };
}

describe("wallpaper MVP — QR resolver classification", () => {
  it("(1) resolves a parquet product from qr-products/parquet/", () => {
    const product = getQrProductByCode(PARQUET_CODE);
    expect(product).not.toBeNull();
    expect(product?.imageUrl).toContain("/qr-products/parquet/");
  });

  it("(2) resolves a wallpaper product from qr-products/wallpaper/", () => {
    const product = getQrProductByCode(WALLPAPER_CODE);
    expect(product).not.toBeNull();
    expect(product?.imageUrl).toContain("/qr-products/wallpaper/");
  });

  it("(3) the existing /scan/PQH111.152 code still resolves", () => {
    expect(getQrProductByCode(PARQUET_CODE)).not.toBeNull();
  });

  it("(4) the new wallpaper /scan/<code> resolves", () => {
    expect(getQrProductByCode(WALLPAPER_CODE)).not.toBeNull();
  });

  it("(5) parquet → category PARQUET / targetSurface floor / floor_material", () => {
    const product = getQrProductByCode(PARQUET_CODE);
    expect(product?.category).toBe("PARQUET");
    expect(product?.targetSurface).toBe("floor");
    expect(product?.productType).toBe("floor_material");
  });

  it("(6) wallpaper → category WALLPAPER / targetSurface walls / wall_material", () => {
    const product = getQrProductByCode(WALLPAPER_CODE);
    expect(product?.category).toBe("WALLPAPER");
    expect(product?.targetSurface).toBe("walls");
    expect(product?.productType).toBe("wall_material");
  });

  it("(12) an unknown product code resolves to null (not found)", () => {
    expect(getQrProductByCode("NOPE.000")).toBeNull();
  });
});

describe("wallpaper MVP — session persistence shape", () => {
  it("(7) a SelectedProduct built from a wallpaper product keeps the new fields and validates", () => {
    const product = getQrProductByCode(WALLPAPER_CODE);
    expect(product).not.toBeNull();
    const selected = toSelectedProduct(product!);
    expect(selected.category).toBe("WALLPAPER");
    expect(selected.targetSurface).toBe("walls");
    expect(isSelectedProduct(selected)).toBe(true);
  });

  it("(7b) legacy SelectedProduct without category still validates and normalizes to PARQUET/floor", () => {
    const legacy: SelectedProduct = {
      id: "PQH111.152",
      barcode: "PQH111.152",
      name: "PQH111.152",
      productType: "floor_material",
      imageUrl: "/qr-products/parquet/PQH111.152.jpg",
    };
    expect(isSelectedProduct(legacy)).toBe(true);
    expect(normalizeSelectedProductClassification(legacy)).toEqual({
      category: "PARQUET",
      targetSurface: "floor",
    });
  });
});

describe("wallpaper MVP — render strategy router", () => {
  it("(8) router selects the parquet strategy for PARQUET", () => {
    const strategy = resolveRenderStrategy("PARQUET");
    expect(strategy).toBe(parquetStrategy);
    expect(strategy.targetSurface).toBe("floor");
    expect(strategy.geometryMode).toBe("floorQuad");
    expect(strategy.promptVersion).toBe("parquet-v1");
  });

  it("(9) router selects the wallpaper strategy for WALLPAPER", () => {
    const strategy = resolveRenderStrategy("WALLPAPER");
    expect(strategy).toBe(wallpaperStrategy);
    expect(strategy.targetSurface).toBe("walls");
    expect(strategy.geometryMode).toBe("promptOnly");
    expect(strategy.promptVersion).toBe("wallpaper-v1");
  });

  it("(12b) router throws on an unsupported category — no random fallback", () => {
    expect(() => resolveRenderStrategy("CERAMIC" as unknown as ProductCategory)).toThrow(
      UnsupportedRenderCategoryError,
    );
  });
});

describe("wallpaper MVP — prompts", () => {
  const input = {
    productName: "Test Product",
    floorPolygon: null,
    dimensions: { width: 1000, height: 800 },
    variant: "v4" as const,
  };

  it("(10) wallpaper prompt contains no floor-replacement instructions", () => {
    const prompt = wallpaperStrategy.buildPrompt(input);
    expect(prompt).toMatch(/wallpaper/i);
    expect(prompt).toMatch(/wall surfaces/i);
    // No floor-replacement language:
    expect(prompt).not.toMatch(/parquet/i);
    expect(prompt).not.toMatch(/plank/i);
    expect(prompt).not.toMatch(/flooring/i);
    expect(prompt).not.toMatch(/replace[^.]*floor/i);
    // It must still be a photo-edit task that preserves the floor (negative rule).
    expect(prompt).toMatch(/Preserve the original floor/i);
  });

  it("(11) parquet strategy prompt is byte-identical to the existing floor prompt", () => {
    const viaStrategy = parquetStrategy.buildPrompt(input);
    const viaExisting = buildRenderPrompt(
      "floor_material",
      input.productName,
      input.floorPolygon,
      input.dimensions,
      input.variant,
    );
    expect(viaStrategy).toBe(viaExisting);
    // Sanity: the parquet prompt is still floor/parquet-oriented.
    expect(viaStrategy).toMatch(/parquet/i);
  });
});

describe("wallpaper MVP — QR print data source", () => {
  it("(13) listQrProducts includes the new wallpaper test product with its category", () => {
    const products = listQrProducts();
    const wallpaper = products.find((p) => p.id === WALLPAPER_CODE);
    expect(wallpaper).toBeDefined();
    expect(wallpaper?.category).toBe("WALLPAPER");
    // Existing parquet labels are preserved in the same listing.
    const parquet = products.find((p) => p.id === PARQUET_CODE);
    expect(parquet?.category).toBe("PARQUET");
  });
});
