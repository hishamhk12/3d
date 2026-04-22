# Project Documentation

## 1. Project Overview

This project is a Next.js 16 application for showroom-based digital experiences. The codebase currently contains two product areas:

- **Room Preview**: a QR-driven showroom workflow where a large screen creates a session, a customer scans the QR code with a mobile phone, selects or uploads a room image, selects a flooring product, and triggers an AI-generated room preview.
- **Panorama Studio**: a 360-degree panorama viewer/editor for browsing predefined virtual tours and placing draft hotspots, media, and video screens inside panorama scenes.

The core business idea is to connect a physical showroom interaction with a personalized digital preview. A customer standing in front of a showroom screen can continue the experience on their phone without installing an app. The showroom screen remains a shared visual display, while the phone becomes the private controller for entering visitor details, choosing room imagery, selecting products, and generating a preview.

The main problem solved is the gap between physical product browsing and customer imagination. In a showroom, customers often need help understanding how a material will look in their own room. This platform shortens that decision path by allowing customers to upload or choose a room image and generate an AI-rendered visualization using showroom product imagery.

In a showroom/business environment, the platform provides value by:

- Turning a passive display into an interactive customer acquisition point.
- Capturing visitor identity and role before the experience starts.
- Giving sales staff a visual aid for product discussions.
- Producing operational analytics around sessions, visitors, render jobs, and conversion.
- Supporting bilingual English/Arabic interfaces.

## 2. Core Product Idea

The platform combines a **shared showroom screen** with a **customer mobile phone**.

The showroom screen creates a fresh Room Preview session and displays a QR code. The QR code opens the same session on the customer's phone and includes a signed session token. The phone then controls the workflow, while the screen listens for session updates and displays the current state.

The QR-based flow is:

1. The showroom screen opens `/room-preview/screen`.
2. The client calls `POST /api/room-preview/sessions`.
3. The backend creates a `RoomPreviewSession` in PostgreSQL and returns the session plus a signed HMAC token.
4. The screen stores the token in an HttpOnly cookie by calling `/api/room-preview/sessions/[sessionId]/screen-token`.
5. The screen renders `/room-preview/screen/[sessionId]`.
6. The screen page generates a QR code whose URL points to `/room-preview/mobile/[sessionId]?t=<token>`.
7. The customer scans the QR code and continues on mobile.

The main modules are:

- **Room Preview**: implemented session pairing, mobile gate, room upload/demo-room selection, product selection, AI rendering, real-time screen updates, and admin monitoring.
- **Panorama Studio**: implemented 360 tour viewer with two predefined tours, scene switching, draft hotspot placement, media placement, audio/video controls, and JSON copy tools. Persistence for edited hotspots/media is not implemented.
- **Admin Dashboard**: implemented login-protected operations dashboard showing session health, recent sessions, render jobs, analytics, visitor logs, and limited session actions.
- **Analytics**: implemented database-backed visitor/event tracking for key Room Preview milestones.

## 3. Full Customer Journey

### 3.1 Showroom Screen Starts The Experience

The user opens `/room-preview`. The page shows the brand logo and a start button. Pressing the button navigates to `/room-preview/screen`.

`ScreenLauncherClient` immediately enters a `creating` state and displays a loading panel. It calls `createRoomPreviewSession()`, which sends `POST /api/room-preview/sessions`.

On success:

- The backend creates a database session.
- The initial persisted status becomes `waiting_for_mobile`.
- A deterministic HMAC token is generated from the session id.
- The screen stores that token in an HttpOnly cookie by calling the screen-token API.
- The screen redirects to `/room-preview/screen/[sessionId]`.

On failure:

- The launcher shows a failed state.
- The user can retry or return to `/room-preview`.

### 3.2 QR Code Appears On The Screen

The screen session page loads the session id from the route. It reads the screen token from the `rp-screen-token` cookie and builds the mobile URL:

`/room-preview/mobile/[sessionId]?t=<token>`

The page generates a QR code server-side using the `qrcode` package and displays it next to the screen status panel.

Base URL behavior:

- In production, `NEXT_PUBLIC_BASE_URL` should provide the public application URL.
- In development, the code attempts to use the machine's LAN IP if the base URL is missing, points to localhost, or is a bare IP without a port.
- If no usable base URL is available, the QR panel displays a missing-base-url warning.

The screen also loads `ScreenSessionClient`, which fetches the session with `GET /api/room-preview/sessions/[sessionId]`.

The screen initially shows:

- QR code.
- Session status: waiting for phone connection.
- Auto-reset countdown if no mobile connects.

### 3.3 Customer Scans QR Code

The customer's phone opens `/room-preview/mobile/[sessionId]?t=<token>`.

Before the mobile experience is shown, the server checks whether the Room Preview session is already linked to a `UserSession`. If not, the customer is redirected to:

`/room-preview/gate/[sessionId]?t=<token>`

### 3.4 Mobile Gate

The gate screen asks the visitor to identify as either:

