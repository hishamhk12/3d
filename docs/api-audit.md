# API Communication Audit

## Executive Summary

تم فحص استدعاءات API في المشروع من ملفات `app/api`, `components`, `features`, `lib`, و Server Actions. لا يوجد `axios` في المشروع؛ الاتصال يتم عبر `fetch`, `EventSource`, و Server Actions الخاصة بـ Next.

الحكم المختصر: المشكلة الأساسية ليست من DB وحدها. أكبر سبب محتمل للتعليق والبطء هو تداخل ثلاث طبقات: render pipeline طويلة تعمل داخل `after()` لنفس request runtime، polling متكرر أثناء الرندر والـ upload recovery، وطلبات duplicate ناتجة عن نمط "POST ثم GET للتحقق" في اختيار الغرفة/المنتج. يوجد Redis Pub/Sub/SSE، لكنه ليس كاملا لكل العملاء؛ الشاشة تستفيد من SSE، أما الموبايل ما زال يعتمد على polling لمعرفة نتيجة الرندر.

أهم الملاحظات:

- الشاشة: تستخدم `EventSource` إلى `/events` ثم fallback polling كل 2s عند فشل SSE. هذا جيد كفكرة، لكن بدون Redis في production يصبح SSE in-memory فقط ولا يعمل عبر multi-instance.
- الموبايل: بعد بدء الرندر يستخدم `pollForRenderResult` كل 2.5s حتى 310s، وهذا يضرب GET session كثيرا أثناء أطول عملية في النظام.
- اختيار الغرفة والمنتج: كل POST ناجح يتبعه GET إضافي من العميل للتحقق، وفوق ذلك endpoint الغرفة يعمل DB verification داخلي. هذا يسبب over-fetching واضح.
- render: endpoint يرجع 202 بسرعة ظاهريا، لكنه يشغل `executeRenderPipeline(sessionId)` داخل `after()`. هذا أفضل من `setTimeout` في serverless، لكنه ليس background job حقيقي؛ ما زال مربوطا بعمر invocation و `maxDuration = 300`.
- التشخيص: جيد أنه fire-and-forget من العميل ويستخدم `sendBeacon`، لكن `/diagnostics` لا يزال يفحص session validity من DB كل 30s لكل session ويكتب event عبر `after()`.
- refresh: توجد حماية في `ScreenLauncherClient` و `MobileLauncherClient` لإعادة استخدام session محفوظة، لذلك refresh لا ينشئ session جديدة دائما. الخطر المتبقي في تعدد tabs/dev Strict Mode/تعطل localStorage.

## API Map

Client-side wrappers:

- `requestRoomPreviewJson` في `lib/room-preview/session-client.ts`: wrapper لكل JSON fetch مع timeout عبر `AbortController` + `Promise.race`.
- `createRoomPreviewSession`: `POST /api/room-preview/sessions`.
- `fetchRoomPreviewSession`: `GET /api/room-preview/sessions/[sessionId]`.
- `connectRoomPreviewSession`: `POST /api/room-preview/sessions/[sessionId]/connect`.
- `createRenderForSession`: `POST /api/room-preview/sessions/[sessionId]/render`.
- `saveRoomPreviewSessionRoom`: `POST /api/room-preview/sessions/[sessionId]/room` ثم `GET /session`.
- `saveRoomPreviewSessionProduct`: `POST /api/room-preview/sessions/[sessionId]/product` ثم `GET /session`.
- `createRoomPreviewSessionEventsClient`: `EventSource /api/room-preview/sessions/[sessionId]/events`.
- `trackClientSessionEvent`: `sendBeacon` أو `fetch keepalive` إلى `/diagnostics`.

Route handlers:

- Room preview: sessions, session GET, connect, room upload, product, render, test-render, events SSE, diagnostics, activate, screen-token, cleanup, dev-entry.
- Admin/API: health, admin screens CRUD.
- Server Actions: admin cleanup/reset/expire, admin login/logout, gate submit, locale cookie.

