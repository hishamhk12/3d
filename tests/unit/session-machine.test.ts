import { describe, expect, it } from "vitest";
import {
  RoomPreviewSessionTransitionError,
  completeRenderingTransition,
  connectMobileTransition,
  createRoomPreviewSessionState,
  failRenderingTransition,
  markReadyToRenderTransition,
  selectProductTransition,
  selectRoomTransition,
  startRenderingTransition,
} from "@/lib/room-preview/session-machine";
import type {
  RoomPreviewRenderResult,
  RoomPreviewSession,
  SelectedProduct,
  SelectedRoom,
} from "@/lib/room-preview/types";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<RoomPreviewSession> = {}): RoomPreviewSession {
  return {
    id: "test-session-id",
    status: "waiting_for_mobile",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    expiresAt: null,
    mobileConnected: false,
    selectedRoom: null,
    selectedProduct: null,
    renderResult: null,
    ...overrides,
  };
}

const validRoom: SelectedRoom = {
  source: "camera",
  imageUrl: "https://example.com/room.jpg",
  floorQuad: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ],
};

const validProduct: SelectedProduct = {
  id: "product-1",
  barcode: "123456",
  name: "Oak Flooring",
  productType: "floor_material",
  imageUrl: "https://example.com/product.jpg",
};

const validRenderResult: RoomPreviewRenderResult = {
  imageUrl: "https://example.com/render.jpg",
  kind: "composited_preview",
  jobId: "job-1",
  generatedAt: "2024-01-01T01:00:00.000Z",
  modelName: null,
};

// ─── createRoomPreviewSessionState ───────────────────────────────────────────

describe("createRoomPreviewSessionState", () => {
  it("creates initial session with waiting_for_mobile status", () => {
    const session = createRoomPreviewSessionState("abc123");
    expect(session.id).toBe("abc123");
    expect(session.status).toBe("waiting_for_mobile");
    expect(session.mobileConnected).toBe(false);
    expect(session.selectedRoom).toBeNull();
    expect(session.selectedProduct).toBeNull();
    expect(session.renderResult).toBeNull();
  });

  it("sets createdAt and updatedAt to the same ISO timestamp", () => {
    const session = createRoomPreviewSessionState("abc123");
    expect(session.createdAt).toBe(session.updatedAt);
    expect(() => new Date(session.createdAt)).not.toThrow();
  });
});

// ─── connectMobileTransition ─────────────────────────────────────────────────

describe("connectMobileTransition", () => {
  it("transitions from waiting_for_mobile to mobile_connected", () => {
    const session = makeSession({ status: "waiting_for_mobile" });
    const next = connectMobileTransition(session);
    expect(next.status).toBe("mobile_connected");
    expect(next.mobileConnected).toBe(true);
  });

  it("transitions from created to mobile_connected", () => {
    const session = makeSession({ status: "created" });
    const next = connectMobileTransition(session);
    expect(next.status).toBe("mobile_connected");
    expect(next.mobileConnected).toBe(true);
  });

  it("updates updatedAt", () => {
    const session = makeSession();
    const next = connectMobileTransition(session);
    expect(next.updatedAt).not.toBe(session.updatedAt);
  });

  it("throws when session is in locked state: ready_to_render", () => {
    const session = makeSession({ status: "ready_to_render" });
    expect(() => connectMobileTransition(session)).toThrow(
      RoomPreviewSessionTransitionError,
    );
  });

  it.each(["rendering", "result_ready", "expired"] as const)(
    "throws when session is in locked state: %s",
    (status) => {
      const session = makeSession({ status });
      expect(() => connectMobileTransition(session)).toThrow(
        RoomPreviewSessionTransitionError,
      );
    },
  );

  it("throws when status is mobile_connected (already connected)", () => {
    const session = makeSession({ status: "mobile_connected" });
    expect(() => connectMobileTransition(session)).toThrow(
      RoomPreviewSessionTransitionError,
    );
  });

  it("error carries the current status", () => {
    const session = makeSession({ status: "rendering" });
    try {
      connectMobileTransition(session);
    } catch (err) {
      expect(err).toBeInstanceOf(RoomPreviewSessionTransitionError);
      expect((err as RoomPreviewSessionTransitionError).currentStatus).toBe("rendering");
      expect((err as RoomPreviewSessionTransitionError).code).toBe("SESSION_INVALID_STATE");
    }
  });
});

