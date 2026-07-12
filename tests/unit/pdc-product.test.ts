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

const CARPET_TILE_CLASSIFICATION = {
  category: "CARPET_TILE",
  productType: "floor_material",
  targetSurface: "floor",
} as const;

const WALL_CLADDING_CLASSIFICATION = {
  category: "WALL_CLADDING",
  productType: "wall_cladding",
  targetSurface: "walls",
} as const;

// Real allowlisted codes, one per family (see data/room-preview/wall-cladding-sku-allowlist.json).
const ALLOWLISTED_WALL_CLADDING_CODES = ["MDF125.001", "PWM02.020", "PWP09.001", "PWW04.100"] as const;

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

  it.each(["CRP001", "CRP-50x50.10", "CRP50X50-GRY"])(
    "classifies %s as floor/carpet-tile (not parquet, not wallpaper)",
    (sku) => {
      expect(classifySkuCategory(sku)).toEqual(CARPET_TILE_CLASSIFICATION);
    },
  );

  it("classifies CRP case-insensitively without mutating the returned SKU elsewhere", () => {
    expect(classifySkuCategory("crp001")).toEqual(CARPET_TILE_CLASSIFICATION);
    expect(classifySkuCategory("  Crp-10  ")).toEqual(CARPET_TILE_CLASSIFICATION);
  });

  it("does not classify a bare C-prefixed (non-CRP) SKU as carpet tile", () => {
    expect(classifySkuCategory("C001")).toBeNull();
    expect(classifySkuCategory("CER001")).toBeNull();
  });

  it("adding CARPET_TILE support does not change PARQUET or WALLPAPER classification", () => {
    expect(classifySkuCategory("P001")).toEqual(FLOOR_CLASSIFICATION);
    expect(classifySkuCategory("W001")).toEqual({
      category: "WALLPAPER",
      productType: "wall_material",
      targetSurface: "walls",
    });
  });

  describe("WALL_CLADDING (MDF / PWM / PWP / PWW families)", () => {
    it.each(ALLOWLISTED_WALL_CLADDING_CODES)("classifies allowlisted %s as walls/wall_cladding", (sku) => {
      expect(classifySkuCategory(sku)).toEqual(WALL_CLADDING_CLASSIFICATION);
    });

    it("is case-insensitive and trims, same as the other prefix families", () => {
      expect(classifySkuCategory("pwm02.020")).toEqual(WALL_CLADDING_CLASSIFICATION);
      expect(classifySkuCategory("  MDF125.001  ")).toEqual(WALL_CLADDING_CLASSIFICATION);
    });

    it("does NOT classify a non-allowlisted MDF/PWM/PWP/PWW SKU as WALL_CLADDING — a prefix match alone is not enough", () => {
      expect(classifySkuCategory("PWM99.999")).toBeNull();
      expect(classifySkuCategory("MDF999.999")).toBeNull();
      expect(classifySkuCategory("PWP99.999")).toBeNull();
      expect(classifySkuCategory("PWW99.999")).toBeNull();
    });

    it("critically: a non-allowlisted PWM/PWP/PWW SKU never falls through to the generic PARQUET (\"P\") branch", () => {
      // These all start with "P" — without the family-prefix check running
      // FIRST, a naive switch on the first character would wrongly classify
      // a wall product as floor parquet.
      const result = classifySkuCategory("PWM99.999");
      expect(result).not.toEqual(
        expect.objectContaining({ category: "PARQUET" }),
      );
      expect(result).toBeNull();
    });

    it("a genuine PARQUET SKU that happens to start with the same letter as the wall-cladding families is unaffected", () => {
      // "PAR006.10" starts with "P" but not with "PWM"/"PWP"/"PWW" — must still resolve to PARQUET.
      expect(classifySkuCategory("PAR006.10")).toEqual(FLOOR_CLASSIFICATION);
    });

    it("adding WALL_CLADDING support does not change PARQUET, WALLPAPER, or CARPET_TILE classification", () => {
      expect(classifySkuCategory("P001")).toEqual(FLOOR_CLASSIFICATION);
      expect(classifySkuCategory("W001")).toEqual({
        category: "WALLPAPER",
        productType: "wall_material",
        targetSurface: "walls",
      });
      expect(classifySkuCategory("CRP001")).toEqual(CARPET_TILE_CLASSIFICATION);
    });
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

  it("maps a CRP response using PDC's name/image, same as parquet/wallpaper", () => {
    const product = mapPdcResponseToProduct(
      pdcResponse({
        sku: "CRP001",
        product_name_ar: "بلاطات موكيت رمادية",
        product_name_en: "Gray carpet tiles",
      }),
      CARPET_TILE_CLASSIFICATION,
    );

    expect(product).toMatchObject({
      id: "CRP001",
      name: "بلاطات موكيت رمادية",
      productType: "floor_material",
      category: "CARPET_TILE",
      targetSurface: "floor",
      imageUrl: "https://cdn/main.jpg",
      source: "pdc",
    });
  });

  it("nullifies missing optional URLs", () => {
    const product = mapPdcResponseToProduct(
      pdcResponse({ ecommerce_url: null, pdc_page_url: null }),
      FLOOR_CLASSIFICATION,
    );
    expect(product.ecommerceUrl).toBeNull();
    expect(product.pdcPageUrl).toBeNull();
  });

  it("attaches the correct availability (regular/clearance) for a WALL_CLADDING SKU", () => {
    const regular = mapPdcResponseToProduct(
      pdcResponse({ sku: "PWM02.020", product_name_ar: "لوح خشبي" }),
      WALL_CLADDING_CLASSIFICATION,
    );
    expect(regular.availability).toBe("regular");

    const clearance = mapPdcResponseToProduct(
      pdcResponse({ sku: "MDF125.001", product_name_ar: "لوح تصفية" }),
      WALL_CLADDING_CLASSIFICATION,
    );
    expect(clearance.availability).toBe("clearance");
  });

  it("never attaches availability to a non-WALL_CLADDING product", () => {
    const product = mapPdcResponseToProduct(pdcResponse(), FLOOR_CLASSIFICATION);
    expect(product.availability).toBeUndefined();
  });
});
