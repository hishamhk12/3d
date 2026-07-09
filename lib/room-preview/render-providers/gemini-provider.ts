import "server-only";

import type { GoogleGenAI } from "@google/genai";
import {
  PROMPT_VERSION_FAST,
  SENTINEL_FLOOR_NOT_VISIBLE,
  SENTINEL_MATERIAL_UNCLEAR,
} from "@/lib/room-preview/prompt-template-v2";
import {
  resolveCompositeRenderStrategy,
  resolveRenderStrategy,
} from "@/lib/room-preview/render-strategies";
import { COMPOSITE_REFERENCE_ORDER } from "@/lib/room-preview/selected-products";
import { normalizeSelectedProductClassification } from "@/lib/room-preview/validators";
import type { SelectedProduct, TargetSurface } from "@/lib/room-preview/types";
import type {
  RoomPreviewRenderProvider,
  RoomPreviewRenderProviderRequest,
  RoomPreviewRenderProviderResult,
} from "@/lib/room-preview/render-providers/types";
import { storageUpload } from "@/lib/storage";
import { trackSessionEvent } from "@/lib/room-preview/session-diagnostics";
import { getLogger } from "@/lib/logger";
import {
  ACTIVE_PROMPT_VERSION,
  BASE_DELAY_MS,
  DEBUG_ARTIFACTS_ENABLED,
  DEFAULT_GEMINI_IMAGE_MODEL,
  GEMINI_CALL_TIMEOUT_MS,
  GEMINI_FIRST_ATTEMPT_TIMEOUT_MS,
  GEMINI_IMAGE_MODELS,
  GEMINI_IMAGE_MODEL_SOURCE,
  GEMINI_RETRY_ATTEMPT_TIMEOUT_MS,
  LONG_EDGE_OVERRIDE,
  MAX_IMAGE_DIMENSION_PX,
  MAX_PRODUCT_IMAGE_DIMENSION_PX,
  MAX_RETRIES,
  PROMPT_VARIANT,
  RENDER_QUALITY,
  TIMEOUT_RETRY_PRODUCT_MAX_PX,
  TIMEOUT_RETRY_ROOM_MAX_PX,
} from "@/lib/room-preview/render-providers/gemini-config";
export {
  AspectRatioMismatchError,
  GeminiAbortedError,
  GeminiTimeoutError,
  ParallelGeminiAllFailedError,
} from "@/lib/room-preview/render-providers/gemini-errors";
import {
  AspectRatioMismatchError,
  GeminiTimeoutError,
} from "@/lib/room-preview/render-providers/gemini-errors";
import {
  loadAndPrepareImage,
  validateAndNormalizeOutputImage,
} from "@/lib/room-preview/render-providers/gemini-image-utils";
import type { PreparedImage } from "@/lib/room-preview/render-providers/gemini-image-utils";
import {
  generateContentWithTimeout,
  getGeminiClient,
} from "@/lib/room-preview/render-providers/gemini-client";
import {
  isRetryableError,
  sleep,
} from "@/lib/room-preview/render-providers/gemini-retry-utils";

const log = getLogger("gemini-provider");


// ─── Resolved config snapshot (safe to log — no secrets) ─────────────────────
//
// Captured once at module load so every cold start emits a single structured
// log entry that shows exactly what the Lambda resolved from its env vars.
// Read raw values again here (outside the IIFEs) so we can compare them to
// the resolved constants and detect whitespace/case issues.

const RESOLVED_CONFIG = {
  raw_ROOM_PREVIEW_RENDER_QUALITY:                            process.env.ROOM_PREVIEW_RENDER_QUALITY ?? null,
  raw_ROOM_PREVIEW_RENDER_LONG_EDGE:                          process.env.ROOM_PREVIEW_RENDER_LONG_EDGE ?? null,
  raw_GEMINI_CALL_TIMEOUT_MS:                                 process.env.GEMINI_CALL_TIMEOUT_MS ?? null,
  raw_ROOM_PREVIEW_GEMINI_FIRST_ATTEMPT_TIMEOUT_MS:           process.env.ROOM_PREVIEW_GEMINI_FIRST_ATTEMPT_TIMEOUT_MS ?? null,
  raw_ROOM_PREVIEW_GEMINI_RETRY_ATTEMPT_TIMEOUT_MS:           process.env.ROOM_PREVIEW_GEMINI_RETRY_ATTEMPT_TIMEOUT_MS ?? null,
  resolvedRenderQuality:                                      RENDER_QUALITY,
  resolvedLongEdgeOverride:                                   LONG_EDGE_OVERRIDE,
  resolvedMaxImageDimensionPx:                                MAX_IMAGE_DIMENSION_PX,
  resolvedMaxProductImageDimensionPx:                         MAX_PRODUCT_IMAGE_DIMENSION_PX,
  resolvedPromptVariant:                                      PROMPT_VARIANT,
  resolvedActivePromptVersion:                                ACTIVE_PROMPT_VERSION,
  resolvedGeminiCallTimeoutMs:                                GEMINI_CALL_TIMEOUT_MS,
  resolvedFirstAttemptTimeoutMs:                              GEMINI_FIRST_ATTEMPT_TIMEOUT_MS,
  resolvedRetryAttemptTimeoutMs:                              GEMINI_RETRY_ATTEMPT_TIMEOUT_MS,
  resolvedGeminiModels:                                       GEMINI_IMAGE_MODELS,
  nodeEnv:                                                    process.env.NODE_ENV ?? null,
  vercelEnv:                                                  process.env.VERCEL_ENV ?? null,
  vercelRegion:                                               process.env.VERCEL_REGION ?? null,
} as const;

log.info(
  { event: "render_config_resolved", ...RESOLVED_CONFIG },
  "Gemini provider config resolved at module load (cold start)",
);

