import "server-only";

import { geminiRoomPreviewRenderProvider } from "@/lib/room-preview/render-providers/gemini-provider";
import type {
  RoomPreviewRenderProvider,
  RoomPreviewRenderProviderRequest,
  RoomPreviewRenderProviderResult,
} from "@/lib/room-preview/render-providers/types";

export function getRoomPreviewRenderProvider() {
  return geminiRoomPreviewRenderProvider satisfies RoomPreviewRenderProvider;
}

export async function renderRoomPreviewWithProvider(
  request: RoomPreviewRenderProviderRequest,
): Promise<RoomPreviewRenderProviderResult> {
  return getRoomPreviewRenderProvider().render(request);
}
