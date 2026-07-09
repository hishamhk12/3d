import { describe, expect, it } from "vitest";
import {
  buildRenderJobInput,
  buildRenderJobInputHash,
} from "@/lib/room-preview/render-service-utils";
import type { RoomPreviewSession, SelectedProduct } from "@/lib/room-preview/types";

const floorProduct: SelectedProduct = {
  id: "p-floor",
  barcode: null,
  name: "Oak parquet",
  productType: "floor_material",
  category: "PARQUET",
  targetSurface: "floor",
  imageUrl: "https://cdn/floor.jpg",
};

const wallProduct: SelectedProduct = {
  id: "p-wall",
  barcode: null,
  name: "Ivory wallpaper",
  productType: "wall_material",
  category: "WALLPAPER",
  targetSurface: "walls",
  imageUrl: "https://cdn/wall.jpg",
};

function session(overrides: Partial<RoomPreviewSession> = {}): RoomPreviewSession {
  return {
    id: "session-1",
    status: "rendering",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-02T00:00:00.000Z",
    mobileConnected: true,
    selectedRoom: {
      source: "camera",
      imageUrl: "https://cdn/room.jpg",
      floorQuad: null,
    },
    selectedProduct: floorProduct,
    renderResult: null,
    ...overrides,
  };
}

describe("render-service-utils composite input", () => {
  it("keeps single parquet render input as one product", () => {
    const input = buildRenderJobInput(session({
      selectedProduct: floorProduct,
      selectedProductsBySurface: { floor: floorProduct },
    }));

    expect(input.product.id).toBe("p-floor");
    expect(input.renderMode).toBeUndefined();
    expect(input.referenceOrder).toBeUndefined();
  });

  it("uses composite mode only for floor and walls with fixed reference order", () => {
    const input = buildRenderJobInput(session({
      selectedProduct: wallProduct,
      selectedProductsBySurface: {
        walls: wallProduct,
        floor: floorProduct,
      },
    }));

    expect(input.renderMode).toBe("composite");
    expect(input.referenceOrder).toEqual(["floor", "walls"]);
    expect(input.selectedProductsBySurface?.floor?.id).toBe("p-floor");
    expect(input.selectedProductsBySurface?.walls?.id).toBe("p-wall");
  });

  it("uses floor then walls in composite input hashes regardless of selectedProduct", () => {
    const floorFirst = buildRenderJobInput(session({
      selectedProduct: floorProduct,
      selectedProductsBySurface: { floor: floorProduct, walls: wallProduct },
    }));
    const wallFirst = buildRenderJobInput(session({
      selectedProduct: wallProduct,
      selectedProductsBySurface: { walls: wallProduct, floor: floorProduct },
    }));

    expect(buildRenderJobInputHash(floorFirst)).toBe(buildRenderJobInputHash(wallFirst));
    expect(floorFirst.referenceOrder).toEqual(["floor", "walls"]);
    expect(wallFirst.referenceOrder).toEqual(["floor", "walls"]);
  });
});
