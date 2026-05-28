import "server-only";

import {
  PROMPT_VERSION,
  PROMPT_VERSION_FAST,
} from "@/lib/room-preview/prompt-template-v2";

// ─── Model list ───────────────────────────────────────────────────────────────

// ROOM_PREVIEW_GEMINI_IMAGE_MODEL (single) takes precedence over GEMINI_IMAGE_MODELS (comma list).
export const GEMINI_IMAGE_MODELS: readonly string[] = (() => {
  const single = process.env.ROOM_PREVIEW_GEMINI_IMAGE_MODEL?.trim();
  if (single) return [single];
  const multi = process.env.GEMINI_IMAGE_MODELS;
  if (multi) return multi.split(",").map((m) => m.trim()).filter(Boolean);
  return ["gemini-3.1-flash-image-preview"];
})();

// ─── Retry constants ──────────────────────────────────────────────────────────

export const MAX_RETRIES = 3;
export const BASE_DELAY_MS = 3_000;

// ─── Timeout constants ────────────────────────────────────────────────────────

// Legacy single timeout — kept for backward compat in diagnostics, but no longer
// used to gate individual attempts. Superseded by the two per-attempt constants below.
export const GEMINI_CALL_TIMEOUT_MS = (() => {
  const raw = Number(process.env.GEMINI_CALL_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return 150_000;
  return Math.max(60_000, Math.min(raw, 240_000));
})();

// Per-attempt timeouts for showroom UX.
// First attempt uses a tight window so a stuck Gemini call doesn't make the customer
// wait before we retry. Retry gets a longer budget for the smaller-image second pass.
// Clamped: first 5–120 s, retry 30–240 s.
export const GEMINI_FIRST_ATTEMPT_TIMEOUT_MS = (() => {
  const raw = Number(process.env.ROOM_PREVIEW_GEMINI_FIRST_ATTEMPT_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return 30_000;
  return Math.max(5_000, Math.min(raw, 120_000));
})();

export const GEMINI_RETRY_ATTEMPT_TIMEOUT_MS = (() => {
  const raw = Number(process.env.ROOM_PREVIEW_GEMINI_RETRY_ATTEMPT_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return 60_000;
  return Math.max(30_000, Math.min(raw, 240_000));
})();


// ─── Output validation thresholds ────────────────────────────────────────────

export const MIN_OUTPUT_BYTES = 10_000;
export const MIN_OUTPUT_DIMENSION_PX = 400;
export const MAX_ASPECT_RATIO_DRIFT = 0.02;
export const REJECT_ASPECT_RATIO_DRIFT = 0.05;

// ─── Render quality mode ──────────────────────────────────────────────────────
//
// ROOM_PREVIEW_RENDER_QUALITY=fast|balanced|quality
//   fast:     1024 px long edge, short prompt — fastest, good for testing
//   balanced: 1280 px long edge, full prompt  — default
//   quality:  1600 px long edge, full prompt  — best detail, slower
//
// ROOM_PREVIEW_RENDER_LONG_EDGE=<px> — explicit long-edge override; takes
//   precedence over quality mode. Product long edge scales at 60% of room.

export type RenderQuality = "fast" | "balanced" | "quality";

export const RENDER_QUALITY: RenderQuality = (() => {
  const raw = process.env.ROOM_PREVIEW_RENDER_QUALITY;
  if (raw === "fast" || raw === "balanced" || raw === "quality") return raw;
  return "balanced";
})();

export const LONG_EDGE_OVERRIDE: number | null = (() => {
  const raw = parseInt(process.env.ROOM_PREVIEW_RENDER_LONG_EDGE ?? "", 10);
  return Number.isFinite(raw) && raw >= 512 ? Math.min(raw, 2048) : null;
})();

export const QUALITY_ROOM_LONG_EDGE: Record<RenderQuality, number> = {
  fast:     1024,
  balanced: 1280,
  quality:  1600,
};

export const QUALITY_PRODUCT_LONG_EDGE: Record<RenderQuality, number> = {
  fast:    640,
  balanced: 768,
  quality:  960,
};

/** Long edge (px) for room images sent to Gemini — fit: "inside", no crop. */
export const MAX_IMAGE_DIMENSION_PX: number =
  LONG_EDGE_OVERRIDE ?? QUALITY_ROOM_LONG_EDGE[RENDER_QUALITY];

/** Long edge (px) for product images sent to Gemini. */
export const MAX_PRODUCT_IMAGE_DIMENSION_PX: number = LONG_EDGE_OVERRIDE !== null
  ? Math.round(LONG_EDGE_OVERRIDE * 0.6)
  : QUALITY_PRODUCT_LONG_EDGE[RENDER_QUALITY];

/** Prompt variant driven by quality mode: fast uses the shorter fast-v1 prompt. */
export const PROMPT_VARIANT: "fast" | "v4" = RENDER_QUALITY === "fast" ? "fast" : "v4";
export const ACTIVE_PROMPT_VERSION = PROMPT_VARIANT === "fast" ? PROMPT_VERSION_FAST : PROMPT_VERSION;

// Smaller fallback dimensions used on the one-shot timeout retry.
export const TIMEOUT_RETRY_ROOM_MAX_PX    = 1024;
export const TIMEOUT_RETRY_PRODUCT_MAX_PX = 640;

/** When true, raw buffers are saved under debug/render-jobs/{sessionId}/{jobId}/. */
export const DEBUG_ARTIFACTS_ENABLED = process.env.ROOM_PREVIEW_DEBUG_RENDER_ARTIFACTS === "true";
