import type {
  RoomPreviewRenderResult,
  RoomPreviewSession,
  RoomPreviewSessionStatus,
  SelectedProduct,
  SelectedRoom,
} from "@/lib/room-preview/types";

export class RoomPreviewSessionTransitionError extends Error {
  code = "SESSION_INVALID_STATE" as const;
  currentStatus: RoomPreviewSessionStatus;

  constructor(message: string, currentStatus: RoomPreviewSessionStatus) {
    super(message);
    this.name = "RoomPreviewSessionTransitionError";
    this.currentStatus = currentStatus;
  }
}

function getTimestamp() {
  return new Date().toISOString();
}

function touchSession(
  session: RoomPreviewSession,
  updates: Partial<RoomPreviewSession>,
): RoomPreviewSession {
  return {
    ...session,
    ...updates,
    updatedAt: getTimestamp(),
  };
}

function isLockedStatus(status: RoomPreviewSessionStatus) {
  return (
    status === "ready_to_render" ||
    status === "rendering" ||
    status === "result_ready" ||
    status === "completed" ||
    status === "expired"
  );
}

export function createRoomPreviewSessionState(sessionId: string): RoomPreviewSession {
  const timestamp = getTimestamp();

  return {
    id: sessionId,
    status: "waiting_for_mobile",
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt: null,
    mobileConnected: false,
    selectedRoom: null,
    selectedProduct: null,
    renderResult: null,
  };
}

function assertAllowedStatus(
  session: RoomPreviewSession,
  allowedStatuses: RoomPreviewSessionStatus[],
  message: string,
) {
  if (!allowedStatuses.includes(session.status)) {
    throw new RoomPreviewSessionTransitionError(
      message,
      session.status,
    );
  }
}

function assertValidSelectedRoom(room: SelectedRoom) {
  if (!room.source || !room.imageUrl) {
    throw new RoomPreviewSessionTransitionError(
      "A valid room selection is required.",
      "mobile_connected",
    );
  }
}

function assertValidSelectedProduct(product: SelectedProduct) {
  if (
    !product.id ||
    !product.imageUrl ||
    !product.name ||
    product.productType !== "floor_material"
  ) {
    throw new RoomPreviewSessionTransitionError(
      "A valid product selection is required.",
      "room_selected",
    );
  }
}

export function connectMobileTransition(session: RoomPreviewSession): RoomPreviewSession {
  if (isLockedStatus(session.status)) {
    throw new RoomPreviewSessionTransitionError(
      "This session can no longer accept a mobile connection.",
      session.status,
    );
  }

  assertAllowedStatus(
    session,
    ["created", "waiting_for_mobile"],
    "This session is not waiting for a mobile connection.",
  );

  const nextSession = {
    ...session,
    mobileConnected: true,
  };

  return touchSession(nextSession, {
    status: "mobile_connected",
  });
}

export function selectRoomTransition(
  session: RoomPreviewSession,
  room: SelectedRoom,
): RoomPreviewSession {
  if (isLockedStatus(session.status)) {
    throw new RoomPreviewSessionTransitionError(
      "This session can no longer accept a room selection.",
      session.status,
    );
  }

  assertAllowedStatus(
    session,
    ["mobile_connected", "room_selected", "failed"],
    "Connect the mobile device before selecting a room.",
  );

  if (!session.mobileConnected) {
    throw new RoomPreviewSessionTransitionError(
      "Connect the mobile device before selecting a room.",
      session.status,
    );
  }

  assertValidSelectedRoom(room);

  const nextSession = {
    ...session,
    selectedRoom: room,
    selectedProduct: session.status === "failed" ? null : session.selectedProduct,
    renderResult: null,
  };

  return touchSession(nextSession, {
    status: "room_selected",
  });
}

export function selectProductTransition(
  session: RoomPreviewSession,
  product: SelectedProduct,
): RoomPreviewSession {
  if (isLockedStatus(session.status)) {
    throw new RoomPreviewSessionTransitionError(
      "This session can no longer accept a product selection.",
      session.status,
    );
  }

  assertAllowedStatus(
    session,
    ["room_selected", "product_selected", "failed"],
    "Select a room before selecting a product.",
  );

  if (!session.mobileConnected) {
    throw new RoomPreviewSessionTransitionError(
      "Connect the mobile device before selecting a product.",
      session.status,
    );
  }

  if (!session.selectedRoom?.imageUrl) {
    throw new RoomPreviewSessionTransitionError(
      "Select a room before selecting a product.",
      session.status,
    );
  }

  assertValidSelectedProduct(product);

  return touchSession(session, {
    selectedProduct: product,
    status: "product_selected",
    renderResult: null,
  });
}

export function markReadyToRenderTransition(session: RoomPreviewSession): RoomPreviewSession {
  assertAllowedStatus(
    session,
    ["product_selected", "failed"],
    "الرجاء اختيار منتج قبل البدء بالتصميم.",
  );

  if (!session.selectedRoom?.imageUrl || !session.selectedProduct?.id) {
    throw new RoomPreviewSessionTransitionError(
      "يجب اختيار غرفة ومنتج قبل البدء بالتصميم.",
      session.status,
    );
  }

  return touchSession(session, {
    status: "ready_to_render",
  });
}

export function startRenderingTransition(session: RoomPreviewSession): RoomPreviewSession {
  assertAllowedStatus(
    session,
    ["ready_to_render"],
    "This session is not ready to begin rendering.",
  );

  return touchSession(session, {
    status: "rendering",
  });
}

export function completeRenderingTransition(
  session: RoomPreviewSession,
  renderResult: RoomPreviewRenderResult,
): RoomPreviewSession {
  assertAllowedStatus(
    session,
    ["rendering"],
    "This session is not currently rendering.",
  );

  if (!renderResult.imageUrl || !renderResult.jobId || !renderResult.generatedAt) {
    throw new RoomPreviewSessionTransitionError(
      "A valid render result is required to complete rendering.",
      session.status,
    );
  }

  if (renderResult.kind !== "composited_preview") {
    throw new RoomPreviewSessionTransitionError(
      "A composited preview result is required to complete rendering.",
      session.status,
    );
  }

  return touchSession(session, {
    renderResult,
    status: "result_ready",
  });
}

export function failRenderingTransition(session: RoomPreviewSession): RoomPreviewSession {
  assertAllowedStatus(
    session,
    ["ready_to_render", "rendering"],
    "This session cannot be marked as failed right now.",
  );

  return touchSession(session, {
    status: "failed",
  });
}
