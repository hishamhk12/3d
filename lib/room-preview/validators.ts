import type {
  ConnectRoomPreviewSessionResponse,
  CreateRoomPreviewSessionResponse,
  DirectUploadUrlResponse,
  FloorQuad,
  ProductCategory,
  ProductType,
  QuadPoint,
  TargetSurface,
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

export function isFloorMaterialProductType(value: unknown): value is "floor_material" {
  return value === "floor_material";
}

export function isProductType(value: unknown): value is ProductType {
  return value === "floor_material" || value === "wall_material";
}

export function isProductCategory(value: unknown): value is ProductCategory {
  return value === "PARQUET" || value === "WALLPAPER";
}

export function isTargetSurface(value: unknown): value is TargetSurface {
  return value === "floor" || value === "walls";
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
    (value.productType === null || isProductType(value.productType)) &&
    (typeof value.imageUrl === "string" || value.imageUrl === null) &&
    // category / targetSurface are optional for backward compatibility with
    // sessions persisted before the wallpaper rollout. Validate only if present.
    (!("category" in value) || value.category === undefined || isProductCategory(value.category)) &&
    (!("targetSurface" in value) || value.targetSurface === undefined || isTargetSurface(value.targetSurface))
  );
}

/**
 * Default classification applied to a persisted product that predates the
 * wallpaper rollout (or any product missing category/targetSurface). Keeps old
 * sessions rendering as PARQUET / floor exactly as before.
 */
export function normalizeSelectedProductClassification(product: SelectedProduct): {
  category: ProductCategory;
  targetSurface: TargetSurface;
} {
  return {
    category: product.category ?? "PARQUET",
    targetSurface: product.targetSurface ?? "floor",
  };
}

export function roomHasValidFloorQuad(
  value: SelectedRoom | null | undefined,
): value is SelectedRoom & { floorQuad: FloorQuad } {
  return Boolean(value?.imageUrl && value.floorQuad && isFloorQuad(value.floorQuad));
}

export function isFloorMaterialProduct(
  value: SelectedProduct | null | undefined,
): value is SelectedProduct & { productType: "floor_material" } {
  return Boolean(
    value?.id &&
      value.imageUrl &&
      value.name &&
      value.productType &&
      isFloorMaterialProductType(value.productType),
  );
}

/**
 * A product that has the fields required to start a render AND a supported
 * product type (floor or wall material). Replaces the floor-only gate so
 * wallpaper products can render while still rejecting unknown/empty products.
 */
export function isRenderableProduct(
  value: SelectedProduct | null | undefined,
): value is SelectedProduct & { productType: ProductType } {
  return Boolean(
    value?.id &&
      value.imageUrl &&
      value.name &&
      value.productType &&
      isProductType(value.productType),
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
    typeof value.mobileConnected !== "boolean" ||
    (value.customerRoleSelected !== undefined &&
      typeof value.customerRoleSelected !== "boolean")
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
  return isRecord(value) && value.success === true && isSelectedRoom(value.room) && isRoomPreviewSession(value.session);
}

export function isSaveRoomPreviewSessionProductResponse(
  value: unknown,
): value is SaveRoomPreviewSessionProductResponse {
  return isRecord(value) && value.success === true && isSelectedProduct(value.product) && isRoomPreviewSession(value.session);
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

export function isDirectUploadUrlResponse(value: unknown): value is DirectUploadUrlResponse {
  return (
    isRecord(value) &&
    typeof value.uploadUrl === "string" &&
    typeof value.objectKey === "string" &&
    typeof value.publicUrl === "string" &&
    value.method === "PUT" &&
    isRecord(value.headers)
  );
}
