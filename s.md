# Room Preview System Design Review

## 1. Executive Summary

This review documents the Room Preview implementation that currently exists in this codebase. The flow implemented is:

```text
Screen launcher -> session creation -> QR code -> mobile activation -> gate form
-> mobile connects -> room image upload -> product selection -> render request
-> Gemini render pipeline -> result saved -> screen updates by SSE or polling
```

The system is not "local development only". It already contains several production-oriented pieces: PostgreSQL through Prisma, optional Redis for distributed pub/sub and limits, R2/S3-compatible storage support, HMAC session tokens, admin auth, cleanup cron, diagnostics, Sentry, and render concurrency controls.

It is still not fully production-ready for a real multi-screen, multi-instance showroom deployment. The main gaps are:

- The render pipeline is not a durable background job. `POST /render` starts work with Next.js `after()` and `maxDuration = 300`, so the AI render is still tied to the web request/runtime invocation.
- There is no database-enforced "one active session per screenId". The screen launcher relies mainly on browser `localStorage`, and `ROOM_PREVIEW_SINGLE_SCREEN_MODE` is global, not per screen.
- Redis is required for reliable multi-instance SSE, locks, cooldowns, and rate limits, but many Redis failures intentionally fail open.
- Uploaded and rendered files can be stored in R2/S3, but direct upload confirmation does not verify that the object actually exists in storage.
- Cleanup covers sessions and stuck render jobs, but no application-level object-storage cleanup for old uploads/renders was found in code.

The required production design should keep PostgreSQL as source of truth, make Redis mandatory for realtime and coordination, move rendering to a durable queue/worker, enforce one active session per screen in the database/Redis lock layer, and store all files in cloud object storage.

## 2. Current System Design

### High-Level Architecture

Current components:

- Next.js 16 App Router pages and route handlers.
- PostgreSQL database via Prisma 7 and `@prisma/adapter-pg`.
- Redis through `ioredis`, enabled only when `REDIS_URL` exists and `ENABLE_REDIS !== "false"`.
- SSE endpoint for screen realtime updates.
- Client polling fallback for the screen and primary mobile render completion tracking.
- Cloud or local file storage through `lib/storage.ts`.
- Gemini image render provider as the active provider.
- Admin dashboard and diagnostics tables.

Important files inspected:

- API routes:
  - `app/api/room-preview/sessions/route.ts`: `POST`
  - `app/api/room-preview/sessions/[sessionId]/route.ts`: `GET`
  - `app/api/room-preview/sessions/[sessionId]/activate/route.ts`: `GET`, `POST`
  - `app/api/room-preview/sessions/[sessionId]/connect/route.ts`: `POST`
  - `app/api/room-preview/sessions/[sessionId]/events/route.ts`: `GET`
  - `app/api/room-preview/sessions/[sessionId]/room/route.ts`: `POST`
  - `app/api/room-preview/sessions/[sessionId]/room/upload-url/route.ts`: `POST`
  - `app/api/room-preview/sessions/[sessionId]/room/confirm-upload/route.ts`: `POST`
  - `app/api/room-preview/sessions/[sessionId]/product/route.ts`: `POST`
  - `app/api/room-preview/sessions/[sessionId]/render/route.ts`: `POST`
  - `app/api/room-preview/sessions/[sessionId]/test-render/route.ts`: `POST`
  - `app/api/room-preview/sessions/[sessionId]/diagnostics/route.ts`: `POST`
  - `app/api/room-preview/sessions/[sessionId]/screen-token/route.ts`: `POST`
  - `app/api/room-preview/cleanup/route.ts`: `GET`
  - `app/api/room-preview/dev-entry/route.ts`: `GET`
  - `app/api/health/route.ts`: `GET`
  - `app/api/admin/screens/route.ts`: `GET`, `POST`
  - `app/api/admin/screens/[screenId]/route.ts`: `PATCH`, `DELETE`
- UI and client flow:
  - `components/room-preview/ScreenLauncherClient.tsx`
  - `components/room-preview/ScreenSessionClient.tsx`
  - `components/room-preview/SessionQRCode.tsx`
  - `components/room-preview/MobileSessionClient.tsx`
  - `features/room-preview/screen/useScreenSession.ts`
  - `features/room-preview/mobile/useMobileSession.ts`
  - `app/room-preview/screen/[sessionId]/page.tsx`
  - `app/room-preview/mobile/[sessionId]/page.tsx`
  - `app/room-preview/gate/[sessionId]/actions.ts`