- Customer
- Employee

The customer/employee then submits:

- Full name.
- Phone number for customers.
- Employee code for employees.

The server action `submitGateForm` validates:

- The session id exists in form data.
- The token is valid for the session id.
- The role-specific form fields satisfy the Zod schema.

On success:

- A `UserSession` row is created.
- The `RoomPreviewSession.userSessionId` is atomically linked to the user session.
- A `user_entered` event is tracked asynchronously.
- The user is redirected back to `/room-preview/mobile/[sessionId]?t=<token>`.

On failure:

- Invalid/missing token redirects back to the gate with `error=invalid_session`.
- Invalid form fields redirect back to the gate with the first validation message.
- Double submission redirects into the mobile experience if the gate was already completed.

### 3.5 Mobile Session Loads

After the gate is complete, the mobile page renders `MobileSessionClient`.

The mobile client:

- Shows a splash screen first.
- Fetches the current session with `GET /api/room-preview/sessions/[sessionId]`.
- Shows loading, retry, not found, expired, or failed states depending on the response.
- Shows a development-only debug overlay in `NODE_ENV === "development"`.

At this stage, the customer sees a "Mobile Confirmation" panel with the session id and an "I'm connected" button.

### 3.6 Mobile Connection

The customer taps "I'm connected".

The mobile client calls:

`POST /api/room-preview/sessions/[sessionId]/connect`

with the signed token in the `x-session-token` header.

The backend:

- Verifies the token.
- Applies `connectMobileTransition`.
- Moves the session from `waiting_for_mobile` to `mobile_connected`.
- Sets `mobileConnected = true`.
- Publishes a `session_updated` event.
- Tracks `qr_scanned` asynchronously when a linked user session exists.

The phone now shows the room selection controls. The showroom screen updates in near real time through SSE and changes to "Waiting for room selection".

### 3.7 Room Image Selection

The customer can select a room in three ways:

- Take a photo with the phone camera.
- Upload an image from the gallery.
- Select a demo room from `public/test-assets/rooms`.

For camera/gallery uploads:

1. The browser compresses large images client-side using a canvas.
2. Images larger than 1 MB are re-encoded as JPEG at 82% quality and capped at 1920 px on the longest side.
3. The client sends multipart form data to `POST /api/room-preview/sessions/[sessionId]/room`.
4. The backend validates the session token.
5. The backend enforces a 10 MB upload limit before parsing the body.
6. The backend validates MIME type, magic bytes, image dimensions, and aspect ratio.
7. The image is stored using the configured storage provider.
8. The session transitions to `room_selected`.

For demo rooms:

1. The client sends `source=demo` and `demoRoomId`.
2. The backend looks up the demo room from `data/room-preview/demo-rooms.ts`.
3. The selected room includes image URL and optional floor geometry metadata.
4. The session transitions to `room_selected`.

The mobile client reloads the session after saving. The screen receives a session update and displays the selected room thumbnail.

Upload error/retry behavior:

- Missing files, unsupported MIME types, invalid images, oversized uploads, interrupted uploads, and storage failures return structured errors.
- Client upload timeouts attempt a short recovery loop by polling the session to see whether the upload actually succeeded.
- If recovery fails, the mobile UI shows a retryable error.

### 3.8 Product Selection

After a room is selected, the mobile phone shows the product section.

Products are loaded from image files in:

`public/test-assets/products`

Each file becomes a mock product with:

- File-derived id.
- File-derived name.
- `productType = "floor_material"`.
- Image URL.
- `barcode = null`.

The customer can:

- Tap a product card.
- Tap a simulated barcode scan button.
- Enter a product code in a simulated input flow.

Important implementation detail:

- The UI barcode scan is simulated. It does not access a camera barcode scanner.
- The code-entry path does not use the typed code to query a real catalog. It waits briefly and selects the second product if present, otherwise the first product.
- The API supports `productId` or `barcode`, but the current file-derived mock products have null barcodes.

On product selection:

1. The mobile client sends `POST /api/room-preview/sessions/[sessionId]/product`.
2. The backend validates the token.
3. The backend validates JSON with Zod.
4. The backend looks up the mock product by id or barcode.
5. The session transitions to `product_selected`.
6. The mobile client reloads the session.
7. The screen displays the selected product details and thumbnail.

### 3.9 Rendering Is Triggered

When both a room and product are selected, the mobile UI shows a create button.

The customer taps create. The mobile client calls:

`POST /api/room-preview/sessions/[sessionId]/render`

with the signed token.

The render route:

- Verifies the token.
- Derives a device fingerprint from optional `x-device-id`, IP, and User-Agent.
- Acquires a Redis render lock when Redis is configured.
- Checks a 5-minute Redis-backed device cooldown when Redis is configured.
- Atomically increments `renderCount` if the session has fewer than 2 renders.
- Tracks `render_started` asynchronously.
- Runs the full render pipeline synchronously, with `maxDuration = 300`.

The session lifecycle moves:

