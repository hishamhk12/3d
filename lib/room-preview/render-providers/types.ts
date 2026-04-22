import type { RenderJobInput } from "@/lib/room-preview/types";

export type RoomPreviewRenderProviderResult = {
  generatedAt: string;
  imageUrl: string;
  kind: "composited_preview";
  /** The Gemini (or other) model name that produced this image. */
  modelName: string;
};

export type RoomPreviewRenderProviderRequest = {
  jobId: string;
  renderJobInput: RenderJobInput;
  sessionId: string;
};

export type RoomPreviewRenderProvider = {
  name: string;
  render: (
    request: RoomPreviewRenderProviderRequest,
  ) => Promise<RoomPreviewRenderProviderResult>;
};
