import "server-only";

import { createHash } from "node:crypto";

import type {
  RenderJobInput,
  RenderJobResult,
  RoomPreviewSession,
} from "@/lib/room-preview/types";
import type { RoomPreviewRenderProviderResult } from "@/lib/room-preview/render-providers/types";
import { isRenderableProduct } from "@/lib/room-preview/validators";
import {
  COMPOSITE_REFERENCE_ORDER,
  getPrimarySelectedProduct,
  getSelectedProductCount,
  isSupportedRenderProductCombination,
  normalizeSelectedProducts,
} from "@/lib/room-preview/selected-products";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum age before a `pending` / `processing` render job is considered stuck. */
export const STUCK_RENDER_THRESHOLD_MS = 8 * 60 * 1_000; // 8 minutes

// ─── Failure-reason helpers ───────────────────────────────────────────────────

/**
 * Returns the typed `failureReason` carried on an error (e.g. `gemini_timeout`)
 * or `null` for any other thrown value.
 */
export function getFailureReason(err: unknown): string | null {
  if (
    err &&
    typeof err === "object" &&
    "failureReason" in err &&
    typeof (err as { failureReason?: unknown }).failureReason === "string"
  ) {
    return (err as { failureReason: string }).failureReason;
  }
  return null;
}

/**
 * Picks the best failure reason string to store on a failed `RenderJob` row:
 *   1. The typed `failureReason` from the error, if present.
 *   2. Otherwise the truncated `error.message` (500-char cap).
 *   3. Otherwise the constant `"Unknown render error"`.
 */
export function buildFailedRenderJobReason(
  err: unknown,
  typedReason: string | null,
): string {
  return typedReason ?? (err instanceof Error ? err.message.slice(0, 500) : "Unknown render error");
}

// ─── Render-job input ─────────────────────────────────────────────────────────

/**
 * Validates that a session has the room/product fields required to start a
 * render and returns the typed `RenderJobInput` payload for the provider.
 *
 * Throws if any required field is missing or if the product type is not a
 * supported render type (`floor_material` or `wall_material`).
 */
export function buildRenderJobInput(session: RoomPreviewSession): RenderJobInput {
  if (!session.selectedRoom?.imageUrl || !session.selectedRoom.source) {
    throw new Error("A selected room is required before creating a render job.");
  }

  const selectedProductsBySurface = normalizeSelectedProducts(session);

  if (!isSupportedRenderProductCombination(selectedProductsBySurface)) {
    throw new Error("Unsupported product combination for rendering.");
  }

  const selectedProduct = getPrimarySelectedProduct(selectedProductsBySurface);

  if (!selectedProduct?.id || !selectedProduct.imageUrl || !selectedProduct.name) {
    throw new Error("A selected product is required before creating a render job.");
  }

  if (!isRenderableProduct(selectedProduct)) {
    throw new Error("Only floor_material or wall_material products are supported.");
  }

  const selectedProductCount = getSelectedProductCount(selectedProductsBySurface);

  return {
    product: selectedProduct,
    room: session.selectedRoom,
    ...(selectedProductCount === 2
      ? {
          selectedProductsBySurface,
          renderMode: "composite" as const,
          referenceOrder: COMPOSITE_REFERENCE_ORDER,
        }
      : {}),
    sessionId: session.id,
  };
}

/**
 * SHA-256 hash of `${room.imageUrl}::${product.id}` used as the `inputHash` on
 * the render job row for dedup queries. Returns `undefined` when either field
 * is missing so the column is left null.
 */
export function buildRenderJobInputHash(input: RenderJobInput): string | undefined {
  if (!input.room.imageUrl || !input.product.id) return undefined;
  const productHashSegment =
    input.renderMode === "composite" && input.referenceOrder?.length
      ? input.referenceOrder
          .map((surface) => input.selectedProductsBySurface?.[surface]?.id)
          .filter(Boolean)
          .join("::")
      : input.product.id;

  if (!productHashSegment) return undefined;

  return createHash("sha256")
    .update(`${input.room.imageUrl}::${productHashSegment}`)
    .digest("hex");
}

// ─── Provider result → render-job result ──────────────────────────────────────

/** Picks the subset of provider-result fields stored on the render job. */
export function buildRenderJobResult(
  preview: RoomPreviewRenderProviderResult,
): RenderJobResult {
  return {
    imageUrl: preview.imageUrl,
    kind: preview.kind,
    generatedAt: preview.generatedAt,
    modelName: preview.modelName,
  } satisfies RenderJobResult;
}

// ─── Render-timing summary metadata ───────────────────────────────────────────

export type RenderTimingMetadata = {
  renderJobId: string | null;
  status: "completed" | "failed";
  totalMs: number;
  setupMs: number | null;
  providerMs: number | null;
  saveMs: number | null;
};

/**
 * Pure builder for the `render_timing_summary` event metadata. Handles both the
 * success and failure paths via the same conditional-null pattern that was
 * previously inlined in two places. Field names are byte-identical to the
 * original event payload.
 *
 * Caller passes the four raw checkpoint values (0 = not reached) and the
 * already-computed `totalMs` so this function stays clock-free and pure.
 */
export function buildRenderTimingMetadata(params: {
  renderJobId: string | null;
  status: "completed" | "failed";
  totalMs: number;
  tSetupDone: number;
  tProviderDone: number;
  tSaved: number;
}): RenderTimingMetadata {
  const { renderJobId, status, totalMs, tSetupDone, tProviderDone, tSaved } = params;
  return {
    renderJobId,
    status,
    totalMs,
    setupMs:    tSetupDone > 0 ? tSetupDone : null,
    providerMs: tProviderDone > 0 && tSetupDone > 0 ? tProviderDone - tSetupDone : null,
    saveMs:     tSaved > 0 && tProviderDone > 0 ? tSaved - tProviderDone : null,
  };
}
