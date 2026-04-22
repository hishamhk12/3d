import "server-only";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createReadStream } from "node:fs";
import OpenAI, { toFile } from "openai";
import { getRoomPreviewPublicAssetPath } from "@/lib/room-preview/local-assets";
import { buildRenderPrompt } from "@/lib/room-preview/prompts";
import type {
  RoomPreviewRenderProvider,
  RoomPreviewRenderProviderRequest,
  RoomPreviewRenderProviderResult,
} from "@/lib/room-preview/render-providers/types";
import type { ProductType } from "@/lib/room-preview/types";

const ROOM_PREVIEW_RENDER_OUTPUT_DIRECTORY = path.join(
  process.cwd(),
  "public",
  "uploads",
  "room-preview",
  "renders",
);

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  return new OpenAI({ apiKey });
}

function createRenderOutputTarget(options: { jobId: string; sessionId: string }) {
  const fileName = `${options.sessionId}-${options.jobId}.png`;

  return {
    fileName,
    filePath: path.join(ROOM_PREVIEW_RENDER_OUTPUT_DIRECTORY, fileName),
    imageUrl: `/uploads/room-preview/renders/${fileName}`,
  };
}


async function loadPublicImageAsUploadable(publicAssetUrl: string, defaultFileName: string) {
  const absoluteAssetPath = getRoomPreviewPublicAssetPath(publicAssetUrl);
  const extension = path.extname(absoluteAssetPath).toLowerCase();
  const mimeType =
    extension === ".jpg" || extension === ".jpeg"
      ? "image/jpeg"
      : extension === ".webp"
        ? "image/webp"
        : "image/png";

  return toFile(createReadStream(absoluteAssetPath), defaultFileName, {
    type: mimeType,
  });
}

export const aiRoomPreviewRenderProvider = {
  name: "openai-ai-renderer",
  async render(
    request: RoomPreviewRenderProviderRequest,
  ): Promise<RoomPreviewRenderProviderResult> {
    const { product, room, sessionId } = request.renderJobInput;

    if (!room.imageUrl) {
      throw new Error("A room image is required for AI rendering.");
    }

    if (!product.imageUrl) {
      throw new Error("A product image is required for AI rendering.");
    }

    // Build prompt via the shared canonical builder (unused by mock but keeps
    // the provider structurally correct for when the real implementation lands).
    void buildRenderPrompt(product.productType ?? null, product.name ?? null);

    // MOCK: Simulate rendering time
    await new Promise((resolve) => setTimeout(resolve, 2000));

    return {
      generatedAt: new Date().toISOString(),
      imageUrl: "/rs/rs.png",
      kind: "composited_preview",
      modelName: "openai-mock",
    };
  },
} satisfies RoomPreviewRenderProvider;