`product_selected -> ready_to_render -> rendering -> result_ready`

If the render pipeline fails, the session becomes `failed`.

### 3.10 AI Render Result

The AI pipeline creates a `RenderJob` row, updates it from `pending` to `processing`, calls the Gemini image provider, validates the returned image, stores the output image, updates the job to `completed`, and writes the result to the session.

On success:

- The mobile request returns the final session.
- The mobile phone displays the generated result hero with product overlay.
- The screen receives a session update and switches to a full-screen immersive result display.
- A `render_completed` event is tracked asynchronously.

On failure:

- The render job is marked `failed`.
- The session is marked `failed`.
- The screen displays the pipeline failure state.
- A `render_failed` event is tracked asynchronously.
- The screen auto-resets after the configured failure delay.

### 3.11 Screen Waiting, Retry, Timeout, And Error Behavior

The screen uses Server-Sent Events:

`GET /api/room-preview/sessions/[sessionId]/events`

The SSE endpoint sends:

- An initial connected comment.
- `retry: 3000` to control browser reconnect delay.
- An initial `session_updated` event with the current session.
- Future `session_updated` events.
- Keepalive comments every 15 seconds.

If SSE fails, `ScreenSessionClient` falls back to polling every 2 seconds.

Screen auto-reset behavior:

- No mobile connected: reset to `/room-preview/screen` after 5 minutes.
- Result ready: reset after 60 seconds.
- Render failed: reset after 15 seconds.
- Not found, expired, or load failed screen states: reset after 10 seconds.

Mobile retry behavior:

- Loading state shows a retry button after 10 seconds.
- Not found, expired, and failed states show retry/start-new-session actions.
- Upload timeout recovery polls briefly before showing failure.

### 3.12 Session End

There is no explicit customer "end session" action in the mobile flow.

The session effectively ends when:

- The render reaches `result_ready` and the showroom screen auto-resets.
- The render reaches `failed` and the screen auto-resets.
- The admin manually expires or resets the session.
- The cleanup endpoint marks old sessions as `expired`.

## 4. User Flow By Actor

### Customer

- Scans the showroom QR code.
- Completes the gate as customer or employee.
- Confirms phone connection.
- Chooses a room source.
- Uploads, captures, or selects a room image.
- Selects a flooring product from mock product assets.
- Starts rendering.
- Views, downloads, shares, or modifies the generated result on mobile.

### Showroom Screen

- Creates a session.
- Displays the QR code.
- Shows real-time session status.
- Shows selected room and product thumbnails.
- Shows render progress.
- Displays the final render full screen.
- Resets itself automatically for the next customer.

### Staff/Admin

- Logs in at `/admin/login`.
- Views operational health metrics at `/admin`.
- Reviews active/recent sessions and render jobs.
- Forces a session to expire or reset.
- Opens `/admin/analytics` for usage trends, render success rates, visitor analytics, and visitor logs.

### System/Backend

- Creates and stores sessions in PostgreSQL.
- Signs and verifies HMAC session tokens.
- Persists room/product/render state.
- Publishes session updates over SSE through Redis Pub/Sub or an in-memory bus.
- Validates uploads and API inputs.
- Tracks analytics events without blocking user-facing requests.
- Applies rate limits, render locks, render count limits, and cleanup.

### AI Rendering Pipeline

- Reads selected room and product inputs from the session.
- Creates a render job.
- Builds a Gemini prompt for applying flooring material.
- Sends the room image, product image, and prompt to Gemini.
- Validates the AI image output.
- Stores the output image.
- Updates the render job and session.
- Emits analytics events and screen updates.

## 5. Functional Features

### Implemented

- Session creation with database persistence.
- QR pairing between showroom screen and mobile phone.
- HMAC session token generation and verification.
- HttpOnly screen-token cookie storage.
- Mobile pre-access gate with role-specific validation.
- User session creation and binding to room preview sessions.
- Mobile connection confirmation.
- Room image upload from camera/gallery.
- Client-side room image compression.
- Server-side upload validation by MIME type, magic bytes, dimensions, aspect ratio, and size.
- Local filesystem storage and optional R2/S3-compatible storage.
- Demo room selection from local assets.
- Product selection from mock product image assets.
- AI rendering with Gemini image models.
- Render job persistence.
- Render result display on mobile and screen.
- Real-time screen updates via SSE.
- Polling fallback when SSE fails.
- Screen auto-reset timers.
- Session cleanup endpoint.
- Admin login, dashboard, session table, render feed, and analytics pages.
- Health endpoint for database and optional Redis.
- Pino logging.
- Sentry configuration and startup instrumentation.
- Bilingual English/Arabic UI with cookie/localStorage locale persistence.

### Partially Implemented Or Demo-Oriented

- Barcode scanning is simulated and does not use a device barcode scanner.
- Product code entry is simulated and does not query a real catalog.
- Products are file-derived mock products, not database/catalog records.
- Demo rooms are local test assets.
- Panorama hotspot/media editing is in-memory and export-by-copy only; it is not persisted.
- The OpenAI render provider file exists but is a mock and is not selected by the active provider factory.
- The analytics page includes a "conversion funnel chart coming soon" placeholder.

