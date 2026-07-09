export type RoomPreviewRoomSource = "camera" | "gallery" | "demo";
export type QuadPoint = {
  x: number;
  y: number;
};

export type FloorQuad = readonly [QuadPoint, QuadPoint, QuadPoint, QuadPoint];
export type ProductType = "floor_material" | "wall_material";
export type RoomPreviewProductType = ProductType;

/**
 * High-level product family that drives render-strategy + prompt selection.
 * Resolved from the product's source (e.g. the qr-products subfolder), never
 * inferred from the image or guessed by the model.
 */
export type ProductCategory = "PARQUET" | "WALLPAPER";

/** Which surface a category's render strategy targets. */
export type TargetSurface = "floor" | "walls";
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
  | "ROOM_UPLOAD_ABORTED"
  | "DIRECT_UPLOAD_NOT_SUPPORTED"
  | "DIRECT_UPLOAD_FAILED"
  | "UNSUPPORTED_PRODUCT_COMBINATION"
  | "RENDER_LIMIT_REACHED"
  | "RENDER_DEVICE_COOLDOWN"
  | "SCREEN_BUDGET_EXHAUSTED";

export type SelectedRoom = {
  source: RoomPreviewRoomSource | null;
  imageUrl: string | null;
  demoRoomId?: string | null;
  floorQuad?: FloorQuad | null;
  previewRegion?: RoomPreviewPreviewRegion | null;
};

/** Where product data was resolved from. Absent on sessions persisted before
 *  the PDC integration (equivalent to "local"). */
export type ProductSource = "pdc" | "local";

export type ProductImage = {
  type: string;
  url: string;
};

export type SelectedProduct = {
  id: string | null;
  barcode: string | null;
  name: string | null;
  productType: ProductType | null;
  imageUrl: string | null;
  /**
   * Optional for backward compatibility with sessions persisted before the
   * wallpaper rollout. When absent, consumers default to PARQUET / floor.
   */
  category?: ProductCategory;
  targetSurface?: TargetSurface;
  nameAr?: string | null;
  nameEn?: string | null;
  images?: ProductImage[];
  ecommerceUrl?: string | null;
  pdcPageUrl?: string | null;
  source?: ProductSource;
};

export type SelectedProductsBySurface = {
  floor?: SelectedProduct;
  walls?: SelectedProduct;
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
  customerRoleSelected?: boolean;
  selectedRoom: SelectedRoom | null;
  selectedProduct: SelectedProduct | null;
  selectedProductsBySurface?: SelectedProductsBySurface;
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
  category: ProductCategory;
  targetSurface: TargetSurface;
  imageUrl: string;
  nameAr?: string | null;
  nameEn?: string | null;
  images?: ProductImage[];
  ecommerceUrl?: string | null;
  pdcPageUrl?: string | null;
  source?: ProductSource;
};

/** @deprecated Use RoomPreviewProduct */
export type MockRoomPreviewProduct = RoomPreviewProduct;

export type SaveRoomPreviewSessionRoomResponse = {
  success: true;
  room: SelectedRoom;
  session: RoomPreviewSession;
};

export type SaveRoomPreviewSessionResult = {
  room: SelectedRoom;
  session: RoomPreviewSession;
};

export type SaveRoomPreviewSessionProductResponse = {
  success: true;
  product: SelectedProduct;
  session: RoomPreviewSession;
};

export type RemoveRoomPreviewSessionProductResponse = {
  success: true;
  product: SelectedProduct | null;
  session: RoomPreviewSession;
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

export type DirectUploadUrlResponse = {
  uploadUrl: string;
  objectKey: string;
  publicUrl: string;
  method: "PUT";
  headers: Record<string, string>;
};

export type RoomPreviewSessionEventType = "session_updated";

export type RoomPreviewSessionEvent = {
  sessionId: string;
  type: RoomPreviewSessionEventType;
  session: RoomPreviewSession;
};

export type RoomPreviewSessionRoom = SelectedRoom;
export type RoomPreviewSessionProduct = SelectedProduct;

export type RenderMode = "single" | "composite";
export type ProductReferenceOrder = readonly TargetSurface[];

export type RenderJobInput = {
  product: SelectedProduct;
  room: SelectedRoom;
  selectedProductsBySurface?: SelectedProductsBySurface;
  renderMode?: RenderMode;
  referenceOrder?: ProductReferenceOrder;
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