## Endpoints Table

| Endpoint path | Method | Caller file | Caller function | Caller type | Trigger | Returns | DB? | Upload? | sessionId? | Repeats often? | Timeout / retry / abort | Rate limit | Logging | Lag risk |
|---|---:|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/api/room-preview/sessions` | POST | `components/room-preview/ScreenLauncherClient.tsx`, `components/room-preview/MobileLauncherClient.tsx` | `createRoomPreviewSession` | Screen / Mobile | mount, retry | `{...session, token}` 201 | Yes: create session; optional screen lookup; session event | No | No path sessionId | Medium: refresh/mount can repeat; localStorage lock mitigates screen | 8s client timeout | IP create limit 10/min; active sessions/IP 5 when Redis enabled | `console.info`, pino, session event | Medium: DB + Redis; duplicate creates if storage unavailable |
| `/api/room-preview/sessions/[sessionId]` | GET | `lib/room-preview/session-client.ts`, used by `useScreenSession`, `useMobileSession`, launchers, polling, room/product services | `fetchRoomPreviewSession`, `createRoomPreviewSessionPoller`, `pollForRenderResult` | Screen / Mobile / Server-like client services | mount, validation, polling, upload recovery, post-save verification | `RoomPreviewSession` or 404/410 | Yes: `getSessionById` | No | Yes | High: render polling 2.5s, screen fallback 2s, upload recovery 1.5s | 8s timeout via wrapper | No | pino errors only | High: hot DB read endpoint |
| `/api/room-preview/sessions/[sessionId]/connect` | POST | `features/room-preview/mobile/useMobileSession.ts` | `connectRoomPreviewSession`, `handleConnect`, auto-connect in load effect | Mobile | mount auto-connect; manual click fallback | `RoomPreviewSession` | Yes: read + update session; analytics after | No | Yes | Low/Medium: auto-connect on every fresh mobile mount until connected | 8s timeout | No endpoint limit; guarded by session token | pino + analytics via `after()` | Medium: can duplicate with reloads, but state machine blocks locked states |
| `/api/room-preview/sessions/[sessionId]/activate?t=TOKEN` | GET | QR link in `app/room-preview/screen/[sessionId]/page.tsx`; redirects from `MobileLauncherClient` | browser navigation | Mobile | QR open / launcher redirect | 302 to mobile or gate; sets `rp-mobile-token`; locale cookie | Yes: session event in `after()` only | No | Yes | Medium: every QR scan/open | No fetch timeout; browser navigation | Token verification only | pino + `trackSessionEvent` | Low: no session read, only event write |
| `/api/room-preview/sessions/[sessionId]/activate` | POST | `app/room-preview/activate/[sessionId]/_components/ActivationHandler.tsx` | `activate` | Mobile legacy | mount of old activation page | `{ok:true}`; sets mobile token | Yes: session event in `after()` only | No | Yes | Low: legacy only | No AbortController; normal browser fetch | Token verification only | pino + `trackSessionEvent` | Low |
| `/api/room-preview/sessions/[sessionId]/room` | POST | `lib/room-preview/room-service.ts`, called by `features/room-preview/mobile/useMobileSession.ts` | `saveRoomPreviewSessionRoom`, `handleFileSelection` | Mobile | file select/upload or demo room save | `{success:true, room}` then client fetches full session | Yes: session read/update, verification read, diagnostics/issues, analytics after | Yes for camera/gallery; no for demo | Yes | Medium: user can retry; upload timeout recovery polls GET every 1.5s | Upload timeout 90-120s; recovery window 60s; no true upload abort passed | No rate limit; max 10MB only | pino, diagnostics, analytics | High: formData parse + sharp + storage + DB + extra GET |
| `/api/room-preview/sessions/[sessionId]/product` | POST | `lib/room-preview/product-service.ts`, called by `useMobileSession.ts` | `saveRoomPreviewSessionProduct`, `handleProductSelect` | Mobile | product select after 700ms debounce | `{success:true, product}` then client fetches full session | Yes: read/update session + diagnostics | No | Yes | Medium: carousel/product browsing can cause repeated saves, debounce mitigates | 8s timeout | No | pino + diagnostics | Medium: POST + extra GET per selected product |
| `/api/room-preview/sessions/[sessionId]/render` | POST | `lib/room-preview/session-client.ts`, called by `useMobileSession.ts` | `createRenderForSession`, `handleCreateRender` | Mobile | click/start render | `RoomPreviewSession` 202 or cached session 200 | Yes: many reads/writes; render jobs; events; analytics; screen budget | No direct upload; external AI image generation | Yes | Low from UI due in-flight ref; dangerous if network retries/new tab | Client trigger timeout 15s; Gemini calls have retries/timeouts; pipeline up to 300s | Redis lock/device cooldown; session max 2; screen cooldown/budget | pino, diagnostics, analytics | Very High: render pipeline is long and external-provider bound |
| `/api/room-preview/sessions/[sessionId]/test-render` | POST | UNKNOWN direct client caller not found | UNKNOWN | Server/Admin/Dev UNKNOWN | UNKNOWN/manual test | session 202 | Yes: select product, start render, render job pipeline | No | Yes | Low/UNKNOWN | No wrapper known | guardSession only; no explicit render cooldown in this route | diagnostics | High if exposed/used; bypasses normal render rate logic |
| `/api/room-preview/sessions/[sessionId]/events` | GET SSE | `lib/room-preview/session-events-client.ts`, used by `useScreenSession.ts` | `createRoomPreviewSessionEventsClient` | Screen | after initial screen session load | `text/event-stream`; initial session + updates + keepalive | Yes: initial `getRoomPreviewSession`; Redis subscribe if enabled | No | Yes | One long connection per screen tab; reconnect every 3s on disconnect | Browser EventSource retry 3s; no client abort API except `close()` cleanup | Session token only; no rate limit | pino, Redis logs | Medium: good for screen; bad if Redis missing in multi-instance |
| `/api/room-preview/sessions/[sessionId]/diagnostics` | POST | `lib/room-preview/session-diagnostics-client.ts`, used by mobile/screen diagnostics | `trackClientSessionEvent` | Mobile / Screen | lifecycle, errors, status changes, taps, polling warnings | `{ok:true}` or ignored | Yes: validity check cached 30s; event write via `after()` | No | Yes | High but throttled client 5s and server 30/min/session | Uses `sendBeacon` or `fetch keepalive`; no awaited retry | In-memory server rate limit + dedupe | pino + session events | Medium: mostly non-blocking, still DB pressure under many sessions |
| `/api/room-preview/sessions/[sessionId]/screen-token` | POST | UNKNOWN; no caller found in search | UNKNOWN | Screen/Admin UNKNOWN | Comment says after session create, but current `ScreenLauncherClient` does not call it | `{ok:true}`; sets `rp-screen-token` | No DB; token verify only | No | Yes | Low/UNKNOWN | UNKNOWN | Token verification only | pino warn | Low; likely dead/legacy endpoint |
| `/api/room-preview/cleanup` | GET | UNKNOWN external cron/manual; tests exist | cron/manual | Server | scheduled cleanup | cleanup counts | Yes: stuck detection + cleanup updates | No | No | Depends cron frequency | No request timeout in code | Shared secret if `CLEANUP_SECRET` set; skipped in local if unset | pino | Medium: runs several DB operations in parallel |
| `/api/room-preview/dev-entry` | GET | `app/room-preview/screen/[sessionId]/page.tsx` dev link | browser navigation | Dev Mobile | click dev link | 302 mobile page; sets mobile token | Yes only if no `sessionId`: creates session | No | Optional | Low/dev only | Browser navigation | Disabled in production | pino | Low in dev; not production |
| `/api/health` | GET | UNKNOWN API caller; admin `HealthBar` uses DB directly, not this endpoint | UNKNOWN | Server/Admin/Monitor | health probe | `{status, checks, ts}` | Yes: `SELECT 1`; Redis ping if enabled | No | No | Depends monitor frequency | No | No | None | Low/Medium if probed aggressively |
| `/api/admin/screens` | GET | UNKNOWN client caller not found | UNKNOWN | Admin/API | list screens | screen list | Yes: `prisma.screen.findMany` | No | No | UNKNOWN | No | Admin cookie auth | pino on error | Low |
| `/api/admin/screens` | POST | UNKNOWN client caller not found | UNKNOWN | Admin/API | create screen | created screen + one-time token | Yes: create `screen` | No | No | Low/UNKNOWN | No | Admin cookie auth | pino on error | Low |
| `/api/admin/screens/[screenId]` | PATCH | UNKNOWN client caller not found | UNKNOWN | Admin/API | update screen | updated screen | Yes: update `screen` | No | No sessionId; yes screenId | Low/UNKNOWN | No | Admin cookie auth | pino on error | Low |
| `/api/admin/screens/[screenId]` | DELETE | UNKNOWN client caller not found | UNKNOWN | Admin/API | delete screen | 204 | Yes: delete `screen` | No | No sessionId; yes screenId | Low/UNKNOWN | No | Admin cookie auth | pino on error | Low |
| Server Action: `submitGateForm` | POST internal Next action | `app/room-preview/gate/[sessionId]/_components/gate-form.tsx` | `submitGateForm` | Mobile | form submit | redirect mobile/gate | Yes: gate check, create/bind user session, analytics after | No | Yes via form field | User double-submit risk; guarded by `sessionHasCompletedGate` | Next action transport; no custom timeout | Token cookie; dev bypass allowed | analytics | Medium: DB write then redirect race mitigated by `gate_ok` cookie |
| Server Action: admin cleanup/reset/expire | POST internal Next action | admin components | `triggerCleanup`, `forceExpireSession`, `forceResetSession`, `markStuckRenderJobsAsFailedAction` | Admin | form submit/button | revalidated admin UI | Yes | No | Yes for session actions | Low | Next action transport | Admin cookie auth | diagnostics | Medium for cleanup |
| Server Action: `loginAction` / `logoutAction` | POST internal Next action | `app/(admin)/admin/login/page.tsx`, admin header | `loginAction`, `logoutAction` | Admin | login/logout form | redirect, cookie set/delete | Redis/in-memory rate limit; no DB for credentials | No | No | Low | Next action transport | Login IP limit 5/min | none/pino via limiter | Low |
| Server Action: `setLocaleCookie` | POST internal Next action | `lib/i18n/provider.tsx` | `setLocaleCookie` | Client UI | locale mismatch/change | `{ok}`; cookie | No | No | No | Low | fire-and-forget on mismatch; awaited only by Next internals | No | none | Low; `router.refresh()` on manual locale change can remount app |

## Session Flow

1. Screen launcher opens `app/room-preview/screen/page.tsx` and mounts `ScreenLauncherClient`.
2. `ScreenLauncherClient.validateStoredScreenSession()` calls `GET /api/room-preview/sessions/[storedId]` if a localStorage session exists.
3. If reusable, screen navigates to `/room-preview/screen/[sessionId]`.
4. If not reusable, it creates a session via `POST /api/room-preview/sessions`.
5. `app/api/room-preview/sessions/route.ts` creates DB session through `createRoomPreviewSession`, generates HMAC token, returns token, and sets `rp-screen-token`.
6. Screen page SSR generates QR using `/api/room-preview/sessions/[sessionId]/activate?t=<token>&lang=<locale>`.
7. Screen client loads current session with `GET /sessions/[sessionId]`.
8. Screen client opens SSE with `GET /sessions/[sessionId]/events`.
9. Mobile scans QR; activate route verifies token, sets `rp-mobile-token`, redirects to `/room-preview/mobile/[sessionId]`.
10. Mobile page checks gate completion. If missing, redirects to `/room-preview/gate/[sessionId]`.
11. Gate form Server Action creates/binds `UserSession`, sets short `gate_ok_[sessionId]`, redirects back to mobile.
12. Mobile client loads session via GET and auto-connects via `POST /connect` if `mobileConnected` is false.
13. Session update is persisted and published via Redis/in-memory event bus; screen receives update through SSE or fallback polling.

## Mobile Flow

1. `MobileLauncherClient` optionally reuses localStorage session; otherwise `POST /sessions`, then navigates to `/activate?t=token`.
2. `MobileSessionPage` verifies gate completion server-side via `sessionHasCompletedGate`.
3. `useMobileSession` initial mount:
   - calls `GET /sessions/[sessionId]`;
   - if not connected, calls `POST /connect`;
   - sends diagnostics through `/diagnostics`.
4. Upload room:
   - `handleFileSelection` compresses image client-side;
   - calls `POST /room` with `FormData`;
   - server validates size, MIME magic bytes, dimensions via `sharp`, uploads to local/R2/S3, updates session;
   - client then calls `GET /sessions/[sessionId]` again inside `saveRoomPreviewSessionRoom`.
5. Select product:
   - `handleProductSelect` debounces 700ms;
   - calls `POST /product`;
   - client then calls `GET /sessions/[sessionId]` again inside `saveRoomPreviewSessionProduct`.
6. Start render:
   - `handleCreateRender` calls `POST /render`;
   - then `pollForRenderResult` calls `GET /sessions/[sessionId]` every 2.5s until `result_ready` or `failed`.

## Screen Flow

1. `ScreenLauncherClient` prevents duplicate session creation using a ref lock plus localStorage lock.
2. Screen page SSR builds QR and tracks `qr_displayed`.
3. `useScreenSession` initial effect calls `GET /sessions/[sessionId]`.
4. If ready, it opens `EventSource /events`.
5. `/events` sends initial `session_updated`, subscribes to Redis or in-memory bus, and emits keepalive every 15s.
6. If SSE errors, screen sets `isUsingPollingFallback=true`.
7. Polling fallback calls `GET /sessions/[sessionId]` every 2s.
8. Terminal states trigger screen auto-reset:
   - `result_ready`: redirect to screen launcher after 60s.
   - `failed`: after 15s.
   - no mobile connected: after 5min.
   - error states: after 10s.

## Render Flow

1. Mobile click calls `POST /api/room-preview/sessions/[sessionId]/render`.
2. Route verifies session token via `guardSession`.
3. It writes diagnostics event `render_requested`.
4. It attempts Redis render lock if Redis enabled.
5. It loads session and screen fields in parallel.
6. It checks dedupe hash; if same room/product and result exists, returns cached session.
7. It checks device cooldown, session render count, screen cooldown, and screen daily budget.
8. It transitions session to `ready_to_render`.
9. It touches screen `lastRenderAt` and saves render hash.
10. It schedules analytics and `executeRenderPipeline(sessionId)` in `after()`.
11. Pipeline atomically claims `ready_to_render -> rendering` via DB `updateMany`.
12. Pipeline creates render job, marks processing, acquires Gemini semaphore, calls Gemini provider with retries/timeouts, stores result, marks session `result_ready`, publishes SSE event.
13. On failure it marks render job failed, marks session failed, opens diagnostics issue, rolls back render count.
14. Mobile polling and screen SSE/polling discover `result_ready` or `failed`.

## Diagnostics Flow

1. Client calls `trackClientSessionEvent`.
2. Client throttle suppresses repeated low-value events for 5s, except important lifecycle/action events.
3. Transport uses `navigator.sendBeacon` when available; fallback is `fetch` with `keepalive: true`.
4. `/diagnostics` applies in-memory rate limit: 30 events/session/min.
5. It dedupes same `eventType` for 5s.
6. It validates session existence/status, cached for 30s.
7. It writes `SessionEvent` and opens issue via `after()`.
8. Diagnostics failures are intentionally non-blocking for customer flow.

## Performance Issues

- P1: Hot GET session endpoint. `GET /sessions/[sessionId]` is used for initial loads, screen fallback polling, mobile render polling, upload recovery, and post-save verification.
- P1: Mobile render tracking is polling-only. During a 5-minute render, one mobile tab can issue about 124 GET requests at 2.5s interval.
- P1: POST room/product causes extra GET. `saveRoomPreviewSessionRoom` and `saveRoomPreviewSessionProduct` both POST then fetch full session even though the server already knows the updated session.
- P1: Room upload endpoint does heavy work in request path: formData parse, full buffer read, magic byte validation, `sharp` metadata, storage upload, session update, session verification, diagnostics.
- P1: Render pipeline is not a true background job. `after()` keeps work in request/runtime lifecycle with `maxDuration=300`; this can still tie capacity to active web invocations.
- P2: Screen fallback polling at 2s is acceptable for a single screen but becomes DB-heavy if SSE fails for many screens.
- P2: Admin `AutoRefresh` calls `router.refresh()` every 15s and re-runs server component DB queries. This is admin-only, but can add DB load during incidents.
- P2: Diagnostics are throttled but high-cardinality lifecycle events can still create DB writes across many devices.

## Root Causes of Lag

1. Render delay: external Gemini provider + image fetch/resize + semaphore + DB job writes. This is expected to be the slowest path.
2. Session state propagation delay: screen is real-time only if SSE and Redis/in-memory bus work. Without Redis across instances, updates may not reach the screen and it falls back to polling or stays stale.
3. Mobile perceived lag: after render starts, mobile waits on repeated GET polling, not push events.
4. Upload lag: upload endpoint blocks on image validation and storage. Client timeout is intentionally high (90-120s), so a bad network can feel like a hang.
5. Over-fetching: product/room POST returns partial data, then client fetches full session again.
6. DB pressure: the same session row is repeatedly read by screen, mobile, diagnostics validity, and render pipeline.

## Polling vs SSE

Current architecture:

- Screen: SSE first, polling fallback.
- Mobile: polling for render result.
- Server event bus: Redis Pub/Sub when configured, otherwise process-local memory.

Technical opinion:

- Polling is acceptable only as fallback or for low-frequency admin refresh.
- Screen should keep SSE because one-way session updates fit SSE perfectly.
- Mobile render tracking should also use SSE or share the same `/events` stream. This would remove most render-time GET polling.
- WebSockets are not required unless the mobile must send high-frequency bidirectional messages. Current domain is mostly server-to-client updates, so SSE is simpler.
- Redis Pub/Sub is required for production multi-instance. Without Redis, SSE is not reliable across instances.

## DB Impact

High-impact DB paths:

- `GET /sessions/[sessionId]`: one `findUnique` per request. Becomes hot under polling.
- `POST /room`: read/update/read verification plus diagnostics/issues/events.
- `POST /product`: read/update plus diagnostics; client adds a GET.
- `POST /render`: multiple session/screen queries, conditional raw update for render count, screen budget queries/fallback count, render job creates/updates, session transitions, diagnostics.
- `/diagnostics`: cached validity read every 30s per session plus event inserts.
- cleanup/admin: batch updates and counts, acceptable if scheduled sanely.

DB is probably a contributor to lag under concurrent sessions, but not the only root. The render provider and polling design likely dominate user-visible delay.

## Race Conditions

- Duplicate session creation: mitigated in `ScreenLauncherClient` by ref + localStorage lock and reusable stored session. Still possible across separate browsers/devices or storage failure.
- Mobile auto-connect vs manual connect: `handleConnect` and initial auto-connect can both target `/connect`, but UI state and server state machine reduce risk.
- Product debounce vs render click: render button can run while a product save is pending. `handleCreateRender` checks `isSavingProduct`, but React state timing means a rapid product click then render click could race before `isSavingProduct` flips.
- Upload timeout recovery: if client times out but server completes, client polls GET for 60s to detect uploaded room. This is intentional but adds DB load and can create confusing "failed then recovered" timing.
- Render duplicate: UI has `renderRequestInFlightRef`; server has Redis lock and DB `tryClaimRenderingSlot`. Good. But `/test-render` bypasses normal render rate limit path.
- SSE multi-listener: Redis subscription ref-counting is implemented, which fixes the common unsubscribe race for multiple streams on same session.
- Diagnostics cache: session validity cached 30s means an event may be accepted briefly after expiry, or rejected briefly after transient lookup failure. Low severity.

## Security Notes

- Mutation endpoints `/connect`, `/room`, `/product`, `/render`, `/test-render` use `guardSession` with HMAC token from header or `rp-mobile-token`.
- `/events` accepts `rp-screen-token` cookie or `x-session-token`, necessary because EventSource cannot send custom headers.
- `/activate` GET places token in query string from QR. It immediately stores HttpOnly cookie and redirects. This is pragmatic, but query tokens can appear in access logs.
- `/diagnostics` does not use session token; it relies on sessionId, validation, throttling, and low sensitivity. This is acceptable for diagnostics, but it can be spammed per valid sessionId within rate limits.
- `/cleanup` is protected only if `CLEANUP_SECRET` is set. In local dev it may be open by design.
- Admin screen APIs require admin cookie.
- `dev-entry` is disabled outside development.
- Upload endpoint validates content-length, MIME allowlist, magic bytes, image dimensions, and max 10MB. Good baseline.

## Risk Matrix

| Severity | Problem | Cause | Impact | Affected files | Fix |
|---|---|---|---|---|---|
| P0 | SSE unreliable in production without Redis | `session-events.ts` falls back to in-memory bus | Screen may not receive updates across instances; appears stuck | `lib/room-preview/session-events.ts`, `/events` route | Require Redis in production and fail health/deploy if missing |
| P0 | Render is not a durable background job | `executeRenderPipeline` runs in `after()` of API route | Long AI renders tied to web runtime; failures on timeout/cold/runtime limits | `app/api/room-preview/sessions/[sessionId]/render/route.ts`, `lib/room-preview/render-service.ts` | Move render to durable queue/worker; API only enqueues |
| P1 | Excessive session GET polling during render | Mobile uses `pollForRenderResult` every 2.5s | DB pressure and delayed result perception | `lib/room-preview/session-polling.ts`, `features/room-preview/mobile/useMobileSession.ts` | Use SSE for mobile render updates; keep polling fallback |
| P1 | POST room/product over-fetch | Client POST returns partial data then calls GET | Extra latency and DB reads after every selection | `lib/room-preview/room-service.ts`, `lib/room-preview/product-service.ts`, room/product routes | Return full updated session from POST endpoints |
| P1 | Upload endpoint can feel hung | Heavy image validation/storage inside request, 90-120s timeout | Mobile waits a long time on weak network or cold dev compile | `app/api/.../room/route.ts`, `lib/room-preview/upload-service.ts` | Add staged upload/progress or pre-signed direct upload; keep server validation async |
| P1 | `/test-render` bypasses normal rate limits | Separate route starts render without render lock/cooldown/budget | Manual/dev endpoint can consume render quota or duplicate work | `app/api/room-preview/sessions/[sessionId]/test-render/route.ts` | Restrict to dev/admin or reuse render rate-limit path |
| P1 | Product save vs render race | Debounced product save and render click can overlap | Render may start with previous product or fail invalid state | `features/room-preview/mobile/useMobileSession.ts` | Flush/cancel pending debounce before render; await product save |
| P2 | Screen fallback polling every 2s | SSE error switches to polling | DB load if Redis/SSE unstable | `features/room-preview/screen/useScreenSession.ts` | Exponential backoff or stale-state UI; restore SSE retry |
| P2 | Diagnostics DB pressure | Many client events, validity checks, event inserts | Adds noise during incidents | `session-diagnostics-client.ts`, diagnostics route | Batch low-value diagnostics or sample in production |
| P2 | Session creation duplicate edge cases | localStorage/ref lock only per browser | Multi-tab/browser can create parallel sessions | `ScreenLauncherClient.tsx`, sessions route | Server-side screen active-session reuse keyed by screenId |
| P2 | Admin auto-refresh DB load | `router.refresh()` every 15s | Re-runs server component queries | `app/(admin)/admin/_components/auto-refresh.tsx` | Keep or increase interval; add explicit refresh under load |

## Fix Plan

Quick fixes بدون كسر النظام:

- اجعل `/room` و `/product` يرجعان `session` كاملة مع `room/product`، ثم احذف GET الإضافي من `room-service.ts` و `product-service.ts`.
- أضف SSE للموبايل باستخدام `createRoomPreviewSessionEventsClient` أثناء الرندر، مع إبقاء `pollForRenderResult` كـ fallback فقط.
- قيّد `/test-render` إلى development أو admin فقط.
- قبل `handleCreateRender`، إذا يوجد `productDebounceRef.current` نفذ حفظ المنتج أو امنع الرندر حتى ينتهي debounce.
- وثق أن `REDIS_URL` مطلوب للإنتاج، واجعل `/api/health` يعيد degraded إذا Redis غير موجود في production.

تحسين متوسط:

- استبدل polling fallback الثابت بـ backoff: 2s أول 30s، ثم 5s، ثم 10s مع زر retry.
- اجعل diagnostics low-value events sampled أو batched.
- أضف server-side reusable active screen session by `screenId` بدل الاعتماد على localStorage فقط.
- اجعل upload على مرحلتين: direct object storage upload ثم endpoint خفيف لحفظ `imageUrl` والتحقق async.

Production architecture:

- Render يجب أن يكون background job حقيقي: queue مثل BullMQ/Cloud Tasks/SQS + worker مستقل.
- API `/render` يعمل enqueue ويعيد `jobId/session`.
- Worker يملك Gemini semaphore، retry policy، job timeout، وdead-letter handling.
- Redis مطلوب لـ Pub/Sub, locks, cooldowns, budgets. PostgreSQL يبقى source of truth.
- SSE stream واحد للموبايل والشاشة لحالة session، مع polling كـ fallback فقط.

أشياء لا يجب تغييرها الآن:

- لا تستبدل SSE بـ WebSockets الآن؛ الاستخدام one-way ومعظم الرسائل server-to-client.
- لا تلغ session state machine؛ هي تحمي من transitions خاطئة.
- لا تلغ diagnostics بالكامل؛ فقط خففها أو اجعلها sampling.
- لا تلغ upload validation؛ هي مهمة أمنيا وجودة للرندر.
- لا تعتمد على in-memory locks في production؛ الموجود كـ fallback فقط.

## Final Technical Opinion

المشكلة الأساسية في النظام هي: render/session communication ما زالت نصف real-time ونصف polling، والرندر الطويل مربوط بالـ API runtime بدل background worker مستقل. DB يتأثر لأنه يصبح قناة polling عامة لحالة session، خصوصا أثناء الرندر وبعد upload/product saves.

الأولوية العملية:

1. Redis إلزامي في production حتى تكون SSE موثوقة.
2. الموبايل يجب أن يستمع لنفس session events بدل polling أثناء الرندر.
3. أزل POST ثم GET في room/product.
4. انقل render إلى queue/worker عند التحضير للإنتاج الجاد.

بهذه التغييرات ستعرف بوضوح أن التأخير المتبقي من AI render provider نفسه، وليس من duplication أو session polling أو DB pressure.