### Missing

- No customer account system.
- No persisted product catalog management UI.
- No staff-assisted sales workflow beyond admin monitoring.
- No explicit session close button for customers.
- No persistent Panorama Studio editor save workflow.
- No queue worker; rendering runs synchronously inside the render API request.

## 6. System Architecture

### Frontend Structure

The app uses the Next.js App Router under `app/`.

Primary UI areas:

- `app/page.tsx`: homepage selecting Panorama or Room Preview.
- `app/room-preview/*`: Room Preview landing, screen, mobile, and gate pages.
- `app/panorama/page.tsx`: Panorama Studio route.
- `app/(admin)/admin/*`: admin dashboard and analytics.
- `components/room-preview/*`: Room Preview client components.
- `components/panorama/*`: panorama viewer/editor components.
- `lib/i18n/*`: localization provider and dictionaries.

### Backend/API Structure

APIs are implemented as App Router route handlers in `app/api/`.

Room Preview APIs:

- `POST /api/room-preview/sessions`
- `GET /api/room-preview/sessions/[sessionId]`
- `POST /api/room-preview/sessions/[sessionId]/screen-token`
- `POST /api/room-preview/sessions/[sessionId]/connect`
- `POST /api/room-preview/sessions/[sessionId]/room`
- `POST /api/room-preview/sessions/[sessionId]/product`
- `POST /api/room-preview/sessions/[sessionId]/render`
- `GET /api/room-preview/sessions/[sessionId]/events`
- `GET /api/room-preview/cleanup`

Operational API:

- `GET /api/health`

### State Management

Room Preview durable state is stored in PostgreSQL through Prisma:

- `RoomPreviewSession`
- `RenderJob`
- `UserSession`
- `Event`

Client components hold local UI state for loading, button states, selected panels, countdowns, and development logs. The screen receives authoritative session updates from SSE/polling. The mobile client generally reloads the session after save operations and receives the final session directly after render.

### Database

Prisma uses PostgreSQL with the Prisma PG adapter. The generated client is configured to output under `lib/generated/prisma`.

Important models:

- `RoomPreviewSession`: workflow state, selected room/product, render result, render count, expiry, user session relation.
- `RenderJob`: input, status, result, and timing for AI render attempts.
- `UserSession`: identified visitor created by the gate.
- `Event`: analytics timeline linked to user sessions and optionally room sessions/render jobs.

### Storage

`lib/storage.ts` supports:

- Local filesystem storage under `public/uploads/...`.
- Cloud storage using S3-compatible APIs for R2/S3 when `STORAGE_PROVIDER` is `r2` or `s3`.

The code warns if local storage is used in production because files may be lost across deployments or serverless instance restarts.

### Redis And Real-Time Communication

Redis is optional.

When `REDIS_URL` is set:

- SSE session events use Redis Pub/Sub.
- Render locks and device cooldowns use Redis.
- IP rate limiting can use Redis.

When Redis is not set:

- Session events use an in-memory process-local event bus.
- Session creation rate limiting uses in-memory fallback.
- Render device cooldown is skipped.
- Render lock falls back to allowing the request, relying on the database state transition to prevent duplicate rendering.

### External Services

- Gemini image generation through `@google/genai`.
- Optional Sentry monitoring through `@sentry/nextjs`.
- Optional R2/S3 object storage through `@aws-sdk/client-s3`.

### Authentication And Authorization

Room Preview mutation APIs use signed session tokens in the `x-session-token` header.

Admin routes use:

- Username/password from environment variables.
- HMAC-signed admin session cookie.
- Middleware guard for `/admin` routes except `/admin/login`.

### Data Flow Summary

1. Screen creates session.
2. Token is generated and embedded in QR URL.
3. Mobile completes gate and connects.
4. Mobile saves room and product.
5. Backend persists session state and publishes updates.
6. Screen listens via SSE/polling.
7. Mobile triggers render.
8. Backend runs Gemini render, stores result, updates session.
9. Screen and mobile display result.
10. Analytics events are written asynchronously.

## 7. API & Data Flow

### `POST /api/room-preview/sessions`

Purpose: Create a new Room Preview session.

Inputs:

- Request headers are used to derive IP for rate limiting.
- No body required.

Outputs:

- `201` with the session fields and `token`.
- `429` if IP session creation limit is exceeded.
- `500` on creation failure.

Caller:

- `ScreenLauncherClient`.

After success:

- Screen stores token in cookie and navigates to the screen session page.

### `POST /api/room-preview/sessions/[sessionId]/screen-token`

Purpose: Store a screen-side session token in an HttpOnly cookie.

Inputs:

- JSON body: `{ token: string }`.

Outputs:

- `{ ok: true }` on success.
- `400` for invalid body, missing token, or invalid token.

Caller:

- `storeScreenSessionToken()` from the screen launcher.

After success:

- The screen page can read the token server-side and generate a QR code without exposing the token in the screen URL.

### `GET /api/room-preview/sessions/[sessionId]`

Purpose: Fetch current session state.

Inputs:

- `sessionId` path parameter.

Outputs:

- Session JSON.
- `404` with `SESSION_NOT_FOUND`.
- `410` with `SESSION_EXPIRED` if status is already `expired`.
- `500` on unexpected failure.

Callers:

- Screen client.
- Mobile client.
- Room/product client service verification/recovery.

### `POST /api/room-preview/sessions/[sessionId]/connect`

Purpose: Mark a session as mobile-connected.

Inputs:

- `x-session-token` header.

Outputs:

- `{ success: true }`.
- `401` for missing/invalid token.
- `404` for missing session.
- `400` for invalid lifecycle transition.
- `500` on unexpected failure.

Caller:

- Mobile "I'm connected" button.

After success:

- Session becomes `mobile_connected`.
- Screen receives a session update.
- `qr_scanned` event is tracked when a user session is linked.

### `POST /api/room-preview/sessions/[sessionId]/room`

Purpose: Save a room selection.

Inputs:

- `x-session-token` header.
- Multipart form data.
- `source = camera | gallery | demo`.
- For uploads: `image` file.
- For demo: `demoRoomId`.

Outputs:

- `{ success: true, room }`.
- Structured upload errors for missing file, invalid MIME, invalid image, size limit, save failure, verification failure, or aborted upload.
- `401`, `400`, `404`, `408`, `413`, `415`, `422`, or `500` depending on failure.

Caller:

- Mobile room selection controls.

After success:

- Client reloads session.
- Session becomes `room_selected`.
- Screen displays selected room.
- `room_opened` event is tracked.

### `POST /api/room-preview/sessions/[sessionId]/product`

Purpose: Save a product selection.

Inputs:

- `x-session-token` header.
- JSON body with either `productId` or `barcode`.

Outputs:

- `{ success: true, product }`.
- `401` for unauthorized.
- `400` for malformed payload or invalid transition.
- `404` for unknown product.
- `500` on unexpected failure.

Caller:

- Mobile product card/simulated scan/simulated code selection.

After success:

- Client reloads session.
- Session becomes `product_selected`.
- Screen displays selected product.

### `POST /api/room-preview/sessions/[sessionId]/render`

Purpose: Run the AI rendering pipeline for the selected room/product.

Inputs:

- `x-session-token` header.
- Optional device/request headers used for fingerprinting.

Outputs:

- Final session JSON with `status = result_ready` and `renderResult` on success.
- Final session JSON with `status = failed` if the pipeline catches a render failure.
- `401`, `400`, `404`, `429`, or `500` for validation/authorization/rate-limit failures.

Caller:

- Mobile create button.

After success:

- Screen and mobile display result.
- Render job is completed.
- Analytics events are written.

### `GET /api/room-preview/sessions/[sessionId]/events`

Purpose: Stream session updates to the showroom screen.

Inputs:

- `sessionId` path parameter.

Outputs:

- `text/event-stream`.
- Initial session update.
- `session_updated` events.
- Keepalive comments.
- `404` if session does not exist.

Caller:

- `ScreenSessionClient`.

Failure behavior:

- Client switches to polling every 2 seconds when EventSource errors.

### `GET /api/room-preview/cleanup`

Purpose: Mark expired non-terminal sessions as `expired`.

Inputs:

- Header `x-cleanup-secret` if `CLEANUP_SECRET` is configured.

Outputs:

- `{ ok: true, expired, ranAt }`.
- `401` if the configured cleanup secret is missing/wrong.
- `500` on failure.

Important note:

- The comment says the secret may be passed as a query parameter, but the implementation only checks the `x-cleanup-secret` header.

### `GET /api/health`

Purpose: Health check for operations.

Outputs:

- `200` with `status: "ok"` when checks pass.
- `503` with `status: "degraded"` when database or configured Redis checks fail.

## 8. State Machine / Lifecycle

Actual session states defined in code:

- `created`
- `waiting_for_mobile`
- `mobile_connected`
- `room_selected`
- `product_selected`
- `ready_to_render`
- `rendering`
- `result_ready`
- `failed`
- `expired`

### Initial Creation

The repository initially creates a database row with `status = created`. The session service then immediately applies the generated initial state and saves it as `waiting_for_mobile`.

### Valid Transitions

- `created` or `waiting_for_mobile` -> `mobile_connected`
- `mobile_connected` -> `room_selected`
- `room_selected` -> `room_selected` when reselecting room
- `room_selected` -> `product_selected`
- `product_selected` -> `product_selected` when reselecting product
- `product_selected` -> `ready_to_render`
- `ready_to_render` -> `rendering`
- `rendering` -> `result_ready`
- `ready_to_render` or `rendering` -> `failed`
- Any non-terminal, expired-by-time session -> `expired` through cleanup endpoint