- Core services:
  - `lib/room-preview/session-service.ts`
  - `lib/room-preview/session-repository.ts`
  - `lib/room-preview/session-machine.ts`
  - `lib/room-preview/session-status.ts`
  - `lib/room-preview/session-events.ts`
  - `lib/room-preview/session-events-client.ts`
  - `lib/room-preview/session-client.ts`
  - `lib/room-preview/session-polling.ts`
  - `lib/room-preview/render-service.ts`
  - `lib/room-preview/render-repository.ts`
  - `lib/room-preview/render-rate-limit.ts`
  - `lib/room-preview/gemini-semaphore.ts`
  - `lib/room-preview/screen-repository.ts`
  - `lib/room-preview/upload-service.ts`
  - `lib/room-preview/room-service.ts`
  - `lib/room-preview/product-service.ts`
  - `lib/room-preview/session-cleanup.ts`
  - `lib/room-preview/render-job-cleanup.ts`
  - `lib/room-preview/stuck-detection.ts`
  - `lib/room-preview/session-diagnostics.ts`
  - `lib/redis.ts`
  - `lib/storage.ts`
  - `lib/ip-rate-limit.ts`
  - `proxy.ts`
  - `instrumentation.ts`
  - `next.config.ts`
  - `vercel.json`
- Render providers:
  - `lib/room-preview/render-providers/index.ts`
  - `lib/room-preview/render-providers/gemini-provider.ts`
  - `lib/room-preview/render-providers/ai-provider.ts`
  - `lib/room-preview/render-providers/types.ts`
- Database:
  - `prisma/schema.prisma`

I also inspected the local Next.js 16 docs in `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`, `16-proxy.md`, and `17-deploying.md`. The project uses App Router Route Handlers and `proxy.ts`, which matches the local Next 16 documentation.

## 3. Current User Flow

Current screen flow:

1. `app/room-preview/screen/page.tsx` renders the launcher.
2. `ScreenLauncherClient` runs `createSession()`.
3. It first calls `validateStoredScreenSession()` and tries to reuse a session id from `localStorage`.
4. It uses `acquireScreenSessionCreateLock()` and a React ref to reduce duplicate creates in the same browser.
5. It calls `createRoomPreviewSession()` from `lib/room-preview/session-client.ts`.
6. `POST /api/room-preview/sessions` creates a `RoomPreviewSession` and returns an HMAC token.
7. The browser navigates to `/room-preview/screen/[sessionId]`.
8. `ScreenSessionPage` generates a QR code server-side using `QRCode.toDataURL()`.
9. The QR points to `/api/room-preview/sessions/[sessionId]/activate?t=<token>&lang=<locale>`.
10. `ScreenSessionClient` uses `useScreenSession()` to fetch the session and subscribe to SSE.

Current mobile flow:

1. Mobile scans the QR.
2. `GET /api/room-preview/sessions/[sessionId]/activate` verifies the HMAC token and sets the `rp-mobile-token` HttpOnly cookie.
3. The mobile browser is redirected to `/room-preview/mobile/[sessionId]`.
4. `MobileSessionPage` checks whether the gate has been completed with `sessionHasCompletedGate()`.
5. If needed, it redirects to `/room-preview/gate/[sessionId]`.
6. `submitGateForm()` validates the mobile token, creates a `UserSession`, binds it to `RoomPreviewSession.userSessionId`, calls `connectAfterGateSuccess()`, and redirects back to mobile.
7. `useMobileSession()` loads the session and auto-connects if needed.
8. The user uploads/selects a room image.
9. The user selects a product.
10. The user starts rendering.
11. Mobile polls for the render result through `pollForRenderResult()`.
12. Screen receives updates through SSE when available or polling fallback when SSE fails.

## 4. Current API Design

### Session APIs

`POST /api/room-preview/sessions`

- Implemented in `app/api/room-preview/sessions/route.ts`.
- Main function: `POST(request)`.
- Uses `checkIpRateLimit()`, `checkActiveSessionsPerIp()`, `registerSessionForIp()`, `createRoomPreviewSession()`, and `generateSessionToken()`.
- Creates a session and sets `rp-screen-token`.
- Accepts optional `x-screen-token` to bind a registered screen.
- Rate limiting is disabled in development through `isRoomPreviewRateLimitDisabled()`.

`GET /api/room-preview/sessions/[sessionId]`

- Implemented in `app/api/room-preview/sessions/[sessionId]/route.ts`.
- Main function: `GET(_request, context)`.
- Uses `getRoomPreviewSession()`.
- Returns 404 for missing session and 410 for expired session.

`GET/POST /api/room-preview/sessions/[sessionId]/activate`

- Implemented in `app/api/room-preview/sessions/[sessionId]/activate/route.ts`.
- Main functions: `GET()`, `POST()`.
- Verifies token with `verifySessionToken()`.
- Sets `rp-mobile-token`.
- Tracks `qr_opened`.

`POST /api/room-preview/sessions/[sessionId]/connect`

- Implemented in `app/api/room-preview/sessions/[sessionId]/connect/route.ts`.
- Main function: `POST()`.
- Uses `guardSession()` and `connectMobileToSession()`.
- Tracks `qr_scanned` after the response.

`POST /api/room-preview/sessions/[sessionId]/screen-token`

- Implemented in `app/api/room-preview/sessions/[sessionId]/screen-token/route.ts`.
- Main function: `POST()`.
- Verifies token and sets `rp-screen-token`.
- Not found as an active caller in the inspected client code. `ScreenLauncherClient` currently uses the cookie returned by session creation instead.

