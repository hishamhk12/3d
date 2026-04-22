import { describe, expect, it } from "vitest";
import {
  hasFourQuadPoints,
  isConnectRoomPreviewSessionResponse,
  isCreateRoomPreviewSessionResponse,
  isFloorMaterialProduct,
  isFloorMaterialProductType,
  isFloorQuad,
  isQuadPoint,
  isRoomPreviewApiErrorResponse,
  isRoomPreviewRenderResult,
  isRoomPreviewSession,
  isRoomPreviewSessionResponse,
  isSaveRoomPreviewSessionProductResponse,
  isSaveRoomPreviewSessionRoomResponse,
  isSelectedProduct,
  isSelectedRoom,
  roomHasValidFloorQuad,
} from "@/lib/room-preview/validators";
import type {
  FloorQuad,
  RoomPreviewRenderResult,
  RoomPreviewSession,
  SelectedProduct,
  SelectedRoom,
} from "@/lib/room-preview/types";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const quadPoint = { x: 0.5, y: 0.25 };

const floorQuad: FloorQuad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

const validRoom: SelectedRoom = {
  source: "camera",
  imageUrl: "https://example.com/room.jpg",
  floorQuad,
};

const validProduct: SelectedProduct = {
  id: "prod-1",
  barcode: "123456789",
  name: "Oak Flooring",
  productType: "floor_material",
  imageUrl: "https://example.com/product.jpg",
};

const validRenderResult: RoomPreviewRenderResult = {
  imageUrl: "https://example.com/result.jpg",
  kind: "composited_preview",
  jobId: "job-abc",
  generatedAt: "2024-01-01T00:00:00.000Z",
  modelName: null,
};

const validSession: RoomPreviewSession = {
  id: "sess-1",
  status: "product_selected",
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  expiresAt: null,
  mobileConnected: true,
  selectedRoom: validRoom,
  selectedProduct: validProduct,
  renderResult: null,
};

// ─── isQuadPoint ──────────────────────────────────────────────────────────────

describe("isQuadPoint", () => {
  it("accepts valid quad point", () => {
    expect(isQuadPoint(quadPoint)).toBe(true);
  });

  it("accepts zero coordinates", () => {
    expect(isQuadPoint({ x: 0, y: 0 })).toBe(true);
  });

  it("accepts negative coordinates", () => {
    expect(isQuadPoint({ x: -1.5, y: -0.25 })).toBe(true);
  });

  it("rejects null", () => {
    expect(isQuadPoint(null)).toBe(false);
  });

  it("rejects missing y", () => {
    expect(isQuadPoint({ x: 1 })).toBe(false);
  });

  it("rejects string coordinates", () => {
    expect(isQuadPoint({ x: "0", y: "0" })).toBe(false);
  });

  it("rejects Infinity", () => {
    expect(isQuadPoint({ x: Infinity, y: 0 })).toBe(false);
  });

  it("rejects NaN", () => {
    expect(isQuadPoint({ x: NaN, y: 0 })).toBe(false);
  });
});

// ─── hasFourQuadPoints ────────────────────────────────────────────────────────

describe("hasFourQuadPoints", () => {
  it("accepts array of exactly 4 elements", () => {
    expect(hasFourQuadPoints([1, 2, 3, 4])).toBe(true);
  });

  it("rejects array of 3 elements", () => {
    expect(hasFourQuadPoints([1, 2, 3])).toBe(false);
  });

  it("rejects non-array", () => {
    expect(hasFourQuadPoints("not-array")).toBe(false);
  });
});

// ─── isFloorQuad ──────────────────────────────────────────────────────────────

describe("isFloorQuad", () => {
  it("accepts valid floor quad", () => {
    expect(isFloorQuad(floorQuad)).toBe(true);
  });

  it("rejects array with fewer than 4 points", () => {
    expect(isFloorQuad([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }])).toBe(false);
  });

  it("rejects array where one point is invalid", () => {
    expect(isFloorQuad([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: "bad", y: 1 }])).toBe(false);
  });

  it("rejects null", () => {
    expect(isFloorQuad(null)).toBe(false);
  });
});

// ─── isFloorMaterialProductType ───────────────────────────────────────────────

describe("isFloorMaterialProductType", () => {
  it("accepts floor_material", () => {
    expect(isFloorMaterialProductType("floor_material")).toBe(true);
  });

  it("rejects other strings", () => {
    expect(isFloorMaterialProductType("wall_material")).toBe(false);
  });

  it("rejects null", () => {
    expect(isFloorMaterialProductType(null)).toBe(false);
  });
});

