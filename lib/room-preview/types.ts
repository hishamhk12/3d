export type RoomPreviewRoomSource = "camera" | "gallery" | "demo";
export type QuadPoint = {
  x: number;
  y: number;
};

export type FloorQuad = readonly [QuadPoint, QuadPoint, QuadPoint, QuadPoint];
export type ProductType = "floor_material";
export type RoomPreviewProductType = ProductType;
export type RoomPreviewRenderJobStatus = "pending" | "processing" | "completed" | "failed";
export type RoomPreviewRenderKind = "composited_preview";

export const ROOM_PREVIEW_SESSION_STATUSES = [
  "created",
  "waiting_for_mobile",
  "mobile_connected",
  "room_selected",
  "product_selected",
  "ready_to_render",
  "rendering",
  "result_ready",
  "completed",
  "failed",
  "expired",
] as const;

export type RoomPreviewSessionStatus = (typeof ROOM_PREVIEW_SESSION_STATUSES)[number];

export type RoomPreviewApiErrorCode =
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  | "SESSION_NOT_FOUND"
  | "SESSION_EXPIRED"
  | "SESSION_CREATE_FAILED"
  | "SESSION_INVALID_STATE"
  | "PRODUCT_NOT_FOUND"
  | "ROOM_UPLOAD_MISSING_FILE"
  | "ROOM_UPLOAD_INVALID_MIME_TYPE"
  | "ROOM_UPLOAD_INVALID_IMAGE"
  | "ROOM_UPLOAD_FILE_TOO_LARGE"
  | "ROOM_UPLOAD_SAVE_FAILED"
  | "ROOM_UPLOAD_VERIFY_FAILED"
  | "ROOM_UPLOAD_ABORTED";

export type SelectedRoom = {
  source: RoomPreviewRoomSource | null;
  imageUrl: string | null;
  demoRoomId?: string | null;
  floorQuad?: FloorQuad | null;
  previewRegion?: RoomPreviewPreviewRegion | null;
};

export type SelectedProduct = {
  id: string | null;
  barcode: string | null;
  name: string | null;
  productType: ProductType | null;
  imageUrl: string | null;
};

export type RenderResult = {
  imageUrl: string | null;
  kind: RoomPreviewRenderKind | null;
  jobId: string | null;
  generatedAt: string | null;
  modelName: string | null;
};
export type RoomPreviewRenderResult = RenderResult;

export type RoomPreviewPreviewRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type RoomPreviewSession = {
  id: string;
  status: RoomPreviewSessionStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  mobileConnected: boolean;
  selectedRoom: SelectedRoom | null;
  selectedProduct: SelectedProduct | null;
  renderResult: RoomPreviewRenderResult | null;
};

export type RoomPreviewSessionResponse = RoomPreviewSession;

export type ConnectRoomPreviewSessionResponse = RoomPreviewSession;

export type DemoRoom = {
  id: string;
  name: string;
  imageUrl: string;
  floorQuad: FloorQuad | null;
  previewRegion: RoomPreviewPreviewRegion | null;
};

export type RoomPreviewProduct = {
  id: string;
  barcode: string | null;
  name: string;
  productType: ProductType;
  imageUrl: string;
};

/** @deprecated Use RoomPreviewProduct */
export type MockRoomPreviewProduct = RoomPreviewProduct;

export type SaveRoomPreviewSessionRoomResponse = {
  success: true;
  room: SelectedRoom;
};

export type SaveRoomPreviewSessionResult = {
  room: SelectedRoom;
  session: RoomPreviewSession;
};

export type SaveRoomPreviewSessionProductResponse = {
  success: true;
  product: SelectedProduct;
};

export type SaveRoomPreviewSessionProductResult = {
  product: SelectedProduct;
  session: RoomPreviewSession;
};

export type CreateRoomPreviewSessionResponse = {
  sessionId: string;
  /** HMAC session token — used by MobileLauncherClient to build the activate URL. */
  token: string | undefined;
};

export type RoomPreviewApiErrorResponse = {
  code?: RoomPreviewApiErrorCode;
  error: string;
};

export type RoomPreviewSessionEventType = "session_updated";

export type RoomPreviewSessionEvent = {
  sessionId: string;
  type: RoomPreviewSessionEventType;
  session: RoomPreviewSession;
};

export type RoomPreviewSessionRoom = SelectedRoom;
export type RoomPreviewSessionProduct = SelectedProduct;

export type RenderJobInput = {
  product: SelectedProduct;
  room: SelectedRoom;
  sessionId: string;
};

export type RenderJobResult = {
  imageUrl: string | null;
  kind: RoomPreviewRenderKind;
  generatedAt: string;
  modelName: string | null;
};

export type RoomPreviewRenderJob = {
  id: string;
  sessionId: string;
  status: RoomPreviewRenderJobStatus;
  input: RenderJobInput;
  result: RenderJobResult | null;
  createdAt: string;
  updatedAt: string;
};
