import "server-only";

import type {
  DemoRoom,
  FloorQuad,
  RoomPreviewPreviewRegion,
} from "@/lib/room-preview/types";
import { getRoomPreviewAssetFiles } from "@/lib/room-preview/local-assets";

const ROOM_PREVIEW_DEMO_ROOM_FLOOR_QUADS: Record<string, FloorQuad> = {
  "room-closed-window-furniture-19024056": [
    { x: 175, y: 355 },
    { x: 625, y: 355 },
    { x: 795, y: 515 },
    { x: 5, y: 515 },
  ],
};

const ROOM_PREVIEW_DEMO_ROOM_REGIONS: Record<string, RoomPreviewPreviewRegion> = {
  "room-closed-window-furniture-19024056": {
    x: 70,
    y: 360,
    width: 660,
    height: 150,
  },
};

export function getRoomPreviewDemoRooms() {
  return getRoomPreviewAssetFiles(["test-assets", "rooms"]).map((room) => ({
    id: room.id,
    name: room.name,
    imageUrl: room.imageUrl,
    floorQuad: ROOM_PREVIEW_DEMO_ROOM_FLOOR_QUADS[room.id] ?? null,
    previewRegion: ROOM_PREVIEW_DEMO_ROOM_REGIONS[room.id] ?? null,
  })) satisfies DemoRoom[];
}

export function getRoomPreviewDemoRoom(demoRoomId: string) {
  return getRoomPreviewDemoRooms().find((room) => room.id === demoRoomId) ?? null;
}