// Dedicated, unmistakable startup line for the selected image model — makes it
// trivial to confirm in logs which model a cold start resolved and whether it
// came from an env override or the built-in default. The model MUST be an image
// generation/editing model (see DEFAULT_GEMINI_IMAGE_MODEL comment) — a vision-only
// model would return text instead of an image and fail every render.
log.info(
  {
    event: "gemini_image_model_selected",
    selectedModel: GEMINI_IMAGE_MODELS[0],
    allModels: GEMINI_IMAGE_MODELS,
    source: GEMINI_IMAGE_MODEL_SOURCE,
    defaultModel: DEFAULT_GEMINI_IMAGE_MODEL,
    overrideEnv: "ROOM_PREVIEW_GEMINI_IMAGE_MODEL",
    raw_ROOM_PREVIEW_GEMINI_IMAGE_MODEL: process.env.ROOM_PREVIEW_GEMINI_IMAGE_MODEL ?? null,
    raw_GEMINI_IMAGE_MODELS: process.env.GEMINI_IMAGE_MODELS ?? null,
  },
  `Gemini image model selected: ${GEMINI_IMAGE_MODELS[0]} (source: ${GEMINI_IMAGE_MODEL_SOURCE})`,
);

// Safety check: if the env var says "fast" but the resolved prompt is not fast-v1,
// something is wrong (whitespace, stale cache, env mismatch).
if (
  process.env.ROOM_PREVIEW_RENDER_QUALITY === "fast" &&
  ACTIVE_PROMPT_VERSION !== PROMPT_VERSION_FAST
) {
  log.warn(
    {
      event: "render_config_mismatch",
      ...RESOLVED_CONFIG,
      expectedPromptVersion: PROMPT_VERSION_FAST,
    },
    "render_config_mismatch: ROOM_PREVIEW_RENDER_QUALITY=fast but ACTIVE_PROMPT_VERSION is not fast-v1",
  );
}

// ─── Storage key builder ──────────────────────────────────────────────────────

const RENDER_OUTPUT_KEY_PREFIX = "uploads/room-preview/renders";

function buildRenderStorageKey(options: { jobId: string; sessionId: string }) {
  const fileName = `${options.sessionId}-${options.jobId}.png`;
  return `${RENDER_OUTPUT_KEY_PREFIX}/${fileName}`;
}

function buildDebugArtifactKey(sessionId: string, jobId: string, filename: string): string {
  return `debug/render-jobs/${sessionId}/${jobId}/${filename}`;
}

async function saveDebugArtifacts(params: {
  sessionId: string;
  jobId: string;
  geminiInputBuffer: Buffer;
  rawOutputBuffer: Buffer;
  mimeType: string;
  prompt: string;
  snapshotMeta: Record<string, unknown>;
}): Promise<Record<string, string>> {
  const { sessionId, jobId, mimeType } = params;
  const ext = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
  const urls: Record<string, string> = {};

  const tasks: Array<{ key: string; filename: string; data: Buffer; ct: string }> = [
    { key: "02-gemini-input",       filename: `02-gemini-input.${ext}`,    data: params.geminiInputBuffer, ct: mimeType },
    { key: "03-gemini-raw-output",  filename: "03-gemini-raw-output.png",  data: params.rawOutputBuffer,   ct: "image/png" },
    { key: "04-final-saved-output", filename: "04-final-saved-output.png", data: params.rawOutputBuffer,   ct: "image/png" },
    { key: "prompt",                filename: "prompt.txt",                data: Buffer.from(params.prompt, "utf-8"),                               ct: "text/plain" },
    { key: "metadata",              filename: "metadata.json",             data: Buffer.from(JSON.stringify(params.snapshotMeta, null, 2), "utf-8"), ct: "application/json" },
  ];

  await Promise.allSettled(
    tasks.map(async ({ key, filename, data, ct }) => {
      const result = await storageUpload(buildDebugArtifactKey(sessionId, jobId, filename), data, ct);
      urls[key] = result.publicUrl;
    }),
  );

  return urls;
}

type ProductReference = {
  image: PreparedImage;
  product: SelectedProduct;
  surface: TargetSurface;
};

function productCodesForReferences(references: readonly ProductReference[]) {
  return references.map((ref) => ref.product.id).filter((id): id is string => Boolean(id));
}

function categoriesForReferences(references: readonly ProductReference[]) {
  return references.map((ref) => ref.product.category ?? (ref.surface === "floor" ? "PARQUET" : "WALLPAPER"));
}

function surfacesForReferences(references: readonly ProductReference[]) {
  return references.map((ref) => ref.surface);
}




// ─── Provider ─────────────────────────────────────────────────────────────────
//
// IMPORTANT — generation mode, not editing mode:
// This uses Gemini's multimodal generateContent API with responseModalities:["IMAGE"].
// The room and product images are sent as reference content, but Gemini generates a
// NEW image rather than editing the input pixel-by-pixel (no inpainting/masking).
// Consequences:
//   - Output dimensions are not guaranteed to match input → the 5% aspect-ratio guard
//     is the only defence against severely wrong-sized output.
//   - Without a floorPolygon the model guesses the floor region, which can cause the
//     scene composition (perspective, doors, walls) to shift.
//   - For true in-place editing, consider switching to an inpainting API such as
//     Imagen 3 edit mode, which accepts a mask and preserves the rest of the image.

