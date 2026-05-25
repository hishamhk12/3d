# Gemini Image Render Timeout Fix

## Problem

The Room Preview render pipeline fails with:

> "Gemini call timed out after 100s (model: gemini-3.1-flash-image-preview)"

## Root Causes

| # | Cause | Impact |
|---|---|---|
| 1 | PNG images sent to Gemini instead of JPEG | Payload 5–15× larger (2–5 MB vs ~300 KB) |
| 2 | 100 s timeout is hardcoded — no env override | Cannot tune without a code deploy |
| 3 | Timeout error is non-retryable — one failure = total render failure | Every timeout = user sees error |
| 4 | No AbortSignal on Gemini SDK call — HTTP connection stays open after timeout | Resource leak per timeout |
| 5 | EXIF rotation not applied on small images (≤ 1280 px) | Possible rotated image sent to Gemini |

---

## Phase 0 — Audit Baseline

**Files involved:**

| File | Role |
|---|---|
| `lib/room-preview/render-providers/gemini-provider.ts` | All Gemini calls, image loading, retry logic |
| `lib/room-preview/render-service.ts` | Background pipeline, error → session failure |
| `lib/room-preview/image-compress.ts` | Client-side pre-upload compression (browser only) |
| `.env.example` | Env documentation |

**Confirmed facts:**
- SDK: `@google/genai` v1.49.0 — supports `abortSignal` in `GenerateContentParameters`
- Timeout: `GEMINI_CALL_TIMEOUT_MS = 100_000` (line 34), hardcoded, no env override
- Timeout impl: `Promise.race(...)` — no AbortSignal; HTTP request outlives JS rejection
- MIME: mimeType taken from HTTP `Content-Type` header; sharp `toBuffer()` preserves input format → PNG in → PNG out
- Non-resize path: `finalBuffer = rawBuffer` skips EXIF rotation entirely
- Retry: `isRetryableError()` only handles HTTP 503/429; timeout is a plain `Error` → non-retryable → instant failure
- On failure: `markSessionAsFailed(sessionId)` called at render-service.ts:315 → session never stuck
- `failureReason`: stored as nullable string; `getFailureReason()` at render-service.ts:40 extracts `.failureReason` from any error object
- Route `maxDuration`: 300 s — plenty of headroom for 150–180 s timeout

**Current Gemini payload:**
```
contents[0].parts = [
  { inlineData: { mimeType: "<from Content-Type>", data: "<base64>" } },  // room
  { inlineData: { mimeType: "<from Content-Type>", data: "<base64>" } },  // product
  { text: "<~2400 char prompt>" }
]
config: { responseModalities: ["TEXT", "IMAGE"] }
```

Worst-case size (PNG room): **5–7 MB base64** · After fix (JPEG room): **~350 KB base64**

---

## Phase 1 — Safe Observability

Added structured logs (no behavior change):

| Event | Where | Fields |
|---|---|---|
| `render_input_image_loaded` | after rawBuffer fetch | `imageRole`, `sessionId`, `originalBytes`, `sourceMimeType` |
| `render_input_image_prepared` | after finalBuffer ready | `imageRole`, `sessionId`, `originalBytes`, `finalBytes`, `width`, `height`, `mimeType`, `resized`, `maxDimension` |
| `gemini_call_starting` | before generateContentWithTimeout | `sessionId`, `modelName`, `attempt`, `payloadPartCount`, `timeoutMs`, `roomBytes`, `productBytes`, `roomDimensions`, `productDimensions` |
| `geminiMs` added to | "Render succeeded" log | Gemini call duration in ms |
| `timeoutMs` added to | `snapshotMeta.timings` | Timeout value in effect |

**Rules enforced:**
- Never log `base64` data
- Never log full signed URLs — `url.slice(0, 120)` pattern retained
- Log byte counts only (`rawBuffer.length`, `finalBuffer.length`)

---

## Phase 2 — Force JPEG Output from Sharp

**Change in `loadAndPrepareImage`:**

**Resize path** — added `.jpeg({ quality: 85 })` before `.toBuffer()`:
```typescript
const { data, info } = await sharp(rawBuffer)
  .rotate()
  .resize(maxDimension, maxDimension, { fit: "inside", withoutEnlargement: true })
  .jpeg({ quality: 85 })
  .toBuffer({ resolveWithObject: true });
```

**No-resize path** — replaced `finalBuffer = rawBuffer` with full sharp pipeline:
```typescript
const { data: rotated, info: rotInfo } = await sharp(rawBuffer)
  .rotate()
  .jpeg({ quality: 85 })
  .toBuffer({ resolveWithObject: true });
```

Both paths now:
- Apply EXIF rotation (`.rotate()`)
- Re-encode as JPEG at quality 85
- Set `mimeType = "image/jpeg"` on the returned `PreparedImage`

**Expected result:**
- Room image: `image/jpeg` ≤ 1280 px, ~200–400 KB (down from 2–5 MB PNG)
- Product image: `image/jpeg` ≤ 768 px, ~60–120 KB
- EXIF rotation applied to all images including small ones (bug fix)

---

## Phase 3 — Configurable Timeout

**Old (hardcoded):**
```typescript
const GEMINI_CALL_TIMEOUT_MS = 100_000;
```