// ─── selectRoomTransition ────────────────────────────────────────────────────

describe("selectRoomTransition", () => {
  const mobileConnectedSession = makeSession({
    status: "mobile_connected",
    mobileConnected: true,
  });

  it("transitions from mobile_connected to room_selected", () => {
    const next = selectRoomTransition(mobileConnectedSession, validRoom);
    expect(next.status).toBe("room_selected");
    expect(next.selectedRoom).toEqual(validRoom);
  });

  it("allows re-selecting a room from room_selected", () => {
    const session = makeSession({
      status: "room_selected",
      mobileConnected: true,
      selectedRoom: validRoom,
    });
    const newRoom: SelectedRoom = { source: "gallery", imageUrl: "https://example.com/new.jpg" };
    const next = selectRoomTransition(session, newRoom);
    expect(next.status).toBe("room_selected");
    expect(next.selectedRoom).toEqual(newRoom);
  });

  it("clears renderResult when a new room is selected", () => {
    const session = makeSession({
      status: "room_selected",
      mobileConnected: true,
      selectedRoom: validRoom,
      renderResult: validRenderResult,
    });
    const next = selectRoomTransition(session, validRoom);
    expect(next.renderResult).toBeNull();
  });

  it("throws when mobile is not connected", () => {
    const session = makeSession({ status: "mobile_connected", mobileConnected: false });
    expect(() => selectRoomTransition(session, validRoom)).toThrow(
      RoomPreviewSessionTransitionError,
    );
  });

  it("throws when status is waiting_for_mobile", () => {
    const session = makeSession({ status: "waiting_for_mobile" });
    expect(() => selectRoomTransition(session, validRoom)).toThrow(
      RoomPreviewSessionTransitionError,
    );
  });

  it.each(["ready_to_render", "rendering", "result_ready", "expired"] as const)(
    "throws when session is locked: %s",
    (status) => {
      const session = makeSession({ status, mobileConnected: true });
      expect(() => selectRoomTransition(session, validRoom)).toThrow(
        RoomPreviewSessionTransitionError,
      );
    },
  );

  it("throws when room has no imageUrl", () => {
    const badRoom: SelectedRoom = { source: "camera", imageUrl: null };
    expect(() => selectRoomTransition(mobileConnectedSession, badRoom)).toThrow(
      RoomPreviewSessionTransitionError,
    );
  });

  it("throws when room has no source", () => {
    const badRoom: SelectedRoom = { source: null, imageUrl: "https://example.com/room.jpg" };
    expect(() => selectRoomTransition(mobileConnectedSession, badRoom)).toThrow(
      RoomPreviewSessionTransitionError,
    );
  });

  it("allows choosing a new room after a failed render and clears the product", () => {
    const session = makeSession({
      status: "failed",
      mobileConnected: true,
      selectedRoom: validRoom,
      selectedProduct: validProduct,
    });
    const next = selectRoomTransition(session, validRoom);
    expect(next.status).toBe("room_selected");
    expect(next.selectedProduct).toBeNull();
  });
});

// ─── selectProductTransition ─────────────────────────────────────────────────

