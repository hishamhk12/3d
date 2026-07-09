import { describe, expect, it } from "vitest";
import { getScreenDisplayProducts } from "@/features/room-preview/screen/screen-display-products";
import type { SelectedProduct } from "@/lib/room-preview/types";

const floorProduct: SelectedProduct = {
  id: "PQC201.001",
  barcode: "PQC201.001",
  name: "Oak parquet",
  productType: "floor_material",
  category: "PARQUET",
  targetSurface: "floor",
  imageUrl: "https://cdn.example.com/parquet.jpg",
};

const wallsProduct: SelectedProduct = {
  id: "WPT01.1104-1",
  barcode: "WPT01.1104-1",
  name: "Ivory wallpaper",
  productType: "wall_material",
  category: "WALLPAPER",
  targetSurface: "walls",
  imageUrl: "https://cdn.example.com/wallpaper.jpg",
};

describe("getScreenDisplayProducts (TV screen)", () => {
  it("returns BOTH products in fixed floor→walls order when two are selected", () => {
    const products = getScreenDisplayProducts({
      selectedProduct: floorProduct, // primary — must NOT limit the display
      selectedProductsBySurface: { walls: wallsProduct, floor: floorProduct },
    });

    expect(products).toHaveLength(2);
    expect(products[0].id).toBe("PQC201.001");
    expect(products[1].id).toBe("WPT01.1104-1");
  });

  it("does not fall back to the primary product when the by-surface map has entries", () => {
    const products = getScreenDisplayProducts({
      selectedProduct: floorProduct,
      selectedProductsBySurface: { walls: wallsProduct },
    });

    expect(products).toHaveLength(1);
    expect(products[0].id).toBe("WPT01.1104-1");
  });

  it("returns a single product when only one is selected", () => {
    const products = getScreenDisplayProducts({
      selectedProduct: floorProduct,
      selectedProductsBySurface: { floor: floorProduct },
    });

    expect(products).toHaveLength(1);
    expect(products[0].id).toBe("PQC201.001");
  });

  it("falls back to the legacy primary product when the map is absent", () => {
    const products = getScreenDisplayProducts({
      selectedProduct: floorProduct,
      selectedProductsBySurface: undefined,
    });

    expect(products).toHaveLength(1);
    expect(products[0].id).toBe("PQC201.001");
  });

  it("keeps a product without an imageUrl so the TV shows a placeholder, not nothing", () => {
    const products = getScreenDisplayProducts({
      selectedProduct: floorProduct,
      selectedProductsBySurface: {
        floor: floorProduct,
        walls: { ...wallsProduct, imageUrl: null },
      },
    });

    expect(products).toHaveLength(2);
    expect(products[1].id).toBe("WPT01.1104-1");
    expect(products[1].imageUrl).toBeNull();
  });

  it("returns an empty list when nothing is selected", () => {
    expect(
      getScreenDisplayProducts({ selectedProduct: null, selectedProductsBySurface: undefined }),
    ).toHaveLength(0);
  });
});