// ─── isSelectedRoom ───────────────────────────────────────────────────────────

describe("isSelectedRoom", () => {
  it("accepts valid room", () => {
    expect(isSelectedRoom(validRoom)).toBe(true);
  });

  it("accepts room with null imageUrl", () => {
    expect(isSelectedRoom({ source: "camera", imageUrl: null })).toBe(true);
  });

  it("accepts room with null source", () => {
    expect(isSelectedRoom({ source: null, imageUrl: null })).toBe(true);
  });

  it("accepts room with optional floorQuad null", () => {
    expect(isSelectedRoom({ source: "demo", imageUrl: null, floorQuad: null })).toBe(true);
  });

  it("rejects room with invalid source", () => {
    expect(isSelectedRoom({ source: "webcam", imageUrl: null })).toBe(false);
  });

  it("rejects room with invalid floorQuad", () => {
    expect(isSelectedRoom({ source: "camera", imageUrl: null, floorQuad: "bad" })).toBe(false);
  });

  it("rejects null", () => {
    expect(isSelectedRoom(null)).toBe(false);
  });

  it("rejects non-object", () => {
    expect(isSelectedRoom("not-a-room")).toBe(false);
  });
});

// ─── isSelectedProduct ────────────────────────────────────────────────────────

describe("isSelectedProduct", () => {
  it("accepts valid product", () => {
    expect(isSelectedProduct(validProduct)).toBe(true);
  });

  it("accepts product with all null fields", () => {
    expect(
      isSelectedProduct({ id: null, barcode: null, name: null, productType: null, imageUrl: null }),
    ).toBe(true);
  });

  it("rejects product with invalid productType", () => {
    expect(
      isSelectedProduct({ ...validProduct, productType: "ceiling_material" }),
    ).toBe(false);
  });

  it("rejects product with numeric id", () => {
    expect(isSelectedProduct({ ...validProduct, id: 42 })).toBe(false);
  });

  it("rejects null", () => {
    expect(isSelectedProduct(null)).toBe(false);
  });
});

// ─── isRoomPreviewRenderResult ────────────────────────────────────────────────

describe("isRoomPreviewRenderResult", () => {
  it("accepts valid render result", () => {
    expect(isRoomPreviewRenderResult(validRenderResult)).toBe(true);
  });

  it("accepts result with all null fields", () => {
    expect(
      isRoomPreviewRenderResult({ imageUrl: null, kind: null, jobId: null, generatedAt: null }),
    ).toBe(true);
  });

  it("rejects result with invalid kind", () => {
    expect(
      isRoomPreviewRenderResult({ ...validRenderResult, kind: "raw_image" }),
    ).toBe(false);
  });

  it("rejects null", () => {
    expect(isRoomPreviewRenderResult(null)).toBe(false);
  });
});

// ─── isRoomPreviewSession ─────────────────────────────────────────────────────

describe("isRoomPreviewSession", () => {
  it("accepts a complete valid session", () => {
    expect(isRoomPreviewSession(validSession)).toBe(true);
  });

  it("accepts session with null optional fields", () => {
    const minimal: RoomPreviewSession = {
      id: "s1",
      status: "waiting_for_mobile",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
      expiresAt: null,
      mobileConnected: false,
      selectedRoom: null,
      selectedProduct: null,
      renderResult: null,
    };
    expect(isRoomPreviewSession(minimal)).toBe(true);
  });

  it.each([
    "created",
    "waiting_for_mobile",
    "mobile_connected",
    "room_selected",
    "product_selected",
    "ready_to_render",
    "rendering",
    "result_ready",
    "failed",
    "expired",
  ] as const)("accepts status '%s'", (status) => {
    expect(isRoomPreviewSession({ ...validSession, status })).toBe(true);
  });

  it("rejects session with unknown status", () => {
    expect(isRoomPreviewSession({ ...validSession, status: "unknown" })).toBe(false);
  });

  it("rejects session with missing id", () => {
    const { id: _, ...rest } = validSession;
    expect(isRoomPreviewSession(rest)).toBe(false);
  });

  it("rejects session with numeric id", () => {
    expect(isRoomPreviewSession({ ...validSession, id: 42 })).toBe(false);
  });

  it("rejects null", () => {
    expect(isRoomPreviewSession(null)).toBe(false);
  });
});