### Room and Product APIs

`POST /api/room-preview/sessions/[sessionId]/room`

- Implemented in `app/api/room-preview/sessions/[sessionId]/room/route.ts`.
- Main function: `POST()`.
- Supports demo room and multipart file upload.
- Uses `saveRoomPreviewUploadedFile()` for camera/gallery.
- Validates content length before parsing form data.
- Persists room through `selectRoomForSession()`.
- Performs a verification read with `getRoomPreviewSession()`.

`POST /api/room-preview/sessions/[sessionId]/room/upload-url`

- Implemented in `app/api/room-preview/sessions/[sessionId]/room/upload-url/route.ts`.
- Main function: `POST()`.
- Only works when `STORAGE_PROVIDER === "r2"`.
- Generates an R2 presigned PUT URL.
- Validates MIME type, file size, and source.

`POST /api/room-preview/sessions/[sessionId]/room/confirm-upload`

- Implemented in `app/api/room-preview/sessions/[sessionId]/room/confirm-upload/route.ts`.
- Main function: `POST()`.
- Confirms a direct upload by saving `publicUrl` into session state.
- Validates object key prefix and basic URL shape.
- Not found: a `HeadObject` or equivalent object-exists check against R2/S3 before accepting the uploaded URL.

`POST /api/room-preview/sessions/[sessionId]/product`

- Implemented in `app/api/room-preview/sessions/[sessionId]/product/route.ts`.
- Main function: `POST()`.
- Uses Zod body validation.
- Product source is `data/room-preview/mock-products.ts`.
- Persists product through `selectProductForSession()`.

### Render APIs

`POST /api/room-preview/sessions/[sessionId]/render`

- Implemented in `app/api/room-preview/sessions/[sessionId]/render/route.ts`.
- Main function: `POST()`.
- Exports `maxDuration = 300` and `dynamic = "force-dynamic"`.
- Uses `guardSession()`, Redis render lock, device cooldown, per-session render count, screen cooldown, screen budget, render hash dedupe, and `executeRenderPipeline(sessionId)` in `after()`.
- Returns `202` after setting session to `ready_to_render`.

`POST /api/room-preview/sessions/[sessionId]/test-render`

- Implemented in `app/api/room-preview/sessions/[sessionId]/test-render/route.ts`.
- Main function: `POST()`.
- Returns 404 in production.
- Development-only route that selects a product and starts rendering.

### Realtime and Diagnostics APIs

`GET /api/room-preview/sessions/[sessionId]/events`

- Implemented in `app/api/room-preview/sessions/[sessionId]/events/route.ts`.
- Main function: `GET()`.
- Exports `dynamic = "force-dynamic"` and `runtime = "nodejs"`.
- Uses `ReadableStream` for SSE.
- Sends initial session state, keepalive comments, and `retry: 3000`.
- Subscribes with `subscribeToRoomPreviewSessionEvents()`.

`POST /api/room-preview/sessions/[sessionId]/diagnostics`

- Implemented in `app/api/room-preview/sessions/[sessionId]/diagnostics/route.ts`.
- Main function: `POST()`.
- Uses in-memory rate limit, event dedupe, and session validity cache.
- Persists diagnostics via `after()` with `trackSessionEvent()` and `openSessionIssue()`.
- No session token required. It validates session existence/status instead.

### Maintenance and Admin APIs

`GET /api/room-preview/cleanup`

- Implemented in `app/api/room-preview/cleanup/route.ts`.
- Main function: `GET()`.
- Protected by `x-cleanup-secret` only when `CLEANUP_SECRET` is set.
- Calls `detectStuckSessions()`, `failStuckRenderingSessions()`, `completeResultReadySessions()`, `expireIdleWaitingSessions()`, and `expireOldSessions()`.

`GET /api/health`

- Implemented in `app/api/health/route.ts`.
- Main function: `GET()`.
- Checks database with `SELECT 1`.
- Checks Redis only when `isRedisEnabled()` is true.

Admin screens:

- `app/api/admin/screens/route.ts`: `GET()` lists screens and `POST()` creates a screen with one-time token.
- `app/api/admin/screens/[screenId]/route.ts`: `PATCH()` updates a screen and `DELETE()` deletes one.

## 5. Current Database Design

Database source of truth is PostgreSQL via Prisma in `prisma/schema.prisma`.

Models inspected:

- `Screen`
  - Registered showroom screen.
  - Fields include `secretHash`, `dailyBudget`, `isActive`, `lastRenderAt`.
  - Relationship: `sessions RoomPreviewSession[]`.
  - No field or unique constraint for active session ownership.

- `RoomPreviewSession`
  - Main state object.
  - Fields include `status`, `mobileConnected`, `renderCount`, `selectedRoom`, `selectedProduct`, `renderResult`, `expiresAt`, `screenId`, `lastRenderHash`, `userSessionId`.
  - Has indexes on `status`, `expiresAt`, `userSessionId`, and `screenId`.
  - No database enum for `status`; status is a string.
  - No unique partial index enforcing one live session per `screenId`.

