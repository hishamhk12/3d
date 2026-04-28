import type {
  ConnectRoomPreviewSessionResponse,
  CreateRoomPreviewSessionResponse,
  FloorQuad,
  ProductType,
  QuadPoint,
  RoomPreviewApiErrorResponse,
  RoomPreviewPreviewRegion,
  RoomPreviewRenderResult,
  RoomPreviewSession,
  RoomPreviewSessionResponse,
  RoomPreviewSessionStatus,
  SaveRoomPreviewSessionProductResponse,
  SaveRoomPreviewSessionRoomResponse,
  SelectedProduct,
  SelectedRoom,
} from "@/lib/room-preview/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRoomPreviewSessionStatus(value: unknown): value is RoomPreviewSessionStatus {
  return (
    value === "created" ||
    value === "waiting_for_mobile" ||
    value === "mobile_connected" ||
    value === "room_selected" ||
    value === "product_selected" ||
    value === "ready_to_render" ||
    value === "rendering" ||
    value === "result_ready" ||
    value === "failed" ||
    value === "expired"
  );
}

export function isQuadPoint(value: unknown): value is QuadPoint {
  if (!isRecord(value)) {
    return false;
  }

  return isFiniteNumber(value.x) && isFiniteNumber(value.y);
}

export function hasFourQuadPoints(value: unknown): value is [unknown, unknown, unknown, unknown] {
  return Array.isArray(value) && value.length === 4;
}

export function isFloorQuad(value: unknown): value is FloorQuad {
  return hasFourQuadPoints(value) && value.every(isQuadPoint);
}

export function isFloorMaterialProductType(value: unknown): value is ProductType {
  return value === "floor_material";
}

function isRoomPreviewPreviewRegion(value: unknown): value is RoomPreviewPreviewRegion {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.x === "number" &&
    typeof value.y === "number" &&
    typeof value.width === "number" &&
    typeof value.height === "number"
  );
}

export function isRoomPreviewApiErrorResponse(
  data: unknown,
): data is RoomPreviewApiErrorResponse {
  return isRecord(data) && typeof data.error === "string";
}

export function isSelectedRoom(value: unknown): value is SelectedRoom {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.source === "camera" ||
      value.source === "gallery" ||
      value.source === "demo" ||
      value.source === null) &&
    (typeof value.imageUrl === "string" || value.imageUrl === null) &&
    (!("demoRoomId" in value) ||
      typeof value.demoRoomId === "string" ||
      value.demoRoomId === null) &&
    (!("floorQuad" in value) ||
      value.floorQuad === null ||
      isFloorQuad(value.floorQuad)) &&
    (!("previewRegion" in value) ||
      value.previewRegion === null ||
      isRoomPreviewPreviewRegion(value.previewRegion))
  );
}

export function isSelectedProduct(value: unknown): value is SelectedProduct {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (typeof value.id === "string" || value.id === null) &&
    (typeof value.barcode === "string" || value.barcode === null) &&
    (typeof value.name === "string" || value.name === null) &&
    (value.productType === null || isFloorMaterialProductType(value.productType)) &&
    (typeof value.imageUrl === "string" || value.imageUrl === null)
  );
}

export function roomHasValidFloorQuad(
  value: SelectedRoom | null | undefined,
): value is SelectedRoom & { floorQuad: FloorQuad } {
  return Boolean(value?.imageUrl && value.floorQuad && isFloorQuad(value.floorQuad));
}

export function isFloorMaterialProduct(
  value: SelectedProduct | null | undefined,
): value is SelectedProduct & { productType: ProductType } {
  return Boolean(
    value?.id &&
      value.imageUrl &&
      value.name &&
      value.productType &&
      isFloorMaterialProductType(value.productType),
  );
}

export function isRoomPreviewRenderResult(value: unknown): value is RoomPreviewRenderResult {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (typeof value.imageUrl === "string" || value.imageUrl === null) &&
    (value.kind === "composited_preview" || value.kind === null) &&
    (typeof value.jobId === "string" || value.jobId === null) &&
    (typeof value.generatedAt === "string" || value.generatedAt === null)
  );
}

export function isRoomPreviewSession(value: unknown): value is RoomPreviewSession {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !isRoomPreviewSessionStatus(value.status) ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    typeof value.mobileConnected !== "boolean"
  ) {
    return false;
  }

  return (
    (value.selectedRoom === null || isSelectedRoom(value.selectedRoom)) &&
    (value.selectedProduct === null || isSelectedProduct(value.selectedProduct)) &&
    (value.renderResult === null || isRoomPreviewRenderResult(value.renderResult))
  );
}

export function isCreateRoomPreviewSessionResponse(
  value: unknown,
): value is CreateRoomPreviewSessionResponse {
  return isRecord(value) && typeof value.sessionId === "string";
}

export function isConnectRoomPreviewSessionResponse(
  value: unknown,
): value is ConnectRoomPreviewSessionResponse {
  return isRoomPreviewSessionResponse(value);
}

export function isSaveRoomPreviewSessionRoomResponse(
  value: unknown,
): value is SaveRoomPreviewSessionRoomResponse {
  return isRecord(value) && value.success === true && isSelectedRoom(value.room);
}

export function isSaveRoomPreviewSessionProductResponse(
  value: unknown,
): value is SaveRoomPreviewSessionProductResponse {
  return isRecord(value) && value.success === true && isSelectedProduct(value.product);
}

export function assertValidResponse<T>(
  data: unknown,
  isValid: (value: unknown) => value is T,
  message: string,
) {
  if (!isValid(data)) {
    throw new Error(message);
  }

  return data;
}

export function isRoomPreviewSessionResponse(
  value: unknown,
): value is RoomPreviewSessionResponse {
  return isRoomPreviewSession(value);
}