describe("selectProductTransition", () => {
  const roomSelectedSession = makeSession({
    status: "room_selected",
    mobileConnected: true,
    selectedRoom: validRoom,
  });

  it("transitions from room_selected to product_selected", () => {
    const next = selectProductTransition(roomSelectedSession, validProduct);
    expect(next.status).toBe("product_selected");
    expect(next.selectedProduct).toEqual(validProduct);
  });

  it("allows re-selecting a product from product_selected", () => {
    const session = makeSession({
      status: "product_selected",
      mobileConnected: true,
      selectedRoom: validRoom,
      selectedProduct: validProduct,
    });
    const next = selectProductTransition(session, validProduct);
    expect(next.status).toBe("product_selected");
  });

  it("clears renderResult when a new product is selected", () => {
    const session = makeSession({
      status: "product_selected",
      mobileConnected: true,
      selectedRoom: validRoom,
      selectedProduct: validProduct,
      renderResult: validRenderResult,
    });
    const next = selectProductTransition(session, validProduct);
    expect(next.renderResult).toBeNull();
  });

  it("throws when mobile is not connected", () => {
    const session = makeSession({
      status: "room_selected",
      mobileConnected: false,
      selectedRoom: validRoom,
    });
    expect(() => selectProductTransition(session, validProduct)).toThrow(
      RoomPreviewSessionTransitionError,
    );
  });

  it("throws when selectedRoom has no imageUrl", () => {
    const session = makeSession({
      status: "room_selected",
      mobileConnected: true,
      selectedRoom: { source: "camera", imageUrl: null },
    });
    expect(() => selectProductTransition(session, validProduct)).toThrow(
      RoomPreviewSessionTransitionError,
    );
  });

  it("throws when selectedRoom is null", () => {
    const session = makeSession({
      status: "room_selected",
      mobileConnected: true,
      selectedRoom: null,
    });
    expect(() => selectProductTransition(session, validProduct)).toThrow(
      RoomPreviewSessionTransitionError,
    );
  });

  it("throws when product has no id", () => {
    const badProduct: SelectedProduct = { ...validProduct, id: null };
    expect(() => selectProductTransition(roomSelectedSession, badProduct)).toThrow(
      RoomPreviewSessionTransitionError,
    );
  });

  it("throws when product has no imageUrl", () => {
    const badProduct: SelectedProduct = { ...validProduct, imageUrl: null };
    expect(() => selectProductTransition(roomSelectedSession, badProduct)).toThrow(
      RoomPreviewSessionTransitionError,
    );
  });

  it("throws when product type is not floor_material", () => {
    const badProduct: SelectedProduct = { ...validProduct, productType: null };
    expect(() => selectProductTransition(roomSelectedSession, badProduct)).toThrow(
      RoomPreviewSessionTransitionError,
    );
  });

  it("allows selecting a different product after a failed render", () => {
    const session = makeSession({
      status: "failed",
      mobileConnected: true,
      selectedRoom: validRoom,
      selectedProduct: validProduct,
    });
    const next = selectProductTransition(session, validProduct);
    expect(next.status).toBe("product_selected");
    expect(next.selectedProduct).toEqual(validProduct);
  });

  it.each(["ready_to_render", "rendering", "result_ready", "expired"] as const)(
    "throws when session is locked: %s",
    (status) => {
      const session = makeSession({ status, mobileConnected: true, selectedRoom: validRoom });
      expect(() => selectProductTransition(session, validProduct)).toThrow(
        RoomPreviewSessionTransitionError,
      );
    },
  );
});

// ─── markReadyToRenderTransition ─────────────────────────────────────────────

describe("markReadyToRenderTransition", () => {
  const productSelectedSession = makeSession({
    status: "product_selected",
    mobileConnected: true,
    selectedRoom: validRoom,
    selectedProduct: validProduct,
  });

  it("transitions from product_selected to ready_to_render", () => {
    const next = markReadyToRenderTransition(productSelectedSession);
    expect(next.status).toBe("ready_to_render");
  });

  it("allows retrying render from failed when room and product are still selected", () => {
    const session = makeSession({
      status: "failed",
      mobileConnected: true,
      selectedRoom: validRoom,
      selectedProduct: validProduct,
    });
    const next = markReadyToRenderTransition(session);
    expect(next.status).toBe("ready_to_render");
  });

  it("throws when status is room_selected", () => {
    const session = makeSession({ status: "room_selected", selectedRoom: validRoom });
    expect(() => markReadyToRenderTransition(session)).toThrow(
      RoomPreviewSessionTransitionError,
    );
  });

  it("throws when selectedRoom.imageUrl is missing", () => {
    const session = makeSession({
      status: "product_selected",
      selectedRoom: { source: "camera", imageUrl: null },
      selectedProduct: validProduct,
    });
    expect(() => markReadyToRenderTransition(session)).toThrow(
      RoomPreviewSessionTransitionError,
    );
  });

  it("throws when selectedProduct.id is missing", () => {
    const session = makeSession({
      status: "product_selected",
      selectedRoom: validRoom,
      selectedProduct: { ...validProduct, id: null },
    });
    expect(() => markReadyToRenderTransition(session)).toThrow(
      RoomPreviewSessionTransitionError,
    );
  });
});