- `RenderJob`
  - Tracks render execution.
  - Fields include `sessionId`, `status`, `input`, `result`, `failureReason`, `inputHash`.
  - Used as render audit and result pipeline record.

- `SessionEvent`
  - Diagnostics event stream persisted to DB.
  - Stores source, event type, level, status before/after, code, message, metadata.

- `SessionIssue`
  - Open/resolved issue tracking.
  - Uses `dedupeKey` unique to avoid duplicate open issues.

- `UserSession`
  - Gate identity record.
  - Bound one-to-one through `RoomPreviewSession.userSessionId @unique`.

- `Event`
  - Analytics journey events such as `user_entered`, `qr_scanned`, `room_opened`, `render_started`, `render_completed`, `render_failed`.

Repository functions inspected:

- `createSession()`, `getSessionById()`, `updateSession()`, `saveSessionState()`, `tryClaimRenderingSlot()`, `tryIncrementRenderCount()`, `decrementRenderCount()`, `findActiveLiveSessions()`, `expireSessionById()` in `lib/room-preview/session-repository.ts`.
- `createRenderJob()`, `updateRenderJob()` in `lib/room-preview/render-repository.ts`.
- `findActiveScreenByToken()`, `getActiveScreenById()`, `checkScreenCooldown()`, `touchScreenLastRenderAt()`, `checkAndIncrementScreenBudget()`, `decrementScreenBudget()`, `saveSessionRenderHash()` in `lib/room-preview/screen-repository.ts`.

## 6. Current Realtime/Event Design

Current realtime mechanism:

- Screen client uses SSE through `createRoomPreviewSessionEventsClient()` in `lib/room-preview/session-events-client.ts`.
- SSE route is `app/api/room-preview/sessions/[sessionId]/events/route.ts`.
- Server event publish/subscribe is in `lib/room-preview/session-events.ts`.
- Redis Pub/Sub is used when `REDIS_URL` is configured and `ENABLE_REDIS !== "false"`.
- In-memory bus is used when Redis is not enabled.

Redis design:

- `lib/redis.ts` creates three singleton Redis clients:
  - `getRedisPublisher()` for publish.
  - `getRedisSubscriber()` for subscribe.
  - `getRedisClient()` for commands, locks, rate limits, and semaphores.
- `subscribeRedis()` uses Redis channel `room-preview:session:${sessionId}`.
- `publishRedis()` also publishes to global fanout channel `room-preview:events`.
- Redis subscription ref-counting exists to avoid unsubscribing all listeners when one SSE stream closes.

Fallback behavior:

- Without Redis, `subscribeInMemory()` and `publishInMemory()` work only inside the same Node.js process.
- This is acceptable for local single-process development.
- This is not reliable on Vercel/serverless/multiple instances.

Mobile realtime:

- Not found as SSE consumer in mobile render result flow.
- Mobile uses polling via `pollForRenderResult()` in `lib/room-preview/session-polling.ts`.

## 7. Current Render Pipeline

Render request flow:

1. Mobile calls `createRenderForSession()` in `lib/room-preview/session-client.ts`.
2. This calls `POST /api/room-preview/sessions/[sessionId]/render`.
3. Route `POST()` in `app/api/room-preview/sessions/[sessionId]/render/route.ts` verifies auth with `guardSession()`.
4. It attempts `acquireRenderLock(sessionId)` from `lib/room-preview/render-rate-limit.ts`.
5. It loads session, screen fields, and device cooldown in parallel.
6. It checks dedupe hash with `buildRenderHash()`.
7. It checks per-device cooldown, session render count, screen cooldown, and screen daily budget.
8. It transitions the session to `ready_to_render` using `markReadyToRenderTransition()`.
9. It saves session state and publishes a session event.
10. It schedules metadata writes and analytics in `after()`.
11. It schedules `executeRenderPipeline(sessionId)` in `after()`.
12. It returns the updated session with HTTP 202.

Pipeline execution:

- Implemented in `lib/room-preview/render-service.ts`.
- Main functions: `executeRenderPipeline()`, `runRoomPreviewRenderPipeline()`, `buildRenderJobInput()`, `markSessionAsFailed()`, `persistSessionTransition()`.
- `runRoomPreviewRenderPipeline()` first uses `tryClaimRenderingSlot(sessionId)`, an atomic DB update from `ready_to_render` to `rendering`.
- It creates a `RenderJob`, updates it to `processing`, acquires a Gemini semaphore, calls `renderRoomPreviewWithProvider()`, stores result, marks job completed, and marks session `result_ready`.
- On failure, it marks render job failed, marks session failed, opens diagnostics issue, tracks `render_failed`, and decrements session render count.

Provider:

- Active provider is `geminiRoomPreviewRenderProvider` from `lib/room-preview/render-providers/gemini-provider.ts`.
- `getRoomPreviewRenderProvider()` in `lib/room-preview/render-providers/index.ts` always returns Gemini.
- `aiRoomPreviewRenderProvider` in `lib/room-preview/render-providers/ai-provider.ts` exists but is not selected by `index.ts`; it is effectively unused in current render flow.

Gemini behavior:

- Loads room and product images with `loadAndPrepareImage()`.
- Uses `sharp` to auto-orient and resize large images to max 1280px.
- Calls Gemini through `GoogleGenAI`.
- Model list defaults to `gemini-2.5-flash-image` and `gemini-3.1-flash-image-preview`, or `GEMINI_IMAGE_MODELS`.
- Per-call timeout is 100 seconds.
- Retries retryable 429/503 errors up to 3 times per model.
- Validates output byte size, output dimensions, non-identical output, and aspect-ratio drift.
- Uploads final PNG through `storageUpload()`.

Not found in codebase:

- Durable background queue such as BullMQ, Cloud Tasks, SQS, Inngest, or a dedicated worker process.
- A render job table state machine that is advanced by a separate worker independent of web route invocation.
- Idempotency key header support for render requests.
- Dead-letter queue.

## 8. Current Storage Design

Storage abstraction:

- Implemented in `lib/storage.ts`.
- Main functions: `storageUpload()`, `storageDelete()`, `storagePublicUrl()`.
- Supports:
  - local filesystem under `public/uploads/...`
  - R2/S3-compatible storage through AWS SDK.

Production guard:

- `lib/storage.ts` throws in production if `STORAGE_PROVIDER` is not `r2` or `s3`.
- This prevents accidental local filesystem use in production.

Upload paths:

- Multipart upload path:
  - `POST /room` receives `FormData`.
  - `saveRoomPreviewUploadedFile()` validates MIME, magic bytes, size, dimensions, and aspect ratio.
  - `storageUpload()` stores the file.
- Direct R2 upload path:
  - `POST /room/upload-url` creates presigned PUT URL.
  - Browser uploads directly to R2 using `uploadFileToR2()` in `lib/room-preview/room-service.ts`.
  - `POST /room/confirm-upload` saves `publicUrl` to session state.

Render result path:

- Gemini provider builds key `uploads/room-preview/renders/${sessionId}-${jobId}.png`.
- The final image is uploaded through `storageUpload()`.
- The public URL is stored in both `RenderJob.result` and `RoomPreviewSession.renderResult`.

Storage risks:

- Direct upload confirmation only validates object key prefix and URL shape. It does not verify object existence, content type, or size against R2/S3 before saving.
- `storageDelete()` exists, but not found as used for session/upload/render cleanup.
- No object lifecycle cleanup job was found in application code.
- Local storage is usable in development only and is explicitly blocked in production.

## 9. Current Security & Rate Limiting

Authentication and tokens:

- Session token implementation is in `lib/room-preview/session-token.ts`.
- `generateSessionToken(sessionId)` creates deterministic HMAC-SHA256 token over session id.
- `verifySessionToken(token, sessionId)` uses `timingSafeEqual()`.
- Production requires `SESSION_TOKEN_SECRET`; development falls back to an insecure dev secret.
- Mutation guard is `guardSession()` in `lib/room-preview/api-guard.ts`.
- Mobile token cookie: `rp-mobile-token`.
- Screen token cookie: `rp-screen-token`.

Screen registration:

- `lib/room-preview/screen-token.ts` generates `rps_...` screen tokens and stores only `secretHash`.
- Admin screen APIs create screens and return token once.

Proxy:

- `proxy.ts` is the Next 16 proxy file.
- It protects `/admin` routes except `/admin/login`.
- It applies broad API rate limits by IP through `checkIpRateLimit()`.
- It sets security headers such as `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Permissions-Policy`.

Rate limiting:

- `lib/ip-rate-limit.ts`
  - Redis-backed fixed window with in-memory fallback.
  - Active session tracking by IP using Redis sorted sets.
  - Falls open when Redis is unavailable.
- `lib/room-preview/render-rate-limit.ts`
  - Device cooldown key in Redis.
  - Render lock with Redis `SET NX EX`.
  - Falls open when Redis is unavailable.
- `lib/room-preview/gemini-semaphore.ts`
  - Redis sorted-set semaphore for Gemini concurrency.
  - Falls open when Redis is unavailable.
- `app/api/room-preview/sessions/[sessionId]/diagnostics/route.ts`
  - In-memory per-session diagnostics limit and dedupe.

Security gaps:

- `GET /sessions/[sessionId]` is not token-protected. Anyone with a valid session id can read session state.
- Diagnostics endpoint does not require token.
- QR activation token is in the query string, so it can appear in access logs. The route immediately moves it to an HttpOnly cookie, but the initial URL still contains it.
- Rate limiting is disabled in development and many Redis failures fail open in production.
- Direct upload confirmation does not verify the object exists in storage.

## 10. Current Deployment Assumptions