**New (env-configurable with clamp):**
```typescript
const GEMINI_CALL_TIMEOUT_MS = (() => {
  const raw = Number(process.env.GEMINI_CALL_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return 150_000; // default: 150 s
  return Math.max(60_000, Math.min(raw, 240_000));        // clamp: 60 s – 240 s
})();
```

**Default raised from 100 s → 150 s** to give more headroom for Gemini inference.

**Added to `.env.example`:**
```
# GEMINI_CALL_TIMEOUT_MS: optional — Gemini API call timeout in ms (default: 150000, min: 60000, max: 240000)
GEMINI_CALL_TIMEOUT_MS=
```

---

## Phase 4 — Timeout Classification and Retry

### New error class
```typescript
class GeminiTimeoutError extends Error {
  readonly failureReason = "gemini_timeout" as const;
  constructor(modelName: string, timeoutMs: number) {
    super(`Gemini call timed out after ${timeoutMs / 1000}s (model: ${modelName})`);
    this.name = "GeminiTimeoutError";
  }
}
```

`failureReason = "gemini_timeout"` is picked up by `getFailureReason()` in render-service.ts — stored on the render job automatically, no changes to render-service.ts needed.

### Retry behavior
- First timeout: reload images at reduced dimensions (room → 1024 px, product → 640 px), rebuild prompt with new dimensions, retry once
- Second timeout (same attempt): log `gemini_retry_failed`, break to next model
- No retry for: invalid image, bad MIME, sentinel responses, aspect ratio mismatch, auth errors

### Retry logs
| Event | Level | Meaning |
|---|---|---|
| `gemini_call_timeout` | warn | First timeout — retry starting |
| `gemini_retry_started` | info | Images reloaded at reduced dims |
| `gemini_retry_succeeded` | info | Retry completed successfully |
| `gemini_retry_failed` | error | Retry also timed out |

---

## Phase 5 — AbortController

**Old:**
```typescript
const timeout = new Promise<never>((_, reject) =>
  setTimeout(() => reject(timeoutError), GEMINI_CALL_TIMEOUT_MS),
);
return Promise.race([ai.models.generateContent(params), timeout]);
```

**New:**
```typescript
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), GEMINI_CALL_TIMEOUT_MS);
try {
  const params = { model: modelName, ...contentRequest, abortSignal: controller.signal } as any;
  return await ai.models.generateContent(params);
} catch (err) {
  if (controller.signal.aborted) throw new GeminiTimeoutError(modelName, GEMINI_CALL_TIMEOUT_MS);
  throw err;
} finally {
  clearTimeout(timer);
}
```

**SDK note:** AbortSignal cancels the client-side fetch connection. The Gemini service continues processing — billing is not affected (`@google/genai` v1.49.0 documented limitation). Still worth doing to free Node.js resources and the Vercel concurrency slot.

---

## Phase 6 — Session Cleanup Verification

**No code changes needed.** Confirmed:
- `render-service.ts:315`: `markSessionAsFailed(sessionId)` called in catch block on any render error
- Session transitions `"rendering"` → `"failed"` cleanly
- `recoverStuckRenderJob` (render-service.ts:384) handles the edge case where Vercel kills the function invocation before the catch block runs (8-minute recovery window)

---

## Files Changed

| File | Phases |
|---|---|
| `lib/room-preview/render-providers/gemini-provider.ts` | 1–5 |
| `.env.example` | 3 |
| `docs/gemini-timeout-fix-plan.md` | 0 (this file) |

**Not changed:** render-service.ts, render-repository.ts, types.ts, image-compress.ts, UI, QR flow, mobile flow, session state machine, database schema.

---

## Test Plan

### Simulated timeout (local)
```
GEMINI_CALL_TIMEOUT_MS=1000  # in .env.local
```
Expected logs: `gemini_call_timeout` → `gemini_retry_started` → `gemini_retry_failed` → `render_failed`
Expected DB: render job `status = "failed"`, `failureReason = "gemini_timeout"`
Expected session: transitions to `"failed"` (not stuck in `"rendering"`)

### PNG room image (local)
Upload any PNG room photo, trigger render.
Expected: `render_input_image_prepared` log shows `mimeType: "image/jpeg"`, `finalBytes` << `originalBytes`

### JPEG room image (normal mobile flow)
Expected: no behavior change, same JPEG pipeline, same render quality

### Production / Vercel
1. Set `GEMINI_CALL_TIMEOUT_MS=150000` in Vercel env
2. Watch `render_timing_summary` events for `geminiMs`
3. If `geminiMs` > 120 000 ms consistently → model is slow regardless of payload size
4. Watch for `gemini_call_timeout` events after deploy

---

## Remaining Risks

| Risk | Severity |
|---|---|
| Gemini model inference is inherently 40–90 s for complex scenes | Medium — 150 s timeout + retry with smaller dims mitigates |
| AbortSignal does not cancel server-side Gemini computation — still billed | Low — no workaround at client level |
| JPEG quality 85 may reduce fine-grain texture detail vs PNG | Low — 85% well above Gemini perceptual threshold at 768 px |
| Timeout retry re-fetches images from storage (~2–3 s overhead) | Low — only on timeout path |
| Vercel function killed before 150 s JS timeout fires | Low — `recoverStuckRenderJob` handles at 8-minute mark |
