import "server-only";

// Deprecated transitional wrapper. Real orchestration lives in session-service.ts.
export {
  connectMobileToSession as connectRoomPreviewSession,
  createRoomPreviewSession,
  getRoomPreviewSession,
  selectProductForSession as selectRoomPreviewSessionProduct,
  selectRoomForSession as selectRoomPreviewSessionRoom,
} from "@/lib/room-preview/session-service";