Deployment files and behavior:

- `package.json` uses `next build`, `next start`, and `prisma generate`.
- `next.config.ts` configures remote images for R2/S3 and custom `R2_PUBLIC_URL`, security headers, no-store API cache headers, and LAN dev origins.
- `instrumentation.ts` validates environment on startup and starts in-process cleanup only in development.
- `vercel.json` configures a daily cron at `0 3 * * *` for `/api/room-preview/cleanup`.
- `lib/server/prisma.ts` creates a `pg` pool with `DATABASE_POOL_SIZE`, default 5.

Production env validation:

- `lib/env.ts` requires these in production:
  - `DATABASE_URL`
  - `SESSION_TOKEN_SECRET`
  - `CLEANUP_SECRET`
  - `NEXT_PUBLIC_BASE_URL`
  - `ADMIN_JWT_SECRET`
  - `GEMINI_API_KEY`
  - `REDIS_URL`

Important mismatch:

- `lib/env.ts` requires `REDIS_URL` in production, which is good.
- `lib/redis.ts` still has fallback behavior and warns if Redis is missing in production.
- `storage.ts` hard-fails local storage in production.

Vercel/serverless assumptions:

- Render route exports `maxDuration = 300`.
- Code comments say this requires Vercel Pro.
- The render pipeline runs inside `after()`, not a separate worker.
- Cleanup cron is daily, while stuck render threshold is 7 minutes. If only Vercel cron runs daily, stuck sessions may remain stale for a long time unless admin cleanup or another scheduler runs more frequently.

## 11. Problems Found

### Production Suitability

Is the design suitable for local development only?

No. It is more than local development only. It has real production constructs: PostgreSQL, Redis support, R2/S3 storage, session tokens, admin auth, environment validation, cleanup, and observability.

Is it suitable for production?

Not yet for serious production traffic. It can support a controlled pilot if deployed with PostgreSQL, Redis, R2/S3, a pooled database connection, Vercel Pro or equivalent long function duration, and close operational monitoring. It should not be treated as production-ready for many screens, high concurrency, or strict reliability until render jobs are moved to a durable worker architecture and one-active-session-per-screen is enforced server-side.

### What Breaks on Vercel, Serverless, or Multiple Instances

- Without Redis, SSE events do not propagate across instances. `session-events.ts` falls back to process memory only.
- Without Redis, rate limits, render lock, device cooldown, active-session limits, and Gemini semaphore degrade or fail open.
- `after()` render work is still bound to the web invocation. Function timeout, termination, provider latency, or cold/runtime limits can leave sessions in `ready_to_render` or `rendering`.
- Cleanup is daily in `vercel.json`, so stuck sessions can remain visible much longer than the 7-minute stuck threshold.
- Database connection count can grow with concurrent serverless invocations. `DATABASE_POOL_SIZE` helps but still needs an external pooler for scale.
- Local storage is blocked in production, so production requires R2/S3 configuration.

### Race Conditions

- Duplicate session creation:
  - `ScreenLauncherClient` uses browser-local locks only.
  - Multiple browsers or multiple physical screens with the same screen token can still create multiple live sessions.
  - `ROOM_PREVIEW_SINGLE_SCREEN_MODE` reuses the newest global active session, not one active session per `screenId`, and its find-expire-create behavior is not atomic.

- Concurrent render requests:
  - With Redis enabled, `acquireRenderLock()` reduces duplicate request start.
  - Without Redis, two concurrent render POSTs can both pass early checks while session is still `product_selected`. Only one pipeline should win `tryClaimRenderingSlot()`, but both route handlers may return 202 and counters can be affected.
  - Render lock is released in route `finally`, before the `after()` pipeline completes. DB claim protects pipeline execution, but the Redis lock is not a full in-flight render lock.

- Screen cooldown:
  - `touchScreenLastRenderAt()` is scheduled in `after()`, not before return. A second request close in time can read stale `lastRenderAt`.

- Screen budget:
  - Redis path is atomic.
  - DB fallback counts existing render jobs and does not atomically reserve budget.

- Product debounce vs render:
  - `useMobileSession()` tries to flush pending product save before render, but this is client-side coordination. Server-side render uses whatever product is persisted at request time.

- Direct upload confirmation:
  - The client can confirm an object key and public URL matching prefix before server verifies the object exists.

### Duplicate Session Risks

- Browser `localStorage` lock reduces same-browser duplicate screen sessions.
- No database unique constraint or Redis lock enforces one live session per `screenId`.
- Registered `Screen` exists, but active session ownership is not modeled.
- Active sessions per IP are limited only when Redis is available and ready.

### Timeout Risks

- Gemini call timeout is 100 seconds per attempt/model.
- Route max duration is 300 seconds.
- Multiple models and retry delays can approach or exceed available route duration.
- Mobile waits up to 310 seconds in `pollForRenderResult()`.
- Upload timeout is 90-120 seconds plus a 60-second recovery polling window.
- If render route times out after setting session `ready_to_render` or `rendering`, cleanup must mark failure later.