// ─── startRenderingTransition ─────────────────────────────────────────────────

describe("startRenderingTransition", () => {
  it("transitions from ready_to_render to rendering", () => {
    const session = makeSession({ status: "ready_to_render" });
    const next = startRenderingTransition(session);
    expect(next.status).toBe("rendering");
  });

  it.each(["product_selected", "result_ready", "failed"] as const)(
    "throws when status is %s",
    (status) => {
      const session = makeSession({ status });
      expect(() => startRenderingTransition(session)).toThrow(
        RoomPreviewSessionTransitionError,
      );
    },
  );
});

// ─── completeRenderingTransition ──────────────────────────────────────────────

describe("completeRenderingTransition", () => {
  const renderingSession = makeSession({
    status: "rendering",
    selectedRoom: validRoom,
    selectedProduct: validProduct,
  });

  it("transitions from rendering to result_ready with a valid result", () => {
    const next = completeRenderingTransition(renderingSession, validRenderResult);
    expect(next.status).toBe("result_ready");
    expect(next.renderResult).toEqual(validRenderResult);
  });

  it("throws when result is missing imageUrl", () => {
    const badResult = { ...validRenderResult, imageUrl: null };
    expect(() => completeRenderingTransition(renderingSession, badResult)).toThrow(
      RoomPreviewSessionTransitionError,
    );
  });

  it("throws when result is missing jobId", () => {
    const badResult = { ...validRenderResult, jobId: null };
    expect(() => completeRenderingTransition(renderingSession, badResult)).toThrow(
      RoomPreviewSessionTransitionError,
    );
  });

  it("throws when result is missing generatedAt", () => {
    const badResult = { ...validRenderResult, generatedAt: null };
    expect(() => completeRenderingTransition(renderingSession, badResult)).toThrow(
      RoomPreviewSessionTransitionError,
    );
  });

  it("throws when kind is not composited_preview", () => {
    const badResult = { ...validRenderResult, kind: null };
    expect(() =>
      completeRenderingTransition(renderingSession, badResult as RoomPreviewRenderResult),
    ).toThrow(RoomPreviewSessionTransitionError);
  });

  it("throws when session is not in rendering state", () => {
    const session = makeSession({ status: "ready_to_render" });
    expect(() => completeRenderingTransition(session, validRenderResult)).toThrow(
      RoomPreviewSessionTransitionError,
    );
  });
});

// ─── failRenderingTransition ──────────────────────────────────────────────────

describe("failRenderingTransition", () => {
  it("transitions from ready_to_render to failed", () => {
    const session = makeSession({ status: "ready_to_render" });
    const next = failRenderingTransition(session);
    expect(next.status).toBe("failed");
  });

  it("transitions from rendering to failed", () => {
    const session = makeSession({ status: "rendering" });
    const next = failRenderingTransition(session);
    expect(next.status).toBe("failed");
  });

  it.each(["product_selected", "result_ready", "expired"] as const)(
    "throws when status is %s",
    (status) => {
      const session = makeSession({ status });
      expect(() => failRenderingTransition(session)).toThrow(
        RoomPreviewSessionTransitionError,
      );
    },
  );
});

// ─── Full happy-path state walk ───────────────────────────────────────────────

describe("full state machine walk", () => {
  it("walks through the complete happy path without throwing", () => {
    let s = createRoomPreviewSessionState("walk-test");
    expect(s.status).toBe("waiting_for_mobile");

    s = connectMobileTransition(s);
    expect(s.status).toBe("mobile_connected");

    s = selectRoomTransition(s, validRoom);
    expect(s.status).toBe("room_selected");

    s = selectProductTransition(s, validProduct);
    expect(s.status).toBe("product_selected");

    s = markReadyToRenderTransition(s);
    expect(s.status).toBe("ready_to_render");

    s = startRenderingTransition(s);
    expect(s.status).toBe("rendering");

    s = completeRenderingTransition(s, validRenderResult);
    expect(s.status).toBe("result_ready");
    expect(s.renderResult).toEqual(validRenderResult);
  });
});
