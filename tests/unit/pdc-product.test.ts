import { describe, expect, it } from "vitest";
import {
  classifySkuCategory,
  mapPdcResponseToProduct,
  PdcProductImageMissingError,
} from "@/lib/room-preview/pdc-product";
import type { PdcProductResponse } from "@/lib/room-preview/pdc-client";

const FLOOR_CLASSIFICATION = {
  category: "PARQUET",
  productType: "floor_material",
  targetSurface: "floor",
} as const;

function pdcResponse(overrides: Partial<PdcProductResponse> = {}): PdcProductResponse {
  return {
    sku: "PAR006.10",
    product_name_ar: "باركيه رمادي",
    product_name_en: "Gray parquet",
    ecommerce_url: "https://store.example.com/par006-10",
    pdc_page_url: "https://pdc.example.com/products/42",
    images: [
      { type: "gallery", url: "https://cdn/gallery.jpg", width: null, height: null },
      { type: "main", url: "https://cdn/main.jpg", width: 2000, height: 2000 },
      { type: "lifestyle", url: "https://cdn/lifestyle.jpg", width: null, height: null },
    ],
    ...overrides,
  };
}

describe("classifySkuCategory", () => {
  it.each(["P001", "PAR006.10", "P-123"])("classifies %s as floor/parquet", (sku) => {
    expect(classifySkuCategory(sku)).toEqual(FLOOR_CLASSIFICATION);
  });

  it.each(["W001", "WALL006", "W-123"])("classifies %s as walls/wallpaper", (sku) => {
    expect(classifySkuCategory(sku)).toEqual({
      category: "WALLPAPER",
      productType: "wall_material",
      targetSurface: "walls",
    });
  });

  it("only uppercases the first character for the check", () => {
    expect(classifySkuCategory("p-123")).toEqual(FLOOR_CLASSIFICATION);
    expect(classifySkuCategory("wall006")?.targetSurface).toBe("walls");
  });

  it("trims before reading the first character", () => {
    expect(classifySkuCategory("  P001")).toEqual(FLOOR_CLASSIFICATION);
  });

  it("returns null for unsupported prefixes", () => {
    expect(classifySkuCategory("X001")).toBeNull();
    expect(classifySkuCategory("001P")).toBeNull();
    expect(classifySkuCategory("")).toBeNull();
    expect(classifySkuCategory("   ")).toBeNull();
  });
});

describe("mapPdcResponseToProduct", () => {
  it("maps a PDC response and prefers the main image", () => {
    const product = mapPdcResponseToProduct(pdcResponse(), FLOOR_CLASSIFICATION);

    expect(product).toMatchObject({
      id: "PAR006.10",
      barcode: "PAR006.10",
      name: "باركيه رمادي",
      nameAr: "باركيه رمادي",
      nameEn: "Gray parquet",
      productType: "floor_material",
      category: "PARQUET",
      targetSurface: "floor",
      imageUrl: "https://cdn/main.jpg",
      ecommerceUrl: "https://store.example.com/par006-10",
      pdcPageUrl: "https://pdc.example.com/products/42",
      source: "pdc",
    });
    expect(product.images).toHaveLength(3);
  });

  it("preserves the SKU casing exactly", () => {
    const product = mapPdcResponseToProduct(
      pdcResponse({ sku: "pAr006.10" }),
      FLOOR_CLASSIFICATION,
    );
    expect(product.id).toBe("pAr006.10");
    expect(product.barcode).toBe("pAr006.10");
  });

  it("falls back to the first available image when main is missing", () => {
    const product = mapPdcResponseToProduct(
      pdcResponse({
        images: [
          { type: "gallery", url: "https://cdn/gallery.jpg" },
          { type: "lifestyle", url: "https://cdn/lifestyle.jpg" },
        ],
      }),
      FLOOR_CLASSIFICATION,
    );
    expect(product.imageUrl).toBe("https://cdn/gallery.jpg");
  });

  it("falls back to the Arabic name, then English, then SKU", () => {
    expect(
      mapPdcResponseToProduct(pdcResponse({ product_name_ar: "" }), FLOOR_CLASSIFICATION).name,
    ).toBe("Gray parquet");
    expect(
      mapPdcResponseToProduct(
        pdcResponse({ product_name_ar: "", product_name_en: "" }),
        FLOOR_CLASSIFICATION,
      ).name,
    ).toBe("PAR006.10");
  });

  it("throws when the product has no images at all", () => {
    expect(() =>
      mapPdcResponseToProduct(pdcResponse({ images: [] }), FLOOR_CLASSIFICATION),
    ).toThrow(PdcProductImageMissingError);
  });

  it("nullifies missing optional URLs", () => {
    const product = mapPdcResponseToProduct(
      pdcResponse({ ecommerce_url: null, pdc_page_url: null }),
      FLOOR_CLASSIFICATION,
    );
    expect(product.ecommerceUrl).toBeNull();
    expect(product.pdcPageUrl).toBeNull();
  });
});