### Storage Risks

- R2/S3 is supported and required in production.
- Direct upload confirmation lacks object verification.
- No application cleanup for old objects found.
- Render images and room uploads can accumulate indefinitely unless bucket lifecycle policies are configured outside this codebase.

### Scalability Risks

- Mobile render completion is polling based, not SSE based.
- `GET /sessions/[sessionId]` is a hot endpoint used by screen fallback, mobile polling, upload recovery, launchers, and diagnostics validation.
- Long render work consumes web invocation capacity.
- Redis fail-open behavior protects availability but weakens limits under Redis outage.
- Admin auto-refresh and diagnostics can add DB load during incidents.

## 12. Production-Ready System Design

Required production architecture for this product:

```text
Screen Browser
  -> Next.js web app
  -> PostgreSQL source of truth
  -> Redis pub/sub for session events

Mobile Browser
  -> Next.js API
  -> R2/S3 direct upload
  -> PostgreSQL session state
  -> Redis event stream/presence/rate limits

Render API
  -> Validate and reserve render
  -> Create RenderJob
  -> Enqueue durable background job
  -> Return 202

Render Worker
  -> Claim job atomically
  -> Acquire Redis render semaphore
  -> Fetch images from R2/S3
  -> Call Gemini/OpenAI provider
  -> Store result in R2/S3
  -> Update PostgreSQL
  -> Publish Redis event
```

Required components:

- PostgreSQL as source of truth:
  - Store screens, sessions, render jobs, events, issues, user sessions.
  - Use database transactions for session creation, render reservation, and one-active-session-per-screen transitions.
  - Consider database enum or constrained status table for session and render job statuses.

- Redis:
  - Pub/Sub or streams for realtime session updates.
  - Per-screen active-session lock.
  - Render idempotency lock.
  - Device cooldown.
  - IP rate limits.
  - Active-session counters.
  - Gemini/render semaphore.
  - Short-lived event replay buffer if SSE reconnects need missed events.

- Cloud storage:
  - Use Cloudflare R2/S3 for all uploads and render results.
  - Use presigned upload URLs for room images.
  - Confirm upload with server-side `HeadObject` and metadata validation.
  - Use object lifecycle policies for old room uploads and renders.

- Background render jobs:
  - `POST /render` should only validate, reserve, create `RenderJob`, enqueue work, and return.
  - Worker should execute the provider call and update DB.
  - Queue can be BullMQ/Redis, SQS, Cloud Tasks, Inngest, or another durable job system.
  - Worker should have retries, timeout, dead-letter handling, and stuck-job recovery.

- One active session per screenId:
  - Add active session ownership by `screenId`.
  - Enforce in DB/transaction and Redis lock.
  - Creating a new session for a screen should atomically expire or supersede the previous live session.
  - Store `screenId`, `session generation`, and possibly `activeSessionId` on `Screen`.

- Multi-instance safe realtime:
  - SSE endpoint can remain, but Redis must be mandatory.
  - Publish every state transition after DB commit.
  - Both screen and mobile should subscribe to session events.
  - Polling should be fallback only.

- Idempotent APIs:
  - Add idempotency keys for `POST /render`, upload confirmation, and session creation.
  - Persist request ids or idempotency keys with response snapshots or job ids.
  - Make duplicate render calls return existing in-flight job/session state.

- Cleanup jobs:
  - Run frequent cleanup, not only daily.
  - Separate jobs:
    - expire old sessions
    - fail stuck render jobs
    - release abandoned active screen sessions
    - delete old local/cloud objects or rely on bucket lifecycle with matching metadata
    - close stale Redis locks/counters

- Observability:
  - Structured logs with request id, session id, screen id, render job id, user session id.
  - Metrics for render duration, queue wait time, provider errors, upload failures, SSE disconnects, polling fallback rate, DB query latency, Redis latency.
  - Alerts for stuck render jobs, high failure rate, queue backlog, Redis unavailable, DB pool saturation, object storage failures.

- Admin dashboard:
  - Current admin dashboard is a good start.
  - Required additions:
    - screens list with current active session
    - force expire/reset active screen session
    - render queue backlog
    - live SSE/Redis health
    - storage health
    - provider quota/error status
    - recent stuck jobs
    - per-screen daily budget usage
    - customer/session drilldown

## 13. Current vs Required Design Table

