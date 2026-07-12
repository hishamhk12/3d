import { describe, expect, it } from "vitest";
import {
  getPrimarySelectedProduct,
  getSelectedProductForSurface,
  getSelectedProducts,
  normalizeSelectedProducts,
  removeSelectedProductBySurface,
  upsertSelectedProductBySurface,
} from "@/lib/room-preview/selected-products";
import { getQrProductByCode } from "@/lib/room-preview/qr-products";
import {
  isRoomPreviewSession,
  isSelectedProductsBySurface,
} from "@/lib/room-preview/validators";
import type {
  RoomPreviewSession,
  SelectedProduct,
  SelectedProductsBySurface,
} from "@/lib/room-preview/types";

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

function session(overrides: Partial<RoomPreviewSession>): RoomPreviewSession {
  return {
    id: "session-1",
    status: "product_selected",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    expiresAt: null,
    mobileConnected: true,
    selectedRoom: { source: "camera", imageUrl: "https://example.com/room.jpg" },
    selectedProduct: null,
    renderResult: null,
    ...overrides,
  };
}

describe("selected products by surface", () => {
  it("normalizes a legacy selectedProduct-only session into a surface map", () => {
    const products = normalizeSelectedProducts(session({ selectedProduct: parquet() }));

    expect(products.floor?.id).toBe("PQH111.152");
    expect(products.walls).toBeUndefined();
  });

  it("applies legacy parquet/floor/floor_material fallbacks", () => {
    const legacyProduct: SelectedProduct = {
      id: "legacy",
      barcode: null,
      name: "Legacy",
      productType: null,
      imageUrl: "https://example.com/legacy.jpg",
    };

    const products = normalizeSelectedProducts(session({ selectedProduct: legacyProduct }));

    expect(products.floor).toMatchObject({
      id: "legacy",
      category: "PARQUET",
      targetSurface: "floor",
      productType: "floor_material",
    });
  });

  it("selecting parquet fills floor", () => {
    const products = upsertSelectedProductBySurface({}, parquet());

    expect(products.floor?.id).toBe("PQH111.152");
    expect(products.walls).toBeUndefined();
  });

  it("selecting wallpaper fills walls", () => {
    const products = upsertSelectedProductBySurface({}, wallpaper());

    expect(products.walls?.id).toBe("WPT01.1104-1");
    expect(products.floor).toBeUndefined();
  });

  it("selecting parquet then wallpaper preserves both", () => {
    const products = upsertSelectedProductBySurface(
      upsertSelectedProductBySurface({}, parquet()),
      wallpaper(),
    );

    expect(products.floor?.id).toBe("PQH111.152");
    expect(products.walls?.id).toBe("WPT01.1104-1");
  });

  it("selecting wallpaper then parquet preserves both", () => {
    const products = upsertSelectedProductBySurface(
      upsertSelectedProductBySurface({}, wallpaper()),
      parquet(),
    );

    expect(products.floor?.id).toBe("PQH111.152");
    expect(products.walls?.id).toBe("WPT01.1104-1");
  });

  it("selecting a second parquet replaces floor only", () => {
    const products = upsertSelectedProductBySurface(
      { floor: parquet("PQH111.151"), walls: wallpaper() },
      parquet("PQH111.154"),
    );

    expect(products.floor?.id).toBe("PQH111.154");
    expect(products.walls?.id).toBe("WPT01.1104-1");
  });

  it("selecting a second wallpaper replaces walls only", () => {
    const products = upsertSelectedProductBySurface(
      { floor: parquet(), walls: wallpaper("WPT01.1108-1") },
      wallpaper("WPT01.1110-2"),
    );

    expect(products.floor?.id).toBe("PQH111.152");
    expect(products.walls?.id).toBe("WPT01.1110-2");
  });

  it("removing floor keeps walls", () => {
    const products = removeSelectedProductBySurface(
      { floor: parquet(), walls: wallpaper() },
      "floor",
    );

    expect(products.floor).toBeUndefined();
    expect(products.walls?.id).toBe("WPT01.1104-1");
  });

  it("removing walls keeps floor", () => {
    const products = removeSelectedProductBySurface(
      { floor: parquet(), walls: wallpaper() },
      "walls",
    );

    expect(products.floor?.id).toBe("PQH111.152");
    expect(products.walls).toBeUndefined();
  });

  it("removing the last product empties the selections", () => {
    const products = removeSelectedProductBySurface({ floor: parquet() }, "floor");

    expect(products).toEqual({});
  });

  it("keeps selectedProduct compatibility through the primary product", () => {
    const products: SelectedProductsBySurface = { floor: parquet(), walls: wallpaper() };

    expect(getPrimarySelectedProduct(products)?.id).toBe("PQH111.152");
    expect(getSelectedProducts(session({ selectedProductsBySurface: products }))).toEqual(products);
    expect(getSelectedProductForSurface(session({ selectedProductsBySurface: products }), "walls")?.id)
      .toBe("WPT01.1104-1");
  });

  it("validators reject a surface map with a mismatched targetSurface", () => {
    expect(isSelectedProductsBySurface({ floor: wallpaper() })).toBe(false);
  });

  it("session validator accepts legacy selectedProduct-only sessions", () => {
    expect(isRoomPreviewSession(session({ selectedProduct: parquet() }))).toBe(true);
  });

  it("old QR links still resolve to products", () => {
    expect(getQrProductByCode("PQH111.152")?.targetSurface).toBe("floor");
    expect(getQrProductByCode("WPT01.1104-1")?.targetSurface).toBe("walls");
  });

  describe("WALL_CLADDING on the walls surface", () => {
    it("selecting wall cladding fills walls, same as wallpaper", () => {
      const products = upsertSelectedProductBySurface({}, wallCladding());

      expect(products.walls?.id).toBe("PWM02.020");
      expect(products.walls?.category).toBe("WALL_CLADDING");
      expect(products.floor).toBeUndefined();
    });

    it("selecting wall cladding after wallpaper REPLACES it (same walls slot — never both at once)", () => {
      const products = upsertSelectedProductBySurface({ walls: wallpaper() }, wallCladding());

      expect(products.walls?.id).toBe("PWM02.020");
      expect(products.walls?.category).toBe("WALL_CLADDING");
    });

    it("selecting wallpaper after wall cladding REPLACES it (same walls slot — never both at once)", () => {
      const products = upsertSelectedProductBySurface({ walls: wallCladding() }, wallpaper());

      expect(products.walls?.id).toBe("WPT01.1104-1");
      expect(products.walls?.category).toBe("WALLPAPER");
    });

    it("selecting parquet then wall cladding preserves both (composite combination)", () => {
      const products = upsertSelectedProductBySurface(
        upsertSelectedProductBySurface({}, parquet()),
        wallCladding(),
      );

      expect(products.floor?.category).toBe("PARQUET");
      expect(products.walls?.category).toBe("WALL_CLADDING");
    });

    it("removing wall cladding keeps floor", () => {
      const products = removeSelectedProductBySurface(
        { floor: parquet(), walls: wallCladding() },
        "walls",
      );

      expect(products.floor?.id).toBe("PQH111.152");
      expect(products.walls).toBeUndefined();
    });

    it("session validator accepts a wall-cladding selectedProductsBySurface map", () => {
      expect(
        isRoomPreviewSession(
          session({ selectedProductsBySurface: { floor: parquet(), walls: wallCladding() } }),
        ),
      ).toBe(true);
    });

    it("validators accept a surface map with WALL_CLADDING on walls", () => {
      expect(isSelectedProductsBySurface({ walls: wallCladding() })).toBe(true);
    });

    it("validators reject a WALL_CLADDING product whose own targetSurface disagrees with its map key", () => {
      // Same structural check the existing "mismatched targetSurface" test above
      // exercises for wallpaper — a product declaring targetSurface "walls" can
      // never be placed under the "floor" key, regardless of its category.
      const inconsistent: SelectedProduct = { ...wallCladding(), targetSurface: "walls" };
      expect(isSelectedProductsBySurface({ floor: inconsistent })).toBe(false);
    });
  });
});
