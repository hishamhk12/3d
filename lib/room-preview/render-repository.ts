import "server-only";

import { Prisma } from "@/lib/generated/prisma";
import type {
  RenderJobInput,
  RenderJobResult,
  RoomPreviewRenderJob,
  RoomPreviewRenderJobStatus,
} from "@/lib/room-preview/types";
import { prisma } from "@/lib/server/prisma";

type CreateRenderJobInput = {
  input: RenderJobInput;
  sessionId: string;
  status: RoomPreviewRenderJobStatus;
  inputHash?: string;
};

type UpdateRenderJobInput = {
  result?: RenderJobResult | null;
  status?: RoomPreviewRenderJobStatus;
};

function toIsoString(value: Date | string) {
  return typeof value === "string" ? value : value.toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRenderJobInput(value: unknown): value is RenderJobInput {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.sessionId === "string" &&
    isRecord(value.room) &&
    typeof value.room.imageUrl === "string" &&
    typeof value.room.source === "string" &&
    isRecord(value.product) &&
    typeof value.product.id === "string" &&
    typeof value.product.imageUrl === "string" &&
    typeof value.product.name === "string"
  );
}

function isRenderJobResult(value: unknown): value is RenderJobResult {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (typeof value.imageUrl === "string" || value.imageUrl === null) &&
    value.kind === "composited_preview" &&
    typeof value.generatedAt === "string" &&
    // modelName is optional for backwards-compat with records written before this field was added
    (value.modelName === undefined || typeof value.modelName === "string" || value.modelName === null)
  );
}

function toJsonValue(value: RenderJobInput | RenderJobResult | null | undefined) {
  if (value === undefined) {
    return undefined;
  }

  return value === null ? Prisma.JsonNull : value;
}

function mapRenderJob(job: {
  id: string;
  sessionId: string;
  status: string;
  input: unknown;
  result: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
}): RoomPreviewRenderJob {
  return {
    id: job.id,
    sessionId: job.sessionId,
    status: job.status as RoomPreviewRenderJobStatus,
    input: isRenderJobInput(job.input)
      ? job.input
      : {
          product: {
            barcode: null,
            id: "",
            imageUrl: "",
            name: "",
            productType: "floor_material",
          },
          room: {
            floorQuad: null,
            imageUrl: "",
            previewRegion: null,
            source: "demo",
          },
          sessionId: job.sessionId,
        },
    result: isRenderJobResult(job.result)
      ? { ...job.result, modelName: job.result.modelName ?? null }
      : null,
    createdAt: toIsoString(job.createdAt),
    updatedAt: toIsoString(job.updatedAt),
  };
}

export async function createRenderJob(data: CreateRenderJobInput) {
  const job = await prisma.renderJob.create({
    data: {
      sessionId: data.sessionId,
      status: data.status,
      input: data.input,
      result: Prisma.JsonNull,
      ...(data.inputHash ? { inputHash: data.inputHash } : {}),
    },
  });

  return mapRenderJob(job);
}

export async function updateRenderJob(jobId: string, data: UpdateRenderJobInput) {
  const job = await prisma.renderJob.update({
    where: { id: jobId },
    data: {
      status: data.status,
      result: toJsonValue(data.result),
    },
  });

  return mapRenderJob(job);
}