| Current design | Problem | Required design | Priority |
|---|---|---|---|
| Render pipeline runs from `POST /render` through `after(() => executeRenderPipeline())`. | Long AI work is tied to web invocation and `maxDuration = 300`. | Durable render queue plus separate worker. API only enqueues. | P0 |
| Redis is used when configured, with in-memory fallback. | In-memory fallback breaks multi-instance realtime and limits. | Redis mandatory in production for pub/sub, locks, limits, semaphore. | P0 |
| Screen session uniqueness is enforced mostly by `localStorage` in `ScreenLauncherClient`. | Multiple browsers/instances can create duplicate active sessions. | One active session per `screenId` enforced server-side with DB transaction and Redis lock. | P0 |
| Screen uses SSE, mobile uses polling for render completion. | Mobile creates DB load and slower perceived updates. | Both screen and mobile subscribe to session events; polling fallback only. | P1 |
| Direct upload confirmation saves `publicUrl` after prefix validation. | Server can accept missing or invalid object. | Confirm with `HeadObject`, content length, content type, and metadata before saving. | P0 |
| Cleanup cron in `vercel.json` runs daily. | Stuck render threshold is minutes, but cron can leave sessions stale for hours. | Run cleanup every 1-5 minutes or use queue worker watchdog. | P1 |
| `GET /sessions/[sessionId]` is public by session id. | Session data is readable to anyone with id. | Require screen/mobile session token or scoped read token where practical. | P1 |
| `POST /room` multipart path buffers and validates image in web request. | Heavy upload path can be slow and memory-heavy. | Prefer direct-to-R2 upload, then async/server validation and state update. | P1 |
| `POST /product` and room client services perform extra GET verification. | Extra DB reads and latency. | Return complete updated session and trust server response validation. | P2 |
| Render lock is released before pipeline completion. | Lock is only a request-start guard, not full in-flight protection. | Keep render/job idempotency at job layer until terminal state. | P1 |
| DB fallback screen budget counts render jobs. | Not atomic under concurrent requests. | Atomic DB reservation row or Redis required for budget reservations. | P1 |
| `storageDelete()` exists but no upload/render cleanup use found. | Old files accumulate. | Bucket lifecycle policies plus cleanup metadata/job. | P1 |
| `ai-provider.ts` exists but provider index always returns Gemini. | OpenAI provider is unused/mock. | Make provider selection explicit by env/config or remove unused provider. | P2 |
| Diagnostics rate limit is process-local. | Multi-instance diagnostics spam is not globally limited. | Redis-backed diagnostics limits or lower-value event sampling. | P2 |
| Admin dashboard has sessions, render jobs, cleanup actions. | Missing full operational view of queue, Redis, storage, per-screen active sessions. | Expand admin dashboard for production operations. | P1 |

## 14. Priority Fixes

P0 fixes before production:

1. Move render execution out of `after()` and into a durable background job worker.
2. Enforce one active live session per `screenId` in server-side logic.
3. Make Redis a hard production dependency for realtime, locks, limits, and render semaphore.
4. Verify direct R2/S3 uploads server-side before saving `publicUrl`.
5. Add idempotency to render request and job creation.

P1 important fixes:

1. Use SSE for mobile render result updates.
2. Run cleanup every 1-5 minutes or through a worker watchdog.
3. Add object storage lifecycle cleanup.
4. Tighten session read authorization where possible.
5. Make screen cooldown and render reservation atomic before returning 202.
6. Add operational metrics and alerts.

P2 improvements:

1. Remove extra GET after room/product POSTs.
2. Add lower-volume diagnostics sampling or batching.
3. Make provider selection explicit.
4. Add admin screens active-session view and queue view.
5. Back off screen polling fallback.

## 15. Recommended Implementation Roadmap

Phase 1: Stabilize current deployment

- Require Redis and R2/S3 in production health checks.
- Run cleanup more frequently.
- Verify direct uploads with object storage metadata.
- Add idempotency key support for render requests.
- Add server-side per-screen active session lock and DB tracking.

Phase 2: Reduce DB and realtime pressure

- Use SSE on mobile during render.
- Keep polling only as fallback.
- Return full updated session from room/product APIs and remove client-side extra GETs.
- Add Redis-backed diagnostics rate limiting or sampling.

Phase 3: Move rendering to production job architecture

- Add a durable job queue.
- Change `/render` to create a `RenderJob` and enqueue.
- Build a worker that claims jobs, runs provider calls, stores output, updates DB, and publishes events.
- Add retry/dead-letter handling and queue metrics.

Phase 4: Production operations

- Expand admin dashboard with active sessions per screen, queue backlog, provider health, Redis health, storage health, and per-screen budgets.
- Add alerts for render failure rate, stuck jobs, SSE fallback rate, queue age, DB pool saturation, Redis errors, and storage errors.
- Add object lifecycle policies and documented retention.

## 16. Final Verdict

The current system is a thoughtful prototype/pilot architecture with several real production guardrails already implemented. It is good enough for local development and controlled demos, and it can run as a small pilot if Redis, R2/S3, PostgreSQL pooling, and long function duration are configured correctly.

It is not yet the required production architecture for this product. The key blocker is the render pipeline: AI rendering must become a durable background job. The second blocker is session ownership: the server must enforce exactly one active session per screen. The third blocker is realtime coordination: Redis must be treated as required infrastructure, not an optional enhancement, for multi-instance deployment.

Once those are fixed, the existing state machine, diagnostics, storage abstraction, admin foundation, and Prisma schema give the system a solid base to grow from.