// ─── roomHasValidFloorQuad ────────────────────────────────────────────────────

describe("roomHasValidFloorQuad", () => {
  it("returns true when room has imageUrl and valid floorQuad", () => {
    expect(roomHasValidFloorQuad({ ...validRoom, floorQuad })).toBe(true);
  });

  it("returns false when floorQuad is null", () => {
    expect(roomHasValidFloorQuad({ ...validRoom, floorQuad: null })).toBe(false);
  });

  it("returns false when imageUrl is null", () => {
    expect(roomHasValidFloorQuad({ source: "camera", imageUrl: null, floorQuad })).toBe(false);
  });

  it("returns false for null input", () => {
    expect(roomHasValidFloorQuad(null)).toBe(false);
  });

  it("returns false for undefined input", () => {
    expect(roomHasValidFloorQuad(undefined)).toBe(false);
  });
});

// ─── isFloorMaterialProduct ───────────────────────────────────────────────────

describe("isFloorMaterialProduct", () => {
  it("returns true for a complete valid product", () => {
    expect(isFloorMaterialProduct(validProduct)).toBe(true);
  });

  it("returns false when id is null", () => {
    expect(isFloorMaterialProduct({ ...validProduct, id: null })).toBe(false);
  });

  it("returns false when imageUrl is null", () => {
    expect(isFloorMaterialProduct({ ...validProduct, imageUrl: null })).toBe(false);
  });

  it("returns false when productType is null", () => {
    expect(isFloorMaterialProduct({ ...validProduct, productType: null })).toBe(false);
  });

  it("returns false for null input", () => {
    expect(isFloorMaterialProduct(null)).toBe(false);
  });
});

// ─── Response validators ──────────────────────────────────────────────────────

describe("isRoomPreviewApiErrorResponse", () => {
  it("accepts object with string error field", () => {
    expect(isRoomPreviewApiErrorResponse({ error: "Something went wrong" })).toBe(true);
  });

  it("accepts object with code + error", () => {
    expect(
      isRoomPreviewApiErrorResponse({ code: "SESSION_NOT_FOUND", error: "Not found" }),
    ).toBe(true);
  });

  it("rejects object missing error field", () => {
    expect(isRoomPreviewApiErrorResponse({ code: "SESSION_NOT_FOUND" })).toBe(false);
  });

  it("rejects null", () => {
    expect(isRoomPreviewApiErrorResponse(null)).toBe(false);
  });
});

describe("isCreateRoomPreviewSessionResponse", () => {
  it("accepts valid create response", () => {
    expect(isCreateRoomPreviewSessionResponse({ sessionId: "abc", token: "xyz" })).toBe(true);
  });

  it("rejects when sessionId is missing", () => {
    expect(isCreateRoomPreviewSessionResponse({ token: "xyz" })).toBe(false);
  });
});

describe("isConnectRoomPreviewSessionResponse", () => {
  it("accepts { success: true }", () => {
    expect(isConnectRoomPreviewSessionResponse({ success: true })).toBe(true);
  });

  it("rejects { success: false }", () => {
    expect(isConnectRoomPreviewSessionResponse({ success: false })).toBe(false);
  });
});

describe("isSaveRoomPreviewSessionRoomResponse", () => {
  it("accepts { success: true, room: SelectedRoom }", () => {
    expect(
      isSaveRoomPreviewSessionRoomResponse({ success: true, room: validRoom }),
    ).toBe(true);
  });

  it("rejects when room is missing", () => {
    expect(isSaveRoomPreviewSessionRoomResponse({ success: true })).toBe(false);
  });
});

describe("isSaveRoomPreviewSessionProductResponse", () => {
  it("accepts { success: true, product: SelectedProduct }", () => {
    expect(
      isSaveRoomPreviewSessionProductResponse({ success: true, product: validProduct }),
    ).toBe(true);
  });

  it("rejects when product is missing", () => {
    expect(isSaveRoomPreviewSessionProductResponse({ success: true })).toBe(false);
  });
});

describe("isRoomPreviewSessionResponse", () => {
  it("is satisfied by any valid RoomPreviewSession", () => {
    expect(isRoomPreviewSessionResponse(validSession)).toBe(true);
  });

  it("rejects non-session objects", () => {
    expect(isRoomPreviewSessionResponse({ success: true })).toBe(false);
  });
});