### Locked States

The following states reject mobile connect, room selection, and product selection:

- `ready_to_render`
- `rendering`
- `result_ready`
- `failed`
- `expired`

### Transition Preconditions

- Mobile must be connected before room selection.
- Room selection requires `source` and `imageUrl`.
- Product selection requires mobile connection and a selected room with `imageUrl`.
- Product must be a valid `floor_material` product with id, name, and image URL.
- Rendering requires a selected room and selected product.
- Completing rendering requires a valid render result with image URL, job id, generated timestamp, and `kind = composited_preview`.

### Expiry Behavior

Sessions have `expiresAt`, defaulting to `SESSION_EXPIRY_MINUTES` from environment or 60 minutes.

However, expiry is not enforced automatically inside every session read. The cleanup endpoint must run to mark old sessions as `expired`. Once status is `expired`, `GET /api/room-preview/sessions/[sessionId]` returns `410`.

## 9. AI Rendering Pipeline

### Inputs

The pipeline uses:

- `sessionId`
- Selected room image URL.
- Selected product image URL.
- Product name.
- Product type.
- Render job id.

Only `floor_material` products are supported.

### Prompt Construction

Prompts are built in `lib/room-preview/prompts.ts`.

The active prompt version is:

`gemini-parquet-v2`

The prompt tells the model to:

- Treat image 1 as the base room photo.
- Treat image 2 as the flooring product reference.
- Apply the flooring material only to the visible floor.
- Preserve walls, ceiling, windows, furniture, camera angle, room geometry, lighting, and shadows.
- Preserve the room image aspect ratio.
- Return the original image with `FLOOR_NOT_VISIBLE` text if the floor is not visible.

Product names are sanitized by trimming, limiting to 80 characters, and removing quote/newline/tab characters.

### Provider And Model

The active provider factory returns `geminiRoomPreviewRenderProvider`.

Default Gemini model order:

- `gemini-2.5-flash-image`
- `gemini-3.1-flash-image-preview`

This list can be overridden with `GEMINI_IMAGE_MODELS`.

The OpenAI provider file exists, but it is currently a mock provider returning `/rs/rs.png` and is not selected by the provider factory.

### Image Processing

The Gemini provider loads both room and product images:

- Local public paths are read from disk under `public`.
- Remote URLs are fetched over HTTP with a 15-second timeout.
- Images are converted to base64 inline data.

The request sends:

- Room image inline data.
- Product image inline data.
- Prompt text.
- `responseModalities: ["TEXT", "IMAGE"]`.

### Retry And Fallback Logic

For each configured Gemini model:

- Up to 3 attempts are made.
- Retryable errors are HTTP 503 or 429.
- Backoff starts at 3 seconds and doubles per retry.
- Each Gemini call has a 100-second hard timeout.
- Non-retryable errors move to the next model immediately.

If all models fail, the pipeline throws and the session is marked `failed`.

### Output Validation

The returned image is accepted only if:

- An image part exists in the model response.
- Output is at least 10 KB.
- Output base64 is not identical to the input room image.
- The image can be decoded by `sharp`.
- Width and height are each at least 400 px.

If text includes `FLOOR_NOT_VISIBLE`, the code logs a warning but does not reject the result.

### Storage And Persistence

The accepted output is stored as:

`uploads/room-preview/renders/[sessionId]-[jobId].png`

The result is saved on:

- `RenderJob.result`
- `RoomPreviewSession.renderResult`

The result object includes:

- `imageUrl`
- `kind = composited_preview`
- `jobId`
- `generatedAt`
- `modelName`

### Current Limitations

- Rendering is synchronous inside the HTTP request, not queued.
- The prompt is specific to flooring/parquet use cases.
- There is no product catalog metadata beyond file-derived mock products.
- Floor geometry data exists for demo rooms but is not used by the Gemini prompt pipeline.
- If Redis is missing, device cooldown is skipped.
- If cleanup is not scheduled, expired sessions remain active until manually/cron-marked expired.

## 10. Security & Reliability

### Implemented Protections

- HMAC-SHA256 session tokens for Room Preview mutation APIs.
- Timing-safe session token verification.
- Session tokens sent in `x-session-token` for mutations.
- Screen token stored in HttpOnly, SameSite Strict cookie.
- Admin session cookie is HttpOnly, SameSite Strict, HMAC-signed, and expires after 8 hours.
- Admin credentials are compared with SHA-256 hashes and `timingSafeEqual`.
- Admin redirects are restricted to `/admin` paths.
- Gate form validation with Zod.
- Product request validation with Zod.
- Response shape validation on the client.
- Upload size limit of 10 MB.
- Upload MIME allowlist: JPEG, PNG, WebP.
- Magic-byte validation against declared MIME type.
- Image dimension and aspect-ratio validation with `sharp`.
- Public asset path traversal protection.
- Session creation rate limit: 10 sessions per IP per 60 seconds in the route handler.
- Proxy-level API rate limits:
  - `/render`: 5/minute.
  - `/room`: 20/minute.
  - `/sessions`: 15/minute.
  - General `/api`: 300/minute.