export const geminiRoomPreviewRenderProvider = {
  name: "gemini-nano-banana-renderer",

  async render(
    request: RoomPreviewRenderProviderRequest,
  ): Promise<RoomPreviewRenderProviderResult> {
    const {
      product,
      renderMode = "single",
      room,
      selectedProductsBySurface,
      sessionId,
    } = request.renderJobInput;
    const isCompositeRender = renderMode === "composite";
    const floorProduct = selectedProductsBySurface?.floor ?? null;
    const wallpaperProduct = selectedProductsBySurface?.walls ?? null;

    if (!room.imageUrl)    throw new Error("A room image is required for Gemini rendering.");
    if (!product.imageUrl) throw new Error("A product image is required for Gemini rendering.");
    if (isCompositeRender && (!floorProduct?.imageUrl || !wallpaperProduct?.imageUrl)) {
      throw new Error("Floor and wallpaper product images are required for composite Gemini rendering.");
    }

    const ai = getGeminiClient();
    const tProviderStart = Date.now();

    // Load, EXIF-rotate, resize (if needed), and re-encode both images as JPEG
    // in parallel. Dimensions are returned directly — no second decode needed.
    const loadedImages = await Promise.all([
      loadAndPrepareImage(room.imageUrl, { imageRole: "room", sessionId }),
      ...(isCompositeRender
        ? [
            loadAndPrepareImage(floorProduct!.imageUrl!, { imageRole: "product", sessionId }),
            loadAndPrepareImage(wallpaperProduct!.imageUrl!, { imageRole: "product", sessionId }),
          ]
        : [
            loadAndPrepareImage(product.imageUrl, { imageRole: "product", sessionId }),
          ]),
    ]);
    const roomImage = loadedImages[0];
    const productImage = loadedImages[1];
    const wallpaperImage = isCompositeRender ? loadedImages[2] : null;
    let productReferences: ProductReference[] = isCompositeRender
      ? [
          { surface: "floor", product: floorProduct!, image: productImage },
          { surface: "walls", product: wallpaperProduct!, image: wallpaperImage! },
        ]
      : [{ surface: product.targetSurface ?? "floor", product, image: productImage }];
    const tImagesLoaded = Date.now();
    log.info(
      {
        event: "render_timing",
        sessionId,
        renderJobId: request.jobId,
        stage: "image_load_and_preprocess",
        durationMs: tImagesLoaded - tProviderStart,
        roomFinalBytes: roomImage.finalBytes,
        productFinalBytes: productImage.finalBytes,
        ...(wallpaperImage ? { wallpaperFinalBytes: wallpaperImage.finalBytes } : {}),
        roomDimensions: `${roomImage.width}x${roomImage.height}`,
        productDimensions: `${productImage.width}x${productImage.height}`,
        ...(wallpaperImage ? { wallpaperDimensions: `${wallpaperImage.width}x${wallpaperImage.height}` } : {}),
      },
      "render_timing",
    );

    const inputDimensions = { width: roomImage.width, height: roomImage.height };

    // Resolve the render strategy from PRODUCT DATA (category), never from the
    // image. PARQUET → floor prompt (+ floorQuad); WALLPAPER → wall prompt
    // (prompt-only, no floorQuad); CARPET_TILE → carpet-tiles floor prompt
    // (+ floorQuad). Old sessions without a category default to PARQUET / floor
    // via the normalizer. In composite mode the FLOOR product's category picks
    // the composite prompt (parquet+wallpaper vs carpet-tiles+wallpaper) — the
    // two floor materials use different floor-application language.
    const { category, targetSurface } = normalizeSelectedProductClassification(product);
    const strategy = isCompositeRender
      ? resolveCompositeRenderStrategy(normalizeSelectedProductClassification(floorProduct!).category)
      : resolveRenderStrategy(category);
    const usesFloorQuad = strategy.geometryMode === "floorQuad";
    const productCodes = productCodesForReferences(productReferences);
    const categories = categoriesForReferences(productReferences);
    const targetSurfaces = surfacesForReferences(productReferences);
    const effectiveReferenceOrder = isCompositeRender ? COMPOSITE_REFERENCE_ORDER : undefined;

    const prompt = strategy.buildPrompt({
      productName: product.name ?? null,
      productNamesBySurface: isCompositeRender
        ? {
            floor: floorProduct?.name ?? null,
            walls: wallpaperProduct?.name ?? null,
          }
        : undefined,
      floorPolygon: usesFloorQuad ? (room.floorQuad ?? null) : null,
      dimensions: inputDimensions,
      variant: PROMPT_VARIANT,
    });

    // Diagnostics: record which strategy + prompt actually ran so we can later
    // tell parquet vs wallpaper renders apart (Phase 5).
    log.info(
      {
        event: "render_strategy_resolved",
        sessionId,
        renderJobId: request.jobId,
        productCode: product.id,
        category,
        targetSurface,
        renderStrategy: strategy.id,
        renderMode,
        promptVersion: strategy.promptVersion,
        geometryMode: strategy.geometryMode,
        selectedProductCount: productReferences.length,
        productCodes,
        categories,
        targetSurfaces,
        ...(effectiveReferenceOrder ? { referenceOrder: effectiveReferenceOrder } : {}),
      },
      "render_strategy_resolved",
    );
    trackSessionEvent({
      sessionId,
      source: "renderer",
      eventType: "render_strategy_resolved",
      level: "info",
      metadata: {
        productCode: product.id,
        category,
        targetSurface,
        renderStrategy: strategy.id,
        renderMode,
        promptVersion: strategy.promptVersion,
        geometryMode: strategy.geometryMode,
        renderJobId: request.jobId,
        selectedProductCount: productReferences.length,
        productCodes,
        categories,
        targetSurfaces,
        ...(effectiveReferenceOrder ? { referenceOrder: effectiveReferenceOrder } : {}),
      },
    }).catch((evtErr) => {
      log.warn({ evtErr, sessionId }, "render_strategy_resolved event failed (non-fatal)");
    });

    // Warn when a FLOOR-targeting render runs without a floor polygon — the model
    // will estimate the floor region from the image content alone, which increases
    // the risk of wrong-aspect output and scene composition drift. Wallpaper
    // (prompt-only) intentionally has no polygon and is excluded from this warning.
    if (usesFloorQuad && !room.floorQuad) {
      log.warn(
        { event: "floor_polygon_missing_prompt_only_mode", sessionId },
        "floor_polygon_missing_prompt_only_mode: no floorPolygon — Gemini will estimate the floor region from the image",
      );
      trackSessionEvent({
        sessionId,
        source: "renderer",
        eventType: "floor_polygon_missing_prompt_only_mode",
        level: "warning",
        message: "Rendering in prompt-only mode — no floorPolygon available. Gemini will estimate the floor region.",
      }).catch((evtErr) => {
        log.warn({ evtErr, sessionId }, "floor_polygon_missing_prompt_only_mode event failed (non-fatal)");
      });
    }

    // ── Per-render config reads ───────────────────────────────────────────────
    // Re-read ALL env vars that drive render behavior at request time (not just at
    // cold-start module load). This prevents stale values from:
    //   • Next.js webpack bundler inlining process.env.* at build time
    //   • Env vars set in Vercel after the last deployment (before a new cold start)
    //   • Warm-Lambda scenarios where module constants are frozen from a prior eval
    const perRenderRawQuality  = process.env.ROOM_PREVIEW_RENDER_QUALITY ?? null;
    const perRenderRawLongEdge = process.env.ROOM_PREVIEW_RENDER_LONG_EDGE ?? null;

    // Record which render branch is active in the diagnostics timeline.
    trackSessionEvent({
      sessionId,
      source: "renderer",
      eventType: "render_branch_resolved",
      level: "info",
      metadata: {
        branch: "serial",
        raw_ROOM_PREVIEW_GEMINI_FIRST_ATTEMPT_TIMEOUT_MS: process.env.ROOM_PREVIEW_GEMINI_FIRST_ATTEMPT_TIMEOUT_MS ?? null,
        renderJobId:  request.jobId,
        vercelEnv:    process.env.VERCEL_ENV ?? null,
        vercelRegion: process.env.VERCEL_REGION ?? null,
      },
    }).catch(() => {});

    log.info(
      {
        event:                 "render_branch_resolved",
        sessionId,
        renderJobId:           request.jobId,
        branch:                "serial",
        firstAttemptTimeoutMs: GEMINI_FIRST_ATTEMPT_TIMEOUT_MS,
      },
      "render_branch_resolved",
    );

    if (perRenderRawQuality === "fast" && ACTIVE_PROMPT_VERSION !== PROMPT_VERSION_FAST) {
      log.warn(
        {
          event: "render_config_mismatch",
          sessionId,
          perRenderRawQuality,
          resolvedRenderQuality: RENDER_QUALITY,
          resolvedPromptVariant: PROMPT_VARIANT,
          resolvedActivePromptVersion: ACTIVE_PROMPT_VERSION,
          expectedPromptVersion: PROMPT_VERSION_FAST,
          note: "env var says fast but module resolved balanced — likely set without redeployment or whitespace issue",
        },
        "render_config_mismatch",
      );
      trackSessionEvent({
        sessionId,
        source: "renderer",
        eventType: "render_config_mismatch",
        level: "warning",
        message: "ROOM_PREVIEW_RENDER_QUALITY=fast but prompt version is not gemini-floor-fast-v1 — config mismatch detected",
        metadata: {
          perRenderRawQuality,
          perRenderRawLongEdge,
          resolvedRenderQuality: RENDER_QUALITY,
          resolvedPromptVariant: PROMPT_VARIANT,
          resolvedActivePromptVersion: ACTIVE_PROMPT_VERSION,
          expectedPromptVersion: PROMPT_VERSION_FAST,
        },
      }).catch((evtErr) => {
        log.warn({ evtErr, sessionId }, "render_config_mismatch event failed (non-fatal)");
      });
    }


    let lastError: unknown = null;
    let aspectRatioRetried = false;
    let timeoutRetried = false;
    let activePrompt = prompt;
    let currentPromptVariant: "normal" | "fallback" = "normal";
    // Phase 4: may be replaced with smaller-dimension versions on timeout retry.
    let currentRoomImage    = roomImage;
    let currentProductImage = productImage;
    let currentWallpaperImage = wallpaperImage;

    const attemptTimings: Array<{
      attempt: number;
      modelName: string;
      durationMs: number;
      status: string;
      retryReason?: string;
      attemptTimeoutMs: number;
      abortedByTimeout: boolean;
      promptVariant?: "normal" | "fallback";
    }> = [];
    let lastRetryReason: string | undefined;

    // Labeled so a fatal timeout can break the whole render (not just the inner
    // attempt loop) — otherwise each additional configured model would start a
    // fresh 60 s attempt and stack toward the 300 s route limit.
    modelLoop:
    for (const modelName of GEMINI_IMAGE_MODELS) {
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        // First attempt uses a tight timeout so a stuck Gemini call fails fast.
        // All subsequent attempts use the longer retry budget.
        const attemptTimeoutMs = attempt === 1
          ? GEMINI_FIRST_ATTEMPT_TIMEOUT_MS
          : GEMINI_RETRY_ATTEMPT_TIMEOUT_MS;

        // imageParts is rebuilt each attempt so timeout retry uses updated images.
        const imageParts = [
          { inlineData: { mimeType: currentRoomImage.mimeType,    data: currentRoomImage.base64    } },
          { inlineData: { mimeType: currentProductImage.mimeType, data: currentProductImage.base64 } },
          ...(isCompositeRender && currentWallpaperImage
            ? [{ inlineData: { mimeType: currentWallpaperImage.mimeType, data: currentWallpaperImage.base64 } }]
            : []),
        ];

        const contentRequest: Record<string, unknown> = {
          contents: [
            {
              role: "user" as const,
              parts: [...imageParts, { text: activePrompt }],
            },
          ],
          config: {
            responseModalities: ["TEXT", "IMAGE"] as ("TEXT" | "IMAGE")[],
          },
        };

        let tGeminiStart = 0;
        try {
          log.info(
            {
              event: "gemini_call_starting",
              sessionId,
              modelName,
              attempt,
              qualityMode: RENDER_QUALITY,
              promptVersion: strategy.promptVersion,
              productCode: product.id,
              productCodes,
              category,
              categories,
              targetSurface,
              targetSurfaces,
              selectedProductCount: productReferences.length,
              renderMode,
              ...(effectiveReferenceOrder ? { referenceOrder: effectiveReferenceOrder } : {}),
              renderStrategy: strategy.id,
              geometryMode: strategy.geometryMode,
              promptLength: activePrompt.length,
              inputPixelCount: currentRoomImage.width * currentRoomImage.height,
              payloadPartCount: imageParts.length + 1,
              timeoutMs: attemptTimeoutMs,
              roomBytes: currentRoomImage.finalBytes,
              productBytes: currentProductImage.finalBytes,
              ...(currentWallpaperImage ? { wallpaperBytes: currentWallpaperImage.finalBytes } : {}),
              roomDimensions: `${currentRoomImage.width}x${currentRoomImage.height}`,
              productDimensions: `${currentProductImage.width}x${currentProductImage.height}`,
              ...(currentWallpaperImage ? { wallpaperDimensions: `${currentWallpaperImage.width}x${currentWallpaperImage.height}` } : {}),
              // Raw env values read per-request — compare to resolved constants to detect
              // warm-Lambda caching or env vars set without redeployment.
              raw_ROOM_PREVIEW_RENDER_QUALITY:   perRenderRawQuality,
              raw_ROOM_PREVIEW_RENDER_LONG_EDGE: perRenderRawLongEdge,
              resolvedRenderQuality:             RENDER_QUALITY,
              resolvedLongEdgeOverride:          LONG_EDGE_OVERRIDE,
              resolvedMaxImageDimensionPx:       MAX_IMAGE_DIMENSION_PX,
              resolvedPromptVariant:             PROMPT_VARIANT,
              nodeEnv:                           process.env.NODE_ENV ?? null,
              vercelEnv:                         process.env.VERCEL_ENV ?? null,
              vercelRegion:                      process.env.VERCEL_REGION ?? null,
            },
            "Starting Gemini render attempt",
          );

          tGeminiStart = Date.now();
          log.info(
            { event: "gemini_attempt_started", sessionId, modelName, attempt, timeoutMs: attemptTimeoutMs },
            "gemini_attempt_started",
          );
          const response = await generateContentWithTimeout(ai, modelName, contentRequest, attemptTimeoutMs);
          const tGeminiDone = Date.now();
          const geminiMs = tGeminiDone - tGeminiStart;
          log.info(
            { event: "gemini_attempt_completed", sessionId, modelName, attempt, timeoutMs: attemptTimeoutMs, actualDurationMs: geminiMs },
            "gemini_attempt_completed",
          );
          log.info(
            {
              event: "render_timing",
              sessionId,
              renderJobId: request.jobId,
              stage: `gemini_attempt_${attempt}`,
              durationMs: geminiMs,
              modelName,
              attempt,
            },
            "render_timing",
          );

          const parts = response.candidates?.[0]?.content?.parts ?? [];
          const imagePart = parts.find(
            (p: { inlineData?: { mimeType?: string; data?: string } }) =>
              p.inlineData?.mimeType?.startsWith("image/"),
          );

          if (!imagePart?.inlineData?.data) {
            const textParts = parts
              .filter((p: { text?: string }) => p.text)
              .map((p: { text?: string }) => p.text)
              .join("\n");
            throw new Error(
              `Gemini did not return an image.${textParts ? ` Model response: ${textParts}` : ""}`,
            );
          }

          const textResponse = parts
            .filter((p: { text?: string }) => p.text)
            .map((p: { text?: string }) => p.text)
            .join("\n");

          if (textResponse.includes(SENTINEL_FLOOR_NOT_VISIBLE)) {
            throw new Error(
              `Gemini reported the floor is not sufficiently visible — render rejected (model: ${modelName}, attempt: ${attempt}).`,
            );
          }

          if (textResponse.includes(SENTINEL_MATERIAL_UNCLEAR)) {
            throw new Error(
              `Gemini reported the flooring material could not be inferred from the product image — render rejected (model: ${modelName}, attempt: ${attempt}).`,
            );
          }

          const { width, height, buffer: imageBuffer } = await validateAndNormalizeOutputImage(
            imagePart.inlineData.data,
            currentRoomImage.base64,
            inputDimensions,
            { sessionId, modelName },
          );
          const tValidationDone = Date.now();
          log.info(
            {
              event: "render_timing",
              sessionId,
              renderJobId: request.jobId,
              stage: "output_validation",
              durationMs: tValidationDone - tGeminiDone,
            },
            "render_timing",
          );

          const storageKey = buildRenderStorageKey({ jobId: request.jobId, sessionId });
          const tUploadStart = Date.now();
          const geminiOutputMimeType = imagePart.inlineData.mimeType ?? "";
          const uploadBuffer = geminiOutputMimeType === "image/png"
            ? imageBuffer
            : await (await import("sharp")).default(imageBuffer).png().toBuffer();
          const uploadResult = await storageUpload(storageKey, uploadBuffer, "image/png");
          const tUploadDone = Date.now();
          log.info(
            {
              event: "render_timing",
              sessionId,
              renderJobId: request.jobId,
              stage: "final_upload",
              durationMs: tUploadDone - tUploadStart,
              outputBytes: uploadBuffer.length,
            },
            "render_timing",
          );
          attemptTimings.push({ attempt, modelName, durationMs: geminiMs, status: "succeeded", attemptTimeoutMs, abortedByTimeout: false, promptVariant: currentPromptVariant });

          if (timeoutRetried) {
            log.info(
              {
                event: "gemini_retry_succeeded",
                sessionId,
                modelName,
                attempt,
                geminiMs,
                roomDimensions: `${currentRoomImage.width}x${currentRoomImage.height}`,
              },
              "Gemini render succeeded on timeout retry",
            );
          }

          log.info(
            {
              modelName,
              attempt,
              sessionId,
              qualityMode: RENDER_QUALITY,
              promptVersion: strategy.promptVersion,
              productCode: product.id,
              productCodes,
              category,
              categories,
              targetSurface,
              targetSurfaces,
              selectedProductCount: productReferences.length,
              renderMode,
              ...(effectiveReferenceOrder ? { referenceOrder: effectiveReferenceOrder } : {}),
              renderStrategy: strategy.id,
              geometryMode: strategy.geometryMode,
              outputDimensions: `${width}x${height}`,
              outputBytes: uploadBuffer.length,
              geminiMs,
            },
            "Render succeeded",
          );

          // ── Diagnostics snapshot ───────────────────────────────────────────
          const resizedApplied =
            currentRoomImage.width !== currentRoomImage.originalWidth ||
            currentRoomImage.height !== currentRoomImage.originalHeight;

          const snapshotMeta: Record<string, unknown> = {
            renderJobId:           request.jobId,
            originalDimensions:    { width: currentRoomImage.originalWidth, height: currentRoomImage.originalHeight },
            geminiInputDimensions: { width: currentRoomImage.width,         height: currentRoomImage.height },
            rawOutputDimensions:   { width, height },
            finalOutputDimensions: { width, height },
            resizedApplied,
            cropApplied:           false,
            paddingApplied:        false,
            normalizedApplied:     false,
            fillApplied:           false,
            containApplied:        false,
            coverApplied:          false,
            exifOrientationApplied: true,
            savedRaw:              true,
            qualityMode:           RENDER_QUALITY,
            productCode:           product.id,
            productCodes,
            category,
            categories,
            targetSurface,
            targetSurfaces,
            selectedProductCount:   productReferences.length,
            renderMode,
            ...(effectiveReferenceOrder ? { referenceOrder: effectiveReferenceOrder } : {}),
            productType:           product.productType ?? null,
            renderStrategy:        strategy.id,
            geometryMode:          strategy.geometryMode,
            promptVersion:         strategy.promptVersion,
            promptLength:          prompt.length,
            inputPixelCount:       inputDimensions.width * inputDimensions.height,
            modelName,
            productName:           product.name ?? null,
            floorPolygon:          usesFloorQuad ? (room.floorQuad ?? null) : null,
            promptText:            prompt,
            outputImageUrl:        uploadResult.publicUrl,
            artifactUrls:          {} as Record<string, string>,
            timings: {
              imageLoadMs:             tImagesLoaded - tProviderStart,
              geminiMs,
              uploadMs:                tUploadDone - tUploadStart,
              totalProviderMs:         tUploadDone - tProviderStart,
              attempt,
              modelName,
              timeoutMs:               GEMINI_CALL_TIMEOUT_MS,
              firstAttemptTimeoutMs:   GEMINI_FIRST_ATTEMPT_TIMEOUT_MS,
              retryAttemptTimeoutMs:   GEMINI_RETRY_ATTEMPT_TIMEOUT_MS,
            },
            // Raw + resolved config — visible in admin diagnostics snapshot.
            envConfig: {
              raw_ROOM_PREVIEW_RENDER_QUALITY:                    perRenderRawQuality,
              raw_ROOM_PREVIEW_RENDER_LONG_EDGE:                  perRenderRawLongEdge,
              raw_ROOM_PREVIEW_GEMINI_FIRST_ATTEMPT_TIMEOUT_MS:   process.env.ROOM_PREVIEW_GEMINI_FIRST_ATTEMPT_TIMEOUT_MS ?? null,
              raw_ROOM_PREVIEW_GEMINI_RETRY_ATTEMPT_TIMEOUT_MS:   process.env.ROOM_PREVIEW_GEMINI_RETRY_ATTEMPT_TIMEOUT_MS ?? null,
              resolvedRenderQuality:                              RENDER_QUALITY,
              resolvedLongEdgeOverride:                           LONG_EDGE_OVERRIDE,
              resolvedMaxImageDimensionPx:                        MAX_IMAGE_DIMENSION_PX,
              resolvedMaxProductImageDimensionPx:                 MAX_PRODUCT_IMAGE_DIMENSION_PX,
              resolvedPromptVariant:                              PROMPT_VARIANT,
              resolvedActivePromptVersion:                        ACTIVE_PROMPT_VERSION,
              resolvedStrategyPromptVersion:                      strategy.promptVersion,
              resolvedGeminiCallTimeoutMs:                        GEMINI_CALL_TIMEOUT_MS,
              resolvedFirstAttemptTimeoutMs:                      GEMINI_FIRST_ATTEMPT_TIMEOUT_MS,
              resolvedRetryAttemptTimeoutMs:                      GEMINI_RETRY_ATTEMPT_TIMEOUT_MS,
              nodeEnv:                                            process.env.NODE_ENV ?? null,
              vercelEnv:                                          process.env.VERCEL_ENV ?? null,
              vercelRegion:                                       process.env.VERCEL_REGION ?? null,
            },
          };

          if (DEBUG_ARTIFACTS_ENABLED) {
            const geminiInputBuffer = Buffer.from(currentRoomImage.base64, "base64");
            const tDebugFired = Date.now();
            log.info(
              {
                event: "render_timing",
                sessionId,
                renderJobId: request.jobId,
                stage: "debug_artifact_upload",
                async: true,
                note: "fire-and-forget — not on critical path",
              },
              "render_timing",
            );
            saveDebugArtifacts({
              sessionId,
              jobId: request.jobId,
              geminiInputBuffer,
              rawOutputBuffer: imageBuffer,
              mimeType: currentRoomImage.mimeType,
              prompt,
              snapshotMeta: { ...snapshotMeta, artifactUrls: undefined },
            }).then(() => {
              log.info(
                {
                  event: "render_timing",
                  sessionId,
                  renderJobId: request.jobId,
                  stage: "debug_artifact_upload_done",
                  durationMs: Date.now() - tDebugFired,
                },
                "render_timing",
              );
            }).catch((debugErr) => {
              log.warn(
                { debugErr, sessionId, jobId: request.jobId },
                "Debug artifact saving failed (non-fatal)",
              );
            });
          }

          trackSessionEvent({
            sessionId,
            source: "renderer",
            eventType: "render_timing_summary",
            level: "info",
            metadata: {
              renderJobId: request.jobId,
              mode: timeoutRetried ? "serial_adaptive" : "serial",
              totalProviderMs: tUploadDone - tProviderStart,
              imageLoadMs: tImagesLoaded - tProviderStart,
              geminiMs,
              uploadMs: tUploadDone - tUploadStart,
              validationMs: tValidationDone - tGeminiDone,
              attemptCount: attemptTimings.length,
              retried: attemptTimings.length > 1,
              retryReason: lastRetryReason,
              winnerPromptVariant: currentPromptVariant,
              debugArtifactsEnabled: DEBUG_ARTIFACTS_ENABLED,
              qualityMode: RENDER_QUALITY,
              productCode: product.id,
              productCodes,
              category,
              categories,
              targetSurface,
              targetSurfaces,
              selectedProductCount: productReferences.length,
              renderMode,
              ...(effectiveReferenceOrder ? { referenceOrder: effectiveReferenceOrder } : {}),
              productType: product.productType ?? null,
              renderStrategy: strategy.id,
              geometryMode: strategy.geometryMode,
              promptVersion: strategy.promptVersion,
              promptLength: prompt.length,
              inputDimensions,
              inputPixelCount: inputDimensions.width * inputDimensions.height,
              outputDimensions: { width, height },
              modelName,
              attemptTimings,
              firstAttemptTimeoutMs:   GEMINI_FIRST_ATTEMPT_TIMEOUT_MS,
              retryAttemptTimeoutMs:   GEMINI_RETRY_ATTEMPT_TIMEOUT_MS,
              // Raw + resolved config — key for diagnosing env var propagation issues.
              envConfig: {
                raw_ROOM_PREVIEW_RENDER_QUALITY:                    perRenderRawQuality,
                raw_ROOM_PREVIEW_RENDER_LONG_EDGE:                  perRenderRawLongEdge,
                raw_ROOM_PREVIEW_GEMINI_FIRST_ATTEMPT_TIMEOUT_MS:   process.env.ROOM_PREVIEW_GEMINI_FIRST_ATTEMPT_TIMEOUT_MS ?? null,
                raw_ROOM_PREVIEW_GEMINI_RETRY_ATTEMPT_TIMEOUT_MS:   process.env.ROOM_PREVIEW_GEMINI_RETRY_ATTEMPT_TIMEOUT_MS ?? null,
                resolvedRenderQuality:                              RENDER_QUALITY,
                resolvedLongEdgeOverride:                           LONG_EDGE_OVERRIDE,
                resolvedMaxImageDimensionPx:                        MAX_IMAGE_DIMENSION_PX,
                resolvedMaxProductImageDimensionPx:                 MAX_PRODUCT_IMAGE_DIMENSION_PX,
                resolvedPromptVariant:                              PROMPT_VARIANT,
                resolvedActivePromptVersion:                        ACTIVE_PROMPT_VERSION,
                resolvedStrategyPromptVersion:                      strategy.promptVersion,
                resolvedGeminiCallTimeoutMs:                        GEMINI_CALL_TIMEOUT_MS,
                resolvedFirstAttemptTimeoutMs:                      GEMINI_FIRST_ATTEMPT_TIMEOUT_MS,
                resolvedRetryAttemptTimeoutMs:                      GEMINI_RETRY_ATTEMPT_TIMEOUT_MS,
                nodeEnv:                                            process.env.NODE_ENV ?? null,
                vercelEnv:                                          process.env.VERCEL_ENV ?? null,
                vercelRegion:                                       process.env.VERCEL_REGION ?? null,
              },
            },
          }).catch((evtErr) => {
            log.warn({ evtErr, sessionId }, "render_timing_summary event failed (non-fatal)");
          });

          trackSessionEvent({
            sessionId,
            source: "renderer",
            eventType: "render_diagnostics_snapshot",
            level: "info",
            metadata: snapshotMeta,
          }).catch((evtErr) => {
            log.warn({ evtErr, sessionId }, "render_diagnostics_snapshot event failed (non-fatal)");
          });

          return {
            generatedAt: new Date().toISOString(),
            imageUrl: uploadResult.publicUrl,
            kind: "composited_preview",
            modelName,
          };
        } catch (err) {
          lastError = err;

          if (err instanceof AspectRatioMismatchError && !aspectRatioRetried) {
            aspectRatioRetried = true;
            lastRetryReason = "aspect_ratio_mismatch";
            attemptTimings.push({
              attempt,
              modelName,
              durationMs: tGeminiStart > 0 ? Date.now() - tGeminiStart : 0,
              status: "aspect_ratio_mismatch",
              retryReason: "aspect_ratio_mismatch",
              attemptTimeoutMs,
              abortedByTimeout: false,
            });
            activePrompt =
              `${prompt}\n\nCRITICAL CORRECTION: Your previous output had the wrong aspect ratio ` +
              `(${err.outputWidth}×${err.outputHeight} instead of ${err.inputWidth}×${err.inputHeight}). ` +
              `The output image MUST be exactly ${inputDimensions.width} pixels wide and ${inputDimensions.height} pixels tall. ` +
              `Match the input image dimensions exactly — do NOT change the aspect ratio.`;
            log.warn(
              {
                event: "output_aspect_ratio_mismatch_rejected",
                sessionId,
                modelName,
                attempt,
                driftPercent: err.driftPercent,
                inputDimensions,
                outputDimensions: { width: err.outputWidth, height: err.outputHeight },
                action: "retrying_with_strict_prompt",
              },
              "Aspect ratio mismatch — retrying once with stricter dimension constraint",
            );
            continue;
          }

          if (err instanceof AspectRatioMismatchError) {
            attemptTimings.push({
              attempt,
              modelName,
              durationMs: tGeminiStart > 0 ? Date.now() - tGeminiStart : 0,
              status: "aspect_ratio_mismatch_fatal",
              attemptTimeoutMs,
              abortedByTimeout: false,
            });
            log.error(
              {
                event: "output_aspect_ratio_mismatch_rejected",
                sessionId,
                modelName,
                attempt,
                driftPercent: err.driftPercent,
                action: "giving_up",
              },
              "Aspect ratio mismatch persists after strict-prompt retry — failing render",
            );
            break;
          }

          // Attempt 1 timed out — retry once with a shorter fallback prompt and
          // reduced image dimensions. The fallback prompt is intentionally simpler
          // (no floor-polygon coordinates, no quality constraints) so Gemini can
          // return within the longer GEMINI_RETRY_ATTEMPT_TIMEOUT_MS budget.
          if (err instanceof GeminiTimeoutError && !timeoutRetried) {
            timeoutRetried = true;
            lastRetryReason = "gemini_timeout";
            attemptTimings.push({
              attempt,
              modelName,
              durationMs: attemptTimeoutMs,
              status: "timeout",
              retryReason: "gemini_timeout",
              attemptTimeoutMs,
              abortedByTimeout: true,
              promptVariant: "normal",
            });

            log.warn(
              {
                event: "gemini_attempt_timeout",
                sessionId,
                modelName,
                attempt,
                timeoutMs: attemptTimeoutMs,
                action: "retrying_with_fallback_prompt",
                nextTimeoutMs: GEMINI_RETRY_ATTEMPT_TIMEOUT_MS,
              },
              "gemini_attempt_timeout: starting fallback retry",
            );

            // Emit session event so the diagnostics timeline shows the timeout.
            trackSessionEvent({
              sessionId,
              source: "renderer",
              eventType: "gemini_attempt_timeout",
              level: "warning",
              metadata: {
                renderJobId: request.jobId,
                attempt,
                modelName,
                timeoutMs: attemptTimeoutMs,
                promptVariant: "normal",
                action: "retry_with_fallback_prompt",
              },
            }).catch(() => {});

            // Reload both images at smaller dimensions to reduce payload size.
            const reloadedImages = await Promise.all([
              loadAndPrepareImage(room.imageUrl, {
                imageRole: "room",
                sessionId,
                maxDimensionOverride: TIMEOUT_RETRY_ROOM_MAX_PX,
              }),
              ...(isCompositeRender
                ? [
                    loadAndPrepareImage(floorProduct!.imageUrl!, {
                      imageRole: "product",
                      sessionId,
                      maxDimensionOverride: TIMEOUT_RETRY_PRODUCT_MAX_PX,
                    }),
                    loadAndPrepareImage(wallpaperProduct!.imageUrl!, {
                      imageRole: "product",
                      sessionId,
                      maxDimensionOverride: TIMEOUT_RETRY_PRODUCT_MAX_PX,
                    }),
                  ]
                : [
                    loadAndPrepareImage(product.imageUrl, {
                      imageRole: "product",
                      sessionId,
                      maxDimensionOverride: TIMEOUT_RETRY_PRODUCT_MAX_PX,
                    }),
                  ]),
            ]);
            currentRoomImage = reloadedImages[0];
            currentProductImage = reloadedImages[1];
            currentWallpaperImage = isCompositeRender ? reloadedImages[2] : null;
            productReferences = isCompositeRender
              ? [
                  { surface: "floor", product: floorProduct!, image: currentProductImage },
                  { surface: "walls", product: wallpaperProduct!, image: currentWallpaperImage! },
                ]
              : [{ surface: product.targetSurface ?? "floor", product, image: currentProductImage }];

            // Switch to the short fallback prompt — omits polygon coords and
            // quality constraints that may have caused the model to over-think.
            currentPromptVariant = "fallback";
            activePrompt = strategy.buildFallbackPrompt(product.name ?? null, {
              productName: product.name ?? null,
              productNamesBySurface: isCompositeRender
                ? {
                    floor: floorProduct?.name ?? null,
                    walls: wallpaperProduct?.name ?? null,
                  }
                : undefined,
            });

            log.info(
              {
                event: "gemini_retry_started",
                sessionId,
                modelName,
                promptVariant: "fallback",
                fallbackPromptLength: activePrompt.length,
                roomMaxPx: TIMEOUT_RETRY_ROOM_MAX_PX,
                productMaxPx: TIMEOUT_RETRY_PRODUCT_MAX_PX,
                timeoutMs: GEMINI_RETRY_ATTEMPT_TIMEOUT_MS,
                selectedProductCount: productReferences.length,
                productCodes,
                categories,
                targetSurfaces,
                renderMode,
                promptVersion: strategy.promptVersion,
                ...(effectiveReferenceOrder ? { referenceOrder: effectiveReferenceOrder } : {}),
              },
              "Gemini retry started with fallback prompt and reduced image dimensions",
            );
            trackSessionEvent({
              sessionId,
              source: "renderer",
              eventType: "gemini_retry_started",
              level: "info",
              metadata: {
                renderJobId: request.jobId,
                attempt: attempt + 1,
                modelName,
                retryReason: "gemini_timeout",
                promptVariant: "fallback",
                fallbackPromptLength: activePrompt.length,
                roomMaxPx: TIMEOUT_RETRY_ROOM_MAX_PX,
                productMaxPx: TIMEOUT_RETRY_PRODUCT_MAX_PX,
                timeoutMs: GEMINI_RETRY_ATTEMPT_TIMEOUT_MS,
                selectedProductCount: productReferences.length,
                productCodes,
                categories,
                targetSurfaces,
                renderMode,
                promptVersion: strategy.promptVersion,
                ...(effectiveReferenceOrder ? { referenceOrder: effectiveReferenceOrder } : {}),
              },
            }).catch(() => {});

            continue;
          }

          if (err instanceof GeminiTimeoutError) {
            attemptTimings.push({
              attempt,
              modelName,
              durationMs: attemptTimeoutMs,
              status: "timeout_fatal",
              attemptTimeoutMs,
              abortedByTimeout: true,
            });
            log.warn(
              {
                event: "gemini_attempt_timeout",
                sessionId,
                modelName,
                attempt,
                timeoutMs: attemptTimeoutMs,
                actualDurationMs: attemptTimeoutMs,
                action: "giving_up",
              },
              "gemini_attempt_timeout",
            );
            log.error(
              {
                event: "gemini_retry_failed",
                sessionId,
                modelName,
                attempt,
                timeoutMs: attemptTimeoutMs,
              },
              "Gemini timeout retry also timed out — failing render",
            );
            // Stop entirely after a fatal timeout — do not fall through to other
            // models and stack more multi-second attempts toward the route limit.
            break modelLoop;
          }

          if (isRetryableError(err) && attempt < MAX_RETRIES) {
            const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
            attemptTimings.push({
              attempt,
              modelName,
              durationMs: tGeminiStart > 0 ? Date.now() - tGeminiStart : 0,
              status: "retryable_error",
              retryReason: "api_error",
              attemptTimeoutMs,
              abortedByTimeout: false,
            });
            if (!lastRetryReason) lastRetryReason = "api_error";
            log.warn({ err, modelName, attempt, delayMs: delay }, "Retryable error — retrying");
            await sleep(delay);
            continue;
          }

          if (!isRetryableError(err)) {
            attemptTimings.push({
              attempt,
              modelName,
              durationMs: tGeminiStart > 0 ? Date.now() - tGeminiStart : 0,
              status: "non_retryable_error",
              attemptTimeoutMs,
              abortedByTimeout: false,
            });
            log.warn({ err, modelName, attempt }, "Non-retryable error — moving to next model");
            break;
          }

          attemptTimings.push({
            attempt,
            modelName,
            durationMs: tGeminiStart > 0 ? Date.now() - tGeminiStart : 0,
            status: "exhausted_retries",
            attemptTimeoutMs,
            abortedByTimeout: false,
          });
          log.warn({ modelName, maxRetries: MAX_RETRIES }, "Exhausted retries for model — trying next");
          break;
        }
      }
    }

    throw lastError ?? new Error("All Gemini image models failed.");
  },
} satisfies RoomPreviewRenderProvider;