- Render lock with Redis `SET NX EX` when Redis is available.
- Atomic render count limit in PostgreSQL.
- Maximum 2 renders per session.
- 5-minute device cooldown after render when Redis is available.
- SSE keepalive and reconnect settings.
- Polling fallback when SSE fails.
- Screen auto-reset on idle, result, failed, and error states.
- Startup environment validation.
- Sentry integration when configured.
- Pino structured logging.
- Health endpoint.

### Security Headers

Security headers are configured in both `next.config.ts` and `proxy.ts`.

Implemented headers include:

- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy`
- Production-only HSTS in `next.config.ts`
- `X-Request-Id` in `proxy.ts`

### Reliability Caveats

- `middleware.ts` and `proxy.ts` both exist. Next.js 16 documentation says Middleware is now called Proxy; the project uses both files for different concerns. This should be reviewed for deployment behavior.
- Proxy rate limiting is process-local and not shared across instances.
- Redis-backed limits and locks are optional; without Redis, some protections degrade.
- Rendering is synchronous and can tie up request execution for up to 5 minutes.
- Local storage is not production-safe for serverless or multi-instance deployments.

## 11. Admin / Operations

The admin layer is available under `/admin`.

### Authentication

Admins log in through `/admin/login` using `ADMIN_USERNAME` and `ADMIN_PASSWORD`. On success, the app sets an `admin_session` cookie signed with `ADMIN_JWT_SECRET`.

### Dashboard

`/admin` shows:

- Active sessions.
- Currently rendering sessions.
- Failed render jobs in the last hour.
- Renders completed today.
- Average render time today.
- Session monitor for active and recent sessions.
- Render jobs feed for the last 50 jobs.

Session actions:

- Force expire.
- Reset session to `waiting_for_mobile`, clearing room/product/result state and extending expiry.

### Analytics

`/admin/analytics` shows:

- Sessions in the last 7 days vs previous 7 days.
- Render counts and success rate.
- Failed renders.
- Sessions per day for 14 days.
- Render completions/failures per day.
- Average render time.
- Activity by hour.
- Visitor totals.
- Customer vs employee counts.
- Render conversion based on `render_completed` events.
- Visitor log with role, contact/employee code, event count, linked session status, and render count.

Current limitation:

- A conversion funnel chart is explicitly shown as "coming soon".

## 12. Technical Stack

- Framework: Next.js 16.2.1 App Router.
- Runtime: Node.js for server APIs; Edge-compatible Web Crypto used for admin token verification.
- Frontend: React 19.2.4, TypeScript, Tailwind CSS 4, lucide-react.
- Panorama: `@photo-sphere-viewer/core` and `@photo-sphere-viewer/markers-plugin`.
- QR: `qrcode`.
- Database: PostgreSQL.
- ORM: Prisma 7.6.0 with `@prisma/adapter-pg`.
- Storage: Local filesystem or S3-compatible R2/S3 through AWS SDK.
- Redis: `ioredis` for optional Pub/Sub, locks, cooldowns, and rate limits.
- AI: Google Gemini through `@google/genai`; OpenAI dependency is installed but active provider is Gemini.
- Image processing: `sharp`.
- Validation: Zod and custom type guards.
- Logging: Pino with `pino-pretty` in development.
- Monitoring: Sentry Next.js SDK.
- Testing: Vitest, Playwright.
- Styling/assets: Next Image, static assets under `public`.

## 13. Folder / Codebase Structure

### `app/`

Next.js App Router routes.

- `app/page.tsx`: product selector homepage.
- `app/layout.tsx`: root layout, fonts, i18n provider.
- `app/room-preview/page.tsx`: Room Preview landing.
- `app/room-preview/screen/page.tsx`: screen session launcher.
- `app/room-preview/screen/[sessionId]/page.tsx`: QR/screen display.
- `app/room-preview/mobile/[sessionId]/page.tsx`: gated mobile session.
- `app/room-preview/gate/[sessionId]/*`: visitor pre-access gate.
- `app/panorama/page.tsx`: Panorama Studio.
- `app/api/*`: route handlers.
- `app/(admin)/admin/*`: admin pages, login, actions, analytics.

### `components/`

Reusable UI.

- `components/room-preview/*`: screen launcher, screen session client, mobile session client, QR code, state panels.
- `components/panorama/*`: viewer, tour selector, controls, hotspot editor, media panel, floating dock.
- `LanguageSwitcher`, `SplashScreen`, `FeatureEntryCard`, `GlassBackground`: shared UI.

### `lib/room-preview/`

Room Preview business logic.

- `session-machine.ts`: lifecycle transitions and validation.
- `session-service.ts`: session orchestration.
- `session-repository.ts`: Prisma persistence.
- `session-client.ts`: browser fetch client and response validation.
- `session-events.ts`: Redis/in-memory event bus.
- `session-events-client.ts`: browser EventSource wrapper.
- `session-polling.ts`: polling fallback.
- `session-token.ts`: HMAC token generation/verification.
- `api-guard.ts`: mutation token authorization.
- `upload-service.ts`: server upload validation/storage.
- `room-service.ts`: client room save helper.
- `product-service.ts`: client product save helper.
- `render-service.ts`: render pipeline orchestration.
- `render-repository.ts`: render job persistence.
- `render-rate-limit.ts`: render lock and cooldown.
- `render-providers/*`: Gemini provider and unused OpenAI mock provider.
- `prompts.ts`: AI prompt construction.

### `lib/admin/`

Admin auth and query logic.

- `auth.ts`: admin token signing/verification.
- `queries.ts`: dashboard metrics, session list, render job feed.
- `analytics-queries.ts`: session/render analytics.
- `user-analytics-queries.ts`: visitor analytics.

### `lib/analytics/`

Visitor and event tracking.

- `validators.ts`: gate form schema.
- `user-session-service.ts`: gate user/session binding.
- `event-tracker.ts`: fire-and-forget event writes.

### `lib/panorama/`

Panorama types, constants, and helpers.

### `data/`

Static data sources.

- `data/tours.ts`: predefined panorama tours.
- `data/room-preview/demo-rooms.ts`: local demo room discovery and floor metadata.
- `data/room-preview/mock-products.ts`: local mock product discovery.

### `prisma/`

Database schema and migrations.

### `public/`

Static files:

- Panorama images.
- Test room images.
- Test product images.
- Uploaded room images.
- Render output images.
- Logo and fallback render image.

### `tests/`

- Unit tests for validators, tokens, and state machine.
- Integration tests for APIs.
- Playwright e2e tests for Room Preview flow and health checks.

## 14. Current Implementation Status

### Fully Implemented

- Database-backed Room Preview sessions.
- QR session creation and mobile handoff.
- HMAC token protection for session mutations.
- Gate-based visitor identification.
- Room upload/demo selection.
- Product selection from local mock assets.
- Gemini render pipeline with retries and output validation.
- Real-time screen update path with polling fallback.
- Admin dashboard and analytics.
- Logging, health checks, and optional Sentry.

### Partially Implemented

- Product scanning/catalog: API supports barcode, but UI scan/code entry is simulated and mock products have null barcodes.
- Session expiry: `expiresAt` exists, but sessions become expired only when cleanup runs or admin forces expiry.
- Redis scaling: implemented as optional; without Redis, real-time updates and rate limits are single-process best-effort.
- Panorama Studio editing: interactive drafting exists, but edits are not saved to the data source.
- OpenAI rendering: provider file exists but returns a mock image and is not active.

### Placeholder / Demo Only

- `public/test-assets/products` product catalog.
- `public/test-assets/rooms` demo room gallery.
- `/rs/rs.png` fallback image in mobile result UI if no render result image is present.
- Admin analytics conversion funnel placeholder.

### Production-Ready Areas

- Clear session state machine.
- Structured API validation and error responses.
- Upload safety checks.
- Render job persistence.
- Admin authentication.
- Health checks.
- Sentry/Pino observability wiring.

### Risky Or Incomplete Areas

- Synchronous long-running AI rendering in API request.
- Local filesystem storage default.
- Optional Redis means several protections degrade in production without configuration.
- Product data is not a real catalog.
- Cleanup must be scheduled externally.
- Some tests appear behind the current gate/manual-connect flow, especially e2e expectations that mobile access automatically connects.
- `middleware.ts` and `proxy.ts` coexist even though Next.js 16 documentation identifies Proxy as the Middleware replacement.

## 15. Known Gaps / Observations

- The project needs documentation for deployment topology: single server vs serverless vs horizontally scaled runtime.
- Redis should be treated as required for production-grade SSE, locks, and cooldown behavior.
- Storage should be switched to R2/S3 for production.
- The product model should move from file-derived mocks to a managed product catalog with real barcode values.
- The mobile scan/code UI should be replaced with real barcode scanning or actual catalog lookup.
- The cleanup route comment and implementation disagree: the comment mentions query-string secret support, but code only checks the `x-cleanup-secret` header.
- Session expiry should either be enforced during session reads or the cleanup cron schedule should be documented and required.
- The Panorama Studio editor needs a persistence model if it is intended to be more than a draft/export tool.
- The active AI provider selection is hardcoded to Gemini despite the installed OpenAI dependency and mock OpenAI provider.
- Several Arabic strings appear mojibake-encoded in source output, suggesting encoding should be reviewed in the repository.
- The e2e tests should be updated to reflect the current gate step and explicit "I'm connected" button.
- The admin dashboard provides useful operations visibility but does not expose detailed render errors or per-event journey drilldowns in the UI.
- The render pipeline logs `FLOOR_NOT_VISIBLE` but still accepts the image; business behavior for unusable floor images should be clarified.
