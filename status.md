# Room Preview — Session Lifecycle Audit

> **Date:** 2026-05-03  
> **Auditor:** AI code review (claude-sonnet-4-6)  
> **Scope:** `lib/room-preview/`, `app/api/room-preview/`, `features/room-preview/`, `app/room-preview/`, `prisma/schema.prisma`  
> **Instruction:** Inspect only. No code changes.

---

## Executive Summary

The session lifecycle is well-structured. A formal state machine (`session-machine.ts`) enforces all transitions with strict guards. An event log (`SessionEvent`) and issue tracker (`SessionIssue`) capture server-side milestones. A cron-style cleanup endpoint handles expiry, stuck render recovery, and session completion.

The main gaps are on the **client-presence** side: neither mobile nor screen sends any "still alive" signal to the server. There is no heartbeat, no visibility-change tracking, and no `lastMobileSeenAt` / `lastScreenSeenAt` field. This makes it impossible to distinguish "customer abandoned" from "customer is slow" without waiting for the cleanup threshold. Duplicate-tab protection, browser lifecycle hooks, and an admin dashboard are also absent.

---

## 1. Core Session States

| State | DB Value | Terminal? | Notes |
|---|---|---|---|
| Created | `created` | No | Written by `createSession()` when no `initialState` override; rarely reached in normal flow |
| Waiting for mobile | `waiting_for_mobile` | No | QR displayed on screen; expires idle after **1 min** via cleanup |
| Mobile connected | `mobile_connected` | No | QR scanned → `/activate` → `/connect` API |
| Room selected | `room_selected` | No | S3 presigned upload + confirm-upload confirmed |
| Product selected | `product_selected` | No | PATCH `/product` API |
| Ready to render | `ready_to_render` | No | Locked — no new room/product accepted; render triggered |
| Rendering | `rendering` | No | Locked — atomic DB claim via `tryClaimRenderingSlot` |
| Result ready | `result_ready` | No | Locked — screen shows result; advances to `completed` after 90 s |
| Completed | `completed` | **Yes** | Terminal success; set by cleanup after 90 s display window |
| Failed | `failed` | No | Retriable — allows re-upload or re-render |
| Expired | `expired` | **Yes** | Time-based expiry; set by cleanup |

**Locked states** (defined in `isLockedStatus`): `ready_to_render`, `rendering`, `result_ready`, `completed`, `expired`.

---

## 2. State Machine Transitions

| From | To | Guard / Trigger | File |
|---|---|---|---|
| `created` | `waiting_for_mobile` | `createRoomPreviewSessionState()` | `session-machine.ts` |
| `created` / `waiting_for_mobile` | `mobile_connected` | QR scanned + `/connect` API | `session-machine.ts:connectMobileTransition` |
| `mobile_connected` / `room_selected` / `failed` | `room_selected` | `mobileConnected === true` + valid room | `session-machine.ts:selectRoomTransition` |
| `room_selected` / `product_selected` / `failed` | `product_selected` | room image present + valid product | `session-machine.ts:selectProductTransition` |
| `product_selected` / `failed` | `ready_to_render` | both room + product present | `session-machine.ts:markReadyToRenderTransition` |
| `ready_to_render` | `rendering` | atomic `UPDATE … WHERE status = 'ready_to_render'` | `session-repository.ts:tryClaimRenderingSlot` |
| `rendering` | `result_ready` | render provider returns image | `session-machine.ts:completeRenderingTransition` |
| `ready_to_render` / `rendering` | `failed` | render error or 7-min timeout | `session-machine.ts:failRenderingTransition` |
| `result_ready` | `completed` | cleanup job after 90 s | `session-cleanup.ts:completeResultReadySessions` |
| any live | `expired` | past `expiresAt` (default 60 min) | `session-cleanup.ts:expireOldSessions` |
| `waiting_for_mobile` | `expired` | idle > 1 min | `session-cleanup.ts:expireIdleWaitingSessions` |

**Note:** `completeResultReadySessions` transitions `result_ready → completed` but does **not** call `trackSessionEvent`. This is the only transition missing an event record.

---

## 3. QR & Mobile Connection Events

| Event | Covered | Where tracked |
|---|---|---|
| QR code displayed on screen | Partial | No explicit `qr_displayed` event; only `qr_opened` is tracked |
| QR link opened on mobile | ✅ | `trackSessionEvent({ eventType: "qr_opened" })` in activate route |
| Mobile gate passed | Partial | `gate_ok_{sessionId}` cookie set; no `gate_completed` server event |
| Mobile page loaded | ✅ | `trackSessionEvent({ eventType: "mobile_page_loaded" })` in mobile SSR page |
| Mobile connected to session | ✅ | `mobile_connected` status transition tracked via `session_status_changed` |
| Mobile reconnected (refresh) | ❌ | Refresh re-fetches session state but no `mobile_reconnected` event |

---

## 4. Mobile Lifecycle Events

| Event | Covered | Where |
|---|---|---|
| Mobile page hydration complete | ❌ | `MOBILE_HYDRATION_STUCK` issue type exists but no corresponding success event |
| Mobile tab backgrounded | ❌ | No `visibilitychange` handler; no `mobile_backgrounded` event |
| Mobile tab closed / unloaded | ❌ | No `beforeunload` / `pagehide` handler |
| Mobile polling started | ❌ | Not tracked |
| Mobile excessive polling detected | ✅ | `MOBILE_EXCESSIVE_POLLING` issue opened by diagnostics API |
| Mobile rapid reload detected | ✅ | `MOBILE_RAPID_RELOAD` issue opened by diagnostics API |
| Mobile UI blocked / unresponsive | ✅ | `MOBILE_UI_BLOCKED` issue type (user-visible) |

---

## 5. Screen Lifecycle Events

| Event | Covered | Where |
|---|---|---|
| Screen page loaded | ❌ | No `screen_page_loaded` event |
| Screen SSE connected | ❌ | SSE stream opens but no event is logged to DB |
| Screen SSE disconnected | ❌ | `close()` handler runs but no DB event |
| Screen fell back to polling | Partial | `SCREEN_NOT_UPDATING` issue type exists; no code opens it automatically |
| Screen idle reset triggered | ❌ | Client-side `SCREEN_IDLE_RESET_MS` (5 min) fires but no server event |
| Screen result reset triggered | ❌ | Client-side `SCREEN_RESULT_RESET_MS` (60 s) fires but no server event |

---

## 6. Room Upload Events

| Event | Covered | Where |
|---|---|---|
| Upload URL requested | Partial | Handled by `/upload-url` route; no explicit event logged |
| Upload started | ✅ | `room_upload_started` event tracked in upload route |
| Upload completed | ✅ | `room_upload_completed` event + room confirmed in session |
| Upload failed (client error) | ✅ | `room_upload_failed` event; `ROOM_UPLOAD_FAILED` issue opened |
| Upload stuck > 90 s | ✅ | `ROOM_UPLOAD_STUCK` detected by `detectStuckSessions` |
| Image too large | ✅ | `IMAGE_TOO_LARGE` issue; user-visible with `retake_room_photo` message |
| Image invalid format | ✅ | `IMAGE_INVALID` issue |
| Image quality insufficient | ✅ | `IMAGE_QUALITY_INSUFFICIENT` issue |
| Floor not visible | ✅ | `FLOOR_NOT_VISIBLE` issue |

---

## 7. Product Selection Events

| Event | Covered | Where |
|---|---|---|
| Product selected | ✅ | `product_selected` event tracked in product API route; status transition |
| Product changed (re-select) | Partial | New selection overwrites old; no `product_deselected` or `product_changed` event distinguishing a re-select from first select |

---

## 8. Render Lifecycle Events

| Event | Covered | Where |
|---|---|---|
| Render requested by user | ✅ | `render_requested` event; `POST /render` API |
| Render pipeline started | ✅ | `render_started` event in `render-service.ts` |
| Render job created (processing) | ✅ | `render_job_processing` event with `renderJobId` |
| Gemini semaphore acquired | Partial | Semaphore acquired/released but not logged as events |
| Render capacity exceeded | ❌ | Thrown as error, caught by pipeline failure path, not a distinct event type |
| Render completed | ✅ | `render_completed` event with `modelName`; `RENDER_FAILED` + `RENDER_TIMEOUT` issues auto-resolved |
| Render failed (provider error) | ✅ | `render_failed` event; `RENDER_FAILED` issue opened |
| Render timed out > 7 min | ✅ | `render_timeout` event; `RENDER_TIMEOUT` issue opened by cleanup |
| Render count limit reached | Partial | `tryIncrementRenderCount` enforces a per-session max, but no `render_limit_reached` event; limit value not exposed via env |
| Analytics event (render_completed) | ✅ | `trackEvent` via `after()` post-response hook |
| CustomerExperience saved | Partial | Fire-and-forget `after()` call; failure logged as warning but no success event |

---

## 9. Result & Completion Events

| Event | Covered | Where |
|---|---|---|
| Result displayed on screen | ❌ | Screen transitions to result view client-side; no server event |
| Result viewed duration | ❌ | No timing tracked |
| Session completed | ❌ | `completed` status set by cleanup but no `session_completed` event (only transition; see §2 note) |
| Customer experience saved | Partial | Persisted in `CustomerExperience` table; no explicit event |

---

## 10. Session Expiry & Cleanup

| Scenario | Covered | Threshold | Where |
|---|---|---|---|
| Idle `waiting_for_mobile` expired | ✅ | 1 min | `expireIdleWaitingSessions`; `SESSION_STUCK` issue opened |
| `rendering` / `ready_to_render` stuck | ✅ | 7 min | `failStuckRenderingSessions`; `RENDER_TIMEOUT` issue opened |
| `result_ready` → `completed` | ✅ | 90 s | `completeResultReadySessions` |
| Past `expiresAt` (all live states) | ✅ | 60 min default | `expireOldSessions` |
| Cleanup triggered | Manual | — | `GET /api/room-preview/cleanup` (CLEANUP_SECRET protected) |
| Cleanup scheduling | ❌ | — | No cron job configured; must be called externally (e.g., Vercel Cron) |

---

## 11. Back / Refresh / Recovery Flows

| Scenario | Covered | Notes |
|---|---|---|
| Mobile refreshes mid-upload | ✅ | `UPLOAD_RECOVERY_WINDOW_MS` (60 s) polling window after client abort |
| Mobile refreshes after room selected | ✅ | Session re-fetched from DB; room preserved in `selectedRoom` JSON |
| Mobile refreshes during render | ✅ | Session shows `rendering` status; mobile polls until complete |
| Screen refreshes mid-render | ✅ | Screen re-subscribes to SSE; receives current session state on connect |
| Mobile accesses expired session | Partial | Returns 404/expired status; no UX guidance to start a new session |
| Failed render retry | ✅ | `failed` → allows new room upload or new render trigger |
| Render count limit hit | Partial | Error returned by API; no explicit retry guidance in UI |

---

## 12. Duplicate Tab / Device Protection

| Scenario | Covered | Notes |
|---|---|---|
| Two screens open same session | ❌ | No `activeMobileInstanceId` or screen token uniqueness check beyond JWT |
| Two phones scan same QR | ❌ | Second `connectMobileTransition` would be blocked by locked status only after `mobile_connected`, but two concurrent requests during `waiting_for_mobile` could both succeed |
| Phone opens two tabs | ❌ | Both tabs operate independently; no tab coordination |
| Screen Single Active Session Mode | Partial | `findActiveLiveSessions()` exists for "single active screen" detection but enforcement depends on the screen client reading it |

---

## 13. Real-time Sync

| Feature | Covered | Notes |
|---|---|---|
| Server → Screen (SSE) | ✅ | `/events` route; Redis pub/sub; token auth via `rp-screen-token` cookie |
| Server → Mobile (polling) | ✅ | Mobile polls `GET /sessions/[id]`; 2.5 s interval |
| SSE keepalive heartbeat | ✅ | `: keepalive` comment every 15 s |
| SSE reconnect retry | ✅ | `retry: 3000` sent on connect |
| Redis failure fallback | ✅ | SSE stream closed on Redis error → browser falls back to EventSource reconnect → triggers polling path |
| Session update broadcast | ✅ | All state transitions call `publishRoomPreviewSessionEvent` |
| Mobile heartbeat to server | ❌ | No "I'm still connected" ping from mobile → server cannot detect silent mobile drop |
| Screen heartbeat to server | ❌ | Same gap on screen side |

---

## 14. Server / API Errors

| Error | Covered | Notes |
|---|---|---|
| Session not found (404) | ✅ | All API routes return `SESSION_NOT_FOUND` |
| Unauthorized token | ✅ | JWT verification in all protected routes |
| Render capacity exceeded (semaphore) | Partial | Error thrown and caught; no structured `RENDER_CAPACITY_EXCEEDED` issue type |
| S3 upload failure | ✅ | `ROOM_UPLOAD_FAILED` issue opened |
| AI provider timeout | ✅ | `RENDER_TIMEOUT` / `RENDER_FAILED` issues |
| DB write failure in `trackSessionEvent` | Partial | Swallowed with `log.warn` — deliberate to avoid cascading failures |
| Cleanup API secret mismatch | ✅ | `timingSafeEqual` check; returns 401 |
| Invalid session status in DB | ✅ | `toStatus()` throws for unexpected values |

---

## 15. Admin Tracking

### Events Written to `SessionEvent`

| eventType | Source | When |
|---|---|---|
| `qr_opened` | mobile | QR link activated |
| `mobile_page_loaded` | mobile | Mobile SSR page served |
| `session_status_changed` | renderer / server | Any status transition |
| `room_upload_started` | mobile | Upload begins |
| `room_upload_completed` | mobile | Upload confirmed |
| `room_upload_failed` | mobile | Upload error |
| `product_selected` | mobile | Product PATCH succeeds |
| `render_requested` | mobile | Render POST received |
| `render_started` | renderer | Pipeline begins |
| `render_job_processing` | renderer | Job marked processing |
| `render_completed` | renderer | AI returns result |
| `render_failed` | renderer | Pipeline error |
| `render_timeout` | server | Cleanup detects stuck render |
| `session_expired` | server | Cleanup expires session |
| `session_issue_opened` | server | Issue upserted |
| `session_issue_resolved` | server | Issue closed |
| `mobile_page_loaded` | mobile | (duplicate of above — same key, different call site) |

### Issues Written to `SessionIssue`

17 types tracked in `issue-catalog.ts`. User-visible issues (with `customerMessageKey`):

| Issue | Severity | Message Key |
|---|---|---|
| MOBILE_UI_BLOCKED | error | reload_page |
| MOBILE_HYDRATION_STUCK | error | reload_page |
| QR_OPENED_NO_MOBILE_CONNECT | warning | reconnect_mobile |
| MOBILE_OPENED_NO_PROGRESS | warning | reload_page |
| ROOM_UPLOAD_FAILED | error | retry_upload |
| ROOM_UPLOAD_STUCK | error | retry_upload |
| IMAGE_TOO_LARGE | warning | retake_room_photo |
| IMAGE_INVALID | warning | retake_room_photo |
| IMAGE_QUALITY_INSUFFICIENT | warning | retake_room_photo |
| FLOOR_NOT_VISIBLE | warning | retake_room_photo |
| RENDER_TIMEOUT | error | retry_render |
| RENDER_FAILED | error | retry_render |
| NETWORK_INTERRUPTED | warning | reload_page |

Admin-only (not user-visible): `MOBILE_RAPID_RELOAD`, `MOBILE_EXCESSIVE_POLLING`, `SCREEN_NOT_UPDATING`, `SESSION_STUCK`.

---

## Identified Gaps (Prioritized)

### P0 — Correctness / Silent Failures

| # | Gap | Risk |
|---|---|---|
| P0-1 | `result_ready → completed` transition in cleanup has no `trackSessionEvent` call | Completed sessions have no event record; admin timeline ends at `render_completed` |
| P0-2 | Two concurrent mobile connections during `waiting_for_mobile` are not atomically guarded (same TOCTOU race as the render slot, now fixed for render but not for connect) | Two phones can claim the same session simultaneously |
| P0-3 | No cron configured for `/api/room-preview/cleanup` | Stuck sessions and expired sessions never self-recover without external trigger |

### P1 — Observability Gaps

| # | Gap | Risk |
|---|---|---|
| P1-1 | No `lastMobileSeenAt` / `lastScreenSeenAt` DB fields | Cannot distinguish "client abandoned" from "client active but slow" |
| P1-2 | No heartbeat endpoint (mobile or screen) | `SESSION_STUCK` detection relies on update timestamp gaps, not actual client presence |
| P1-3 | `gate_completed` event not tracked | No server record of how many sessions passed through the gate |
| P1-4 | No `screen_connected` / `screen_disconnected` event | Cannot audit screen uptime |
| P1-5 | `SCREEN_NOT_UPDATING` issue type exists but no code path opens it | Dead issue type — will never fire |
| P1-6 | No `render_capacity_exceeded` structured issue type | Capacity errors surface only in logs |

### P2 — UX / Edge Cases

| # | Gap | Risk |
|---|---|---|
| P2-1 | No duplicate tab / duplicate phone protection | Two phones on same session produce conflicting room/product uploads |
| P2-2 | No browser lifecycle hooks (`visibilitychange`, `pagehide`) | Cannot detect phone going to background during upload or render |
| P2-3 | `product_changed` not distinguished from `product_selected` | Cannot tell from events how many times customer changed their mind |
| P2-4 | `CustomerExperience` save failures are only logged as warnings; no structured issue | Silent data loss in customer history without admin visibility |
| P2-5 | Render count max (`maxCount` in `tryIncrementRenderCount`) not exposed as env var or constant | Limit behavior is opaque; not documented anywhere |

---

## DB Changes Needed

| Change | Priority | Reason |
|---|---|---|
| Add `lastMobileSeenAt DateTime?` to `RoomPreviewSession` | P1 | Enable presence detection |
| Add `lastScreenSeenAt DateTime?` to `RoomPreviewSession` | P1 | Enable screen health monitoring |
| Add `session_completed` event in `completeResultReadySessions` | P0 | Close the event timeline |
| Add `RENDER_CAPACITY_EXCEEDED` to `SESSION_ISSUE_CATALOG` | P1 | Structured capacity tracking |

---

## API Changes Needed

| Change | Priority | Reason |
|---|---|---|
| `POST /sessions/[id]/heartbeat` — update `lastMobileSeenAt` | P1 | Client presence signal |
| Atomic guard in `/connect` route (conditional UPDATE like `tryClaimRenderingSlot`) | P0 | Prevent double-connect race |
| Configure Vercel Cron or equivalent to call `/api/room-preview/cleanup` | P0 | Sessions won't self-expire otherwise |

---

## Frontend Changes Needed

| Change | Priority | Reason |
|---|---|---|
| Add `visibilitychange` → pause/resume polling on mobile | P2 | Reduce ghost polls when phone is locked |
| Add `pagehide` event → flush pending actions before unload | P2 | Prevent silent abandonment during upload |
| Open `SCREEN_NOT_UPDATING` issue from screen client when SSE falls back to polling | P1 | Activate the existing issue type |

---

## Implementation Plan

### P0 (Correctness — do first)

1. **`session-cleanup.ts`** — add `trackSessionEvent({ eventType: "session_completed", … })` inside `completeResultReadySessions` for each transitioned session (same pattern as `expireOldSessions`).
2. **`/connect` route** — replace the current optimistic `connectMobileTransition` + `saveSessionState` with a single conditional `UPDATE … WHERE status IN ('created', 'waiting_for_mobile') SET status = 'mobile_connected'` (same pattern as `tryClaimRenderingSlot`), returning false if already claimed.
3. **Vercel Cron** — add `vercel.json` cron entry calling `/api/room-preview/cleanup` every 2 minutes.

### P1 (Observability — second pass)

4. Add `lastMobileSeenAt` and `lastScreenSeenAt` to `RoomPreviewSession` in `schema.prisma`; run `prisma db push`.
5. Add `POST /sessions/[id]/heartbeat` API route; mobile client pings it every 30 s.
6. Track `gate_completed` event in gate actions server action.
7. Track `screen_connected` in the SSE stream open handler; `screen_disconnected` in the close handler.
8. Wire `SCREEN_NOT_UPDATING` opening from screen client when `EventSource.onerror` fires and polling fallback activates.

### P2 (UX / Edge Cases — third pass)

9. Add `product_changed` event in the product API route when a session already has a `selectedProduct` (re-select).
10. Add `visibilitychange` + `pagehide` listeners in `MobileSessionClient`.
11. Document `renderCount` limit as `MAX_RENDERS_PER_SESSION` constant with env override.

---

## P0 Fixes Implemented

**Date:** 2026-05-03

### Files Changed

| File | Change |
|---|---|
| `lib/room-preview/session-cleanup.ts` | Added `findMany` + per-session `trackSessionEvent` in `completeResultReadySessions` |
| `lib/room-preview/session-repository.ts` | Added `tryClaimMobileConnection` (atomic conditional UPDATE) |
| `lib/room-preview/session-service.ts` | Rewrote `connectMobileToSession` to use atomic claim; removed unused `connectMobileTransition` import |
| `app/api/room-preview/cleanup/route.ts` | Replaced single-secret check with dual-auth (`x-cleanup-secret` OR `Authorization: Bearer CRON_SECRET`) |
| `vercel.json` | Changed cron schedule from `0 3 * * *` to `*/2 * * * *` |

---

### Fix 1 — `session_completed` Event

**File:** `lib/room-preview/session-cleanup.ts` → `completeResultReadySessions`

**What changed:** Added a `findMany` step before the `updateMany`. The `updateMany` now uses `id IN [fetched IDs] AND status = 'result_ready'` so sessions that transition between the two calls are not incorrectly tracked. After a successful update, `trackSessionEvent` is called for each session.

**Event written:**
```
eventType:  "session_completed"
source:     "server"
level:      "info"
statusBefore: "result_ready"
statusAfter:  "completed"
metadata:
  previousStatus: "result_ready"
  nextStatus:     "completed"
  reason:         "result_display_window_elapsed"
```

The 90-second completion window is unchanged.

---

### Fix 2 — Atomic Mobile Connect Guard

**Files:** `session-repository.ts`, `session-service.ts`

**New function in repository:**
```typescript
tryClaimMobileConnection(sessionId): Promise<boolean>
// UPDATE … WHERE id = sessionId AND status IN ('created', 'waiting_for_mobile')
// SET status = 'mobile_connected', mobileConnected = true
```

**New flow in `connectMobileToSession`:**
1. `getSessionById` — surface NOT_FOUND / EXPIRED before touching the DB
2. `tryClaimMobileConnection` — atomic UPDATE; only one concurrent caller wins
3. If `claimed = false` → re-read session status → throw `RoomPreviewSessionTransitionError`
4. If `claimed = true` → `getSessionById` again (fetch committed state) → publish SSE → track `session_status_changed` event → return

Two phones scanning the same QR code simultaneously will both reach step 2, but only one `updateMany` will return `count = 1`. The losing phone receives a 400 `SESSION_INVALID_STATE` response.

---

### Fix 3 — Vercel Cron + Dual Auth

**`vercel.json`** schedule changed to `*/2 * * * *` (every 2 minutes).

**Auth logic (`cleanup/route.ts`):**
- If neither `CLEANUP_SECRET` nor `CRON_SECRET` is set → open (local dev)
- If `CLEANUP_SECRET` is set → `x-cleanup-secret` header must match (manual/cURL calls)
- If `CRON_SECRET` is set → `Authorization: Bearer <token>` must match (Vercel Cron)
- Either path independently authorizes the request
- All comparisons use `timingSafeEqual` to prevent timing attacks

**Required Vercel Environment Variables:**

| Variable | Purpose | Set by |
|---|---|---|
| `CRON_SECRET` | Vercel automatically sends this as `Authorization: Bearer <CRON_SECRET>` with every cron request. Set this to a long random string. | Manual — add in Vercel Project → Settings → Environment Variables |
| `CLEANUP_SECRET` | For manual/external calls via `x-cleanup-secret` header. Can be the same value as `CRON_SECRET` or different. | Manual — same location |

> Vercel does **not** auto-populate `CRON_SECRET` — you must create it manually and set the same value in Vercel env vars. Vercel reads it and injects it into the `Authorization` header automatically when the cron fires.

---

### Local Verification

```bash
# 1. Verify TypeScript compiles clean
npx tsc --noEmit

# 2. Manually trigger cleanup (dev — no secret needed)
curl http://localhost:3000/api/room-preview/cleanup

# 3. Manually trigger cleanup (production — x-cleanup-secret)
curl -H "x-cleanup-secret: YOUR_CLEANUP_SECRET" https://your-domain.com/api/room-preview/cleanup

# 4. Simulate Vercel Cron call (production — Bearer token)
curl -H "Authorization: Bearer YOUR_CRON_SECRET" https://your-domain.com/api/room-preview/cleanup

# 5. Confirm session_completed events appear after a render completes
# Check DB: SELECT * FROM "SessionEvent" WHERE "eventType" = 'session_completed' ORDER BY timestamp DESC LIMIT 5;
```

### Deployment

```bash
# No schema changes — no prisma db push needed
git add lib/room-preview/session-cleanup.ts \
        lib/room-preview/session-repository.ts \
        lib/room-preview/session-service.ts \
        app/api/room-preview/cleanup/route.ts \
        vercel.json
git commit -m "P0: atomic mobile connect, session_completed event, cron every 2min"
# Then: set CRON_SECRET and CLEANUP_SECRET in Vercel Project → Settings → Environment Variables
# Then: git push / vercel deploy
```

---

## P1 Implemented — Observability and Presence

> **Date:** 2026-05-03

### Schema Changes

Added two nullable `DateTime` columns to `RoomPreviewSession`:

| Column | Purpose |
|---|---|
| `lastMobileSeenAt` | Updated on every mobile heartbeat ping |
| `lastScreenSeenAt` | Updated on every screen heartbeat ping |

**Migration path** (Supabase doesn't support shadow DB auto-creation):
1. Generated baseline from live DB: `prisma migrate diff --from-empty --to-config-datasource --script`
2. Generated delta SQL: `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
3. Applied delta with `prisma db execute`, recorded with `prisma migrate resolve --applied`
4. Legacy `db push` migration directories archived to `prisma/migrations_archive/`
5. Active migrations: `0000000000000_baseline` + `20260503134724_add_session_presence_fields`

### New Files

| File | Purpose |
|---|---|
| `app/api/room-preview/sessions/[sessionId]/heartbeat/route.ts` | `POST` — accepts mobile (`rp-mobile-token` / `x-session-token`) and screen (`rp-screen-token`) tokens; updates presence; emits events on first ping or reconnect after > 75 s gap |
| `features/room-preview/mobile/useMobileHeartbeat.ts` | React hook — pings `/heartbeat` every 30 s, stops on terminal status, returns `{ isConnected, failedCount, lastSuccessAt }` |
| `features/room-preview/screen/useScreenHeartbeat.ts` | Same as mobile hook, bound to screen token |

### Modified Files

| File | Change |
|---|---|
| `lib/room-preview/session-repository.ts` | Added `updateSessionPresence(sessionId, "mobile"\|"screen")` and `getSessionPresence(sessionId)` |
| `features/room-preview/mobile/useMobileSession.ts` | Integrated `useMobileHeartbeat`; exported `heartbeatConnected`, `heartbeatFailedCount`, `heartbeatLastSuccessAt` |
| `features/room-preview/screen/useScreenSession.ts` | Integrated `useScreenHeartbeat`; same fields added to return type |
| `app/room-preview/gate/[sessionId]/actions.ts` | Added `gate_completed` event after successful gate submission (metadata: `role`, `hasName`, `hasPhone`, `isExistingCustomer` — no PII) |
| `app/api/room-preview/sessions/[sessionId]/events/route.ts` | Tracks `screen_connected` on SSE open (with 5 s module-level cooldown to suppress reconnect spam) and `screen_disconnected` on stream close |

### Events Added

| Event | Source | Trigger |
|---|---|---|
| `gate_completed` | mobile | Gate form successfully submitted |
| `mobile_heartbeat_started` | server | First heartbeat from mobile client |
| `mobile_reconnected` | server | Mobile heartbeat after > 75 s gap |
| `screen_heartbeat_started` | server | First heartbeat from screen client |
| `screen_reconnected` | server | Screen heartbeat after > 75 s gap |
| `screen_connected` | server | SSE stream opened by screen (5 s cooldown) |
| `screen_disconnected` | server | SSE stream closed by screen |

### SCREEN_NOT_UPDATING — Already Wired (No Change Needed)

`useScreenSession` already calls `trackClientSessionEvent` with `code: "SCREEN_NOT_UPDATING"` when the SSE/polling error handler fires. The diagnostics route (`/api/room-preview/sessions/[sessionId]/diagnostics`) checks `isSessionIssueType(eventData.code)` and automatically calls `openSessionIssue` — so the issue is created in `SessionIssue` with no additional code needed.

### Verification

```sql
-- Confirm presence columns exist
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'RoomPreviewSession' AND column_name IN ('lastMobileSeenAt','lastScreenSeenAt');

-- Confirm heartbeat events are being written
SELECT "eventType", COUNT(*) FROM "session_events"
WHERE "eventType" IN ('mobile_heartbeat_started','screen_heartbeat_started','screen_connected','screen_disconnected','gate_completed')
GROUP BY "eventType" ORDER BY COUNT(*) DESC;
```

---

## P2 Implemented — UX and Edge Cases

> **Date:** 2026-05-03

### Files Changed

| File | Change |
|---|---|
| `app/api/room-preview/sessions/[sessionId]/product/route.ts` | `product_changed` vs `product_selected` logic; duplicate suppression |
| `components/room-preview/MobileSessionClient.tsx` | `useMobileBrowserLifecycle` hook — visibility + pagehide events |
| `app/api/room-preview/sessions/[sessionId]/render/route.ts` | `MAX_RENDERS_PER_SESSION` env override |

### 1. product_changed Behavior

Before calling `selectProductForSession`, the route now snapshots the current `selectedProduct`.

| Condition | Event fired |
|---|---|
| No previous product | `product_selected` (unchanged) |
| Previous product, new product is different | `product_changed` |
| Same product re-selected | No event (suppressed) |

Metadata: `newProductId`, `newSku` (barcode), `previousProductId`, `previousSku` (only when changing). No full product objects stored.

### 2. Mobile Browser Lifecycle Events

`useMobileBrowserLifecycle(sessionId)` hook added at the top of `MobileSessionClient`. Listeners:

| Listener | Condition | Event |
|---|---|---|
| `visibilitychange` | `visibilityState === "hidden"` | `mobile_page_hidden` |
| `visibilitychange` | `visibilityState === "visible"` | `mobile_page_visible` |
| `pagehide` | always | `mobile_pagehide` |

- Deduplication: tracks `lastVisibility` to suppress same-state re-fires.
- `mobile_pagehide` uses `navigator.sendBeacon` (Blob, `application/json`) → falls back to `fetch` with `keepalive: true` if sendBeacon is unavailable.
- Target: `/api/room-preview/sessions/[sessionId]/diagnostics` (no auth required, existing rate-limit + dedup guards apply).
- All failures are silently swallowed — never crashes UI or blocks navigation.

### 3. MAX_RENDERS_PER_SESSION

**Default:** `2` renders per session (unchanged behavior).

**Env override:** `MAX_RENDERS_PER_SESSION=N` (positive integer). Parsed with `parseInt`; falls back to `2` if missing, empty, or non-numeric.

Location: `app/api/room-preview/sessions/[sessionId]/render/route.ts` lines 46–47.

No `.env.example` file existed in this project — no update needed.

To change the limit in Vercel: set `MAX_RENDERS_PER_SESSION` in Project → Settings → Environment Variables, then redeploy.

### Remaining Gaps (Not Implemented in P2)

- **Duplicate tab protection** — intentionally deferred.
- **Browser Back guard** — intentionally deferred.
- **UI redesign** — intentionally deferred.
- **`mobile_pagehide` on older iOS** — `pagehide` is the correct event on iOS (Safari does not reliably fire `visibilitychange` on backgrounding); already handled.

---

## Lifecycle Coverage Audit — 2026-05-03

> Full audit of all 15 session lifecycle areas. Status: **Covered / Partial / Missing**. Priority applies to missing/partial items only.

Legend: ✅ Covered · ⚠️ Partial · ❌ Missing

---

### 1. Inactive Customer Handling

| Check | Status | Notes |
|---|---|---|
| `lastMobileSeenAt` exists | ✅ | `prisma/schema.prisma` — migrated in P1 |
| `lastScreenSeenAt` exists | ✅ | `prisma/schema.prisma` — migrated in P1 |
| Mobile heartbeat | ✅ | `features/room-preview/mobile/useMobileHeartbeat.ts` — 30 s interval |
| Screen heartbeat | ✅ | `features/room-preview/screen/useScreenHeartbeat.ts` — 30 s interval |
| Mobile stale/disconnected detection | ⚠️ | Heartbeat route emits `mobile_reconnected` after >75 s gap but no explicit `mobile_disconnected` event when heartbeat stops permanently |
| Screen stale/disconnected detection | ✅ | `useScreenSession` emits `screen_stale_detected`; heartbeat route emits `screen_reconnected` |
| Inactive warning UX | ❌ | No modal/banner shown to user when heartbeat fails; `heartbeatConnected` is exposed by hooks but nothing renders it |
| Inactive session expiration | ✅ | `expireIdleWaitingSessions()` in cleanup — expires `waiting_for_mobile` after 1 min; cleanup runs every 2 min |
| Expired Arabic UX message | ⚠️ | `MobileSessionClient` shows `expiredTitle`/`expiredDescription` from i18n dict; content is Arabic but generic (not specific to "idle too long") |

**Risk:** Customer leaves phone idle; session expires silently with no warning. No UX signal before expiry.
**Recommended fix (P2):** Wire `heartbeatConnected === false` in `MobileSessionClient` to show a simple Arabic inactivity banner ("الجلسة ستنتهي قريبًا، حرّك الشاشة للمتابعة"). Add `mobile_disconnected` event when heartbeat fails N consecutive times.

---

### 2. Browser Back Handling

| Check | Status | Notes |
|---|---|---|
| `popstate` listener | ❌ | No popstate listener in any mobile component or hook |
| `back_pressed` event tracked | ❌ | Not tracked |
| Server-approved next step | ❌ | No resume logic server-side |
| Resume endpoint | ❌ | No `/resume` route exists |
| Mobile route guard | ❌ | No explicit guard preventing old-step URL navigation |
| Invalid old step redirect | ❌ | Handled only implicitly by Next.js page guards |
| `redirected_to_correct_step` event | ❌ | Not tracked |

**Risk:** Customer hits Back → lands on a stale/disconnected page with no recovery path. Medium user-facing risk on mobile browsers.
**Recommended fix (P2):** Add a `popstate` listener in `useMobileSession` that calls `trackClientSessionEvent("back_pressed")` and navigates forward to the current step. No server resume endpoint needed if step is derived from session state.

---

### 3. Page Close / Background Handling

| Check | Status | Notes |
|---|---|---|
| `visibilitychange` listener | ✅ | `MobileSessionClient` + `useMobileDiagnostics` |
| `pagehide` listener | ✅ | `MobileSessionClient` — implemented in P2 |
| `beforeunload` handler | ❌ | Not implemented — intentionally omitted (blocks navigation on iOS) |
| `mobile_page_hidden` event | ✅ | Tracked via `trackClientSessionEvent` |
| `mobile_page_visible` event | ✅ | Tracked via `trackClientSessionEvent` |
| `mobile_pagehide` event | ✅ | Tracked via `sendBeacon` in P2 |
| `sendBeacon` used for pagehide | ✅ | With `fetch keepalive` fallback |

**Risk:** Low. `beforeunload` intentionally skipped — it blocks iOS navigation and offers no meaningful action here.

---

### 4. Duplicate Tab / Duplicate Device Protection

| Check | Status | Notes |
|---|---|---|
| `clientInstanceId` generated | ❌ | Not implemented |
| `clientInstanceId` in `sessionStorage` | ⚠️ | `useMobileDiagnostics` uses `sessionStorage` for rapid-reload detection only, not tab identity |
| `activeMobileInstanceId` server-side | ❌ | No DB column or Redis key |
| `duplicate_tab_detected` event | ❌ | Not tracked |
| Old tab disabled flow | ❌ | No UI for this |
| Duplicate tab Arabic UX | ❌ | Not applicable without detection |
| Two phones scanning same QR blocked atomically | ✅ | `tryClaimMobileConnection` — conditional `updateMany WHERE status IN (created, waiting_for_mobile)` is atomic |
| Two browser tabs same session | ❌ | Both tabs will operate normally; no detection or deduplication |

**Risk:** Two browser tabs on the same QR link will both function, potentially causing duplicate product/room saves. Two phones are blocked at the connect step. Tab-level duplication is a low-frequency edge case on a physical showroom device.
**Recommended fix (P3):** Generate a UUID in `sessionStorage` on mount; if a `BroadcastChannel` message from another tab arrives with the same `sessionId`, disable the older tab. No server changes needed.

---

### 5. Render Double-Click Protection

| Check | Status | Notes |
|---|---|---|
| `render_requested` idempotent | ✅ | Redis lock via `acquireRenderLock()` prevents concurrent duplicate renders |
| `tryClaimRenderingSlot` / atomic render lock | ✅ | `tryClaimRenderingSlot` + `acquireRenderLock` (Redis SET NX EX) |
| Duplicate render blocked | ✅ | Returns HTTP 429 "Render already in progress" |
| Existing job/result returned | ✅ | `lastRenderHash` check returns cached result for same room+product combo |
| `render_limit_reached` event | ❌ | 429 returned but no `SessionEvent` written |
| `render_capacity_exceeded` event | ❌ | Not tracked |

**Risk:** Low operational impact; missing events mean the admin timeline won't show how often users hit the render limit.
**Recommended fix (P2):** In the render route, after `tryIncrementRenderCount` returns `incremented: false`, call `trackSessionEvent({ eventType: "render_limit_reached", metadata: { currentCount } })` before returning 429.

---

### 6. Session Expires During Render

| Check | Status | Notes |
|---|---|---|
| Stuck rendering timeout | ✅ | `failStuckRenderingSessions()` — 7 min threshold |
| `render_timeout` event | ✅ | Tracked in `session-cleanup.ts` when status → failed |
| `RENDER_TIMEOUT` issue type | ✅ | `issue-catalog.ts` — severity "error", userVisible true |
| Behavior defined for expiry-during-render | ✅ | Cleanup moves session to "failed"; frontend polls and shows error state |
| Expired result not shown incorrectly | ⚠️ | `isEffectivelyExpired()` guards render start; no post-render guard prevents showing a result from a now-expired session if cleanup runs between render completion and client poll |
| Render cleanup/recovery documented | ✅ | `render-job-cleanup.ts` marks stuck jobs as failed; polling recovers |

**Risk:** Very narrow race: render completes → session expires before client polls → client shows result briefly, then cleanup marks session completed. Acceptable in practice.

---

### 7. Session Guards in API Endpoints

| Check | Status | Notes |
|---|---|---|
| Session existence check — render | ✅ | `getSessionById()` → 404 |
| Expired/completed check — render | ✅ | `isEffectivelyExpired()` |
| Transition guard — render | ✅ | `markReadyToRenderTransition()` |
| Mobile token auth — render | ✅ | `guardSession()` |
| Screen token auth — SSE events | ✅ | `verifySessionToken()` via cookie or header |
| Upload route — `guardSession` | ✅ | Both `/room` and `/room/upload-url` |
| Product route — `guardSession` | ✅ | |
| Room route — `guardSession` | ✅ | |
| Locked state protection | ✅ | State machine transitions reject invalid status changes |

**Risk:** None. All mutation endpoints are guarded.

---

### 8. Result and Completion Tracking

| Check | Status | Notes |
|---|---|---|
| `result_ready` status transition | ✅ | Session machine + cleanup |
| `result_displayed_screen` event | ❌ | No event when screen renders the result image |
| `result_seen_mobile` event | ❌ | No event when mobile views the result |
| `session_completed` event | ✅ | `session-cleanup.ts` — fires when result_ready → completed after 90 s |
| Result viewed duration tracked | ❌ | Intentionally skipped; 90 s window is the only measure |
| Result cleanup/completion timing | ✅ | `completeResultReadySessions(90_000)` default; `SCREEN_RESULT_RESET_MS = 60_000` for screen auto-reset |

**Risk:** Low. Admin cannot tell if customer actually saw the result vs. session auto-completing. No impact on correctness.
**Recommended fix (P2):** Track `result_displayed_screen` in `ScreenSessionClient` when `hasRenderResult` becomes true; track `result_seen_mobile` in `ResultStep` on mount.

---

### 9. Screen Lifecycle

| Check | Status | Notes |
|---|---|---|
| `screen_connected` event | ✅ | SSE events route — 5 s cooldown to suppress reconnect spam |
| `screen_disconnected` event | ✅ | SSE events route — fires on stream close |
| Screen heartbeat | ✅ | `useScreenHeartbeat` — 30 s |
| SSE connected event to client | ✅ | `: connected` comment + `session_updated` on stream open |
| SSE fallback to polling | ✅ | `useScreenSession` — 2 s polling when SSE fails |
| `SCREEN_NOT_UPDATING` issue auto-opened | ✅ | `useScreenSession` emits `screen_stale_detected` with `code: "SCREEN_NOT_UPDATING"` → diagnostics route auto-opens issue |
| Screen stale detection | ✅ | Both client-side (SSE error) and server-side (heartbeat gap) |

**Risk:** None. Screen lifecycle is fully covered.

---

### 10. Mobile Lifecycle

| Check | Status | Notes |
|---|---|---|
| `mobile_page_loaded` event | ✅ | `app/room-preview/mobile/[sessionId]/page.tsx` — server-side on page render |
| `gate_completed` event | ✅ | `gate/[sessionId]/actions.ts` — implemented in P1; metadata: role, hasName, hasPhone, isExistingCustomer |
| Mobile heartbeat | ✅ | `useMobileHeartbeat` — 30 s |
| `mobile_reconnected` event | ✅ | Heartbeat route — fires after >75 s gap |
| `mobile_disconnected` / `mobile_stale` event | ❌ | No explicit event when heartbeat stops; only `mobile_reconnected` on re-connect |
| `MOBILE_RAPID_RELOAD` issue | ✅ | `issue-catalog.ts` — severity "warning" |
| `MOBILE_EXCESSIVE_POLLING` issue | ✅ | `issue-catalog.ts` — severity "warning" |

**Risk:** When a customer's phone dies or loses signal, there is no `mobile_disconnected` event in the timeline — admin sees a gap, not an explicit signal.
**Recommended fix (P2):** In the heartbeat hook, after N consecutive failures (e.g. 3), call `trackClientSessionEvent("mobile_disconnected")` once.

---

### 11. Product Selection Edge Cases

| Check | Status | Notes |
|---|---|---|
| `product_selected` event | ✅ | First product selection |
| `product_changed` event | ✅ | Switching to a different product — implemented in P2 |
| Same product re-select suppressed | ✅ | `isSameProduct` guard — implemented in P2 |
| Metadata is safe and minimal | ✅ | `newProductId`, `newSku`, `previousProductId`, `previousSku` only |

**Risk:** None.

---

### 12. Upload Edge Cases

| Check | Status | Notes |
|---|---|---|
| `room_upload_url_requested` event | ✅ | `/room/upload-url` route |
| `room_upload_started` event | ✅ | `/room` route |
| `room_upload_completed` event | ✅ | Client-side via `trackClientSessionEvent` (unthrottled) |
| `room_upload_failed` event | ✅ | `/room` route + client diagnostics |
| Upload stuck detection | ✅ | `stuck-detection.ts` — `room_upload_started` without completion >90 s → `ROOM_UPLOAD_STUCK` issue |
| `IMAGE_TOO_LARGE` issue | ✅ | `issue-catalog.ts` |
| `IMAGE_INVALID` issue | ✅ | `issue-catalog.ts` |
| `IMAGE_QUALITY_INSUFFICIENT` issue | ✅ | `issue-catalog.ts` |
| `FLOOR_NOT_VISIBLE` issue | ✅ | `issue-catalog.ts` |

**Risk:** None. Upload lifecycle is comprehensively covered.

---

### 13. Cleanup and Cron

| Check | Status | Notes |
|---|---|---|
| Cleanup endpoint | ✅ | `GET /api/room-preview/cleanup` |
| Cleanup endpoint protected | ✅ | `x-cleanup-secret` header or `Authorization: Bearer CRON_SECRET` |
| Vercel cron configured | ✅ | `vercel.json` |
| Cron frequency | ✅ | Every 2 minutes (`*/2 * * * *`) |
| `expireIdleWaitingSessions` | ✅ | Expires `waiting_for_mobile` after 1 min idle |
| `failStuckRenderingSessions` | ✅ | Fails `rendering`/`ready_to_render` after 7 min |
| `completeResultReadySessions` | ✅ | Completes `result_ready` after 90 s display window |
| `expireOldSessions` | ✅ | Expires sessions past `expiresAt` |

**Risk:** None. Cleanup is complete and protected.

---

### 14. Admin Observability

| Check | Status | Notes |
|---|---|---|
| `SessionEvent` table | ✅ | Full schema with indexes on sessionId/timestamp, eventType, level, source |
| `SessionIssue` table | ✅ | severity, userVisible, customerMessageKey, dedupeKey, count |
| `lastMobileSeenAt` admin-visible | ✅ | Stored in DB; visible in diagnostics panel |
| `lastScreenSeenAt` admin-visible | ✅ | Stored in DB; visible in diagnostics panel |
| Admin diagnostics panel | ✅ | `app/(admin)/admin/diagnostics/[sessionId]/page.tsx` |
| Issue catalog with severity/userVisible | ✅ | All 15+ issue types defined with full metadata |
| `detectStuckSessions` | ✅ | `stuck-detection.ts` — runs every cleanup cycle |

**Risk:** None. Admin observability is well-built.

---

### 15. Friendly UX States

| Check | Status | Notes |
|---|---|---|
| Expired session screen (Arabic) | ⚠️ | Shown via `MobileSessionClient`; text is in i18n dict (Arabic confirmed) but generic — not specific to "idle timeout" vs "link expired" |
| Duplicate tab screen (Arabic) | ❌ | Not applicable — duplicate tab detection not implemented |
| Inactive warning modal | ❌ | No component rendered when `heartbeatConnected === false` |
| Reconnecting message | ⚠️ | `heartbeatConnected` state exposed from hooks but nothing renders a "reconnecting" banner |
| Render taking longer message | ⚠️ | `RetryAfterDelay` in `MobileSessionClient` shows after 10 s loading; not specific to render phase |
| Recovered session toast | ❌ | No toast on reconnect or session recovery |
| Safe Arabic messages | ✅ | User-facing error strings are in i18n dict; no codes or stack traces exposed |

**Risk:** Users experience silent failure states — heartbeat stops, nothing shown; session expires, generic message shown.
**Recommended fix (P2):** Wire `heartbeatConnected` to a dismissable Arabic banner in `MobileSessionClient`. Add a short "جاري إعادة الاتصال..." indicator when `heartbeatFailedCount > 0`.

---

## Coverage Summary

| Area | Covered | Partial | Missing |
|---|---|---|---|
| 1. Inactive customer | 4 | 3 | 2 |
| 2. Browser Back | 0 | 0 | 7 |
| 3. Page close/background | 6 | 0 | 1 |
| 4. Duplicate tab/device | 1 | 1 | 6 |
| 5. Render double-click | 4 | 0 | 2 |
| 6. Render expiry | 4 | 1 | 1 |
| 7. Session guards | 9 | 0 | 0 |
| 8. Result tracking | 3 | 0 | 3 |
| 9. Screen lifecycle | 7 | 0 | 0 |
| 10. Mobile lifecycle | 5 | 0 | 2 |
| 11. Product selection | 4 | 0 | 0 |
| 12. Upload | 9 | 0 | 0 |
| 13. Cleanup/cron | 8 | 0 | 0 |
| 14. Admin observability | 7 | 0 | 0 |
| 15. Friendly UX | 1 | 3 | 3 |
| **TOTAL** | **72** | **8** | **27** |

---

## Prioritised Gap List

| # | Gap | Risk | Priority | Recommended Fix |
|---|---|---|---|---|
| 1 | Browser Back handling (entire area) | Medium — user stuck on stale page | P2 | `popstate` listener in `useMobileSession` navigates forward; track `back_pressed` |
| 2 | Inactive warning UX + `heartbeatConnected` banner | Medium — silent expiry, confused user | P2 | Wire `heartbeatConnected` state to Arabic inactivity banner in `MobileSessionClient` |
| 3 | `mobile_disconnected` event (explicit) | Low — admin timeline gap | P2 | After 3 consecutive heartbeat failures, emit `mobile_disconnected` once from the hook |
| 4 | `render_limit_reached` event | Low — admin timeline gap | P2 | Add `trackSessionEvent` call in render route when `tryIncrementRenderCount` returns false |
| 5 | `result_displayed_screen` event | Low — admin can't confirm result was seen | P2 | Track in `ScreenSessionClient` when `hasRenderResult` transitions to true |
| 6 | `result_seen_mobile` event | Low — admin can't confirm result was seen | P2 | Track in `ResultStep` on mount |
| 7 | Reconnecting UX banner | Medium — user sees blank/stale UI on reconnect | P2 | Show "جاري إعادة الاتصال..." when `heartbeatFailedCount > 0` |
| 8 | Recovered session toast | Low — nice-to-have | P3 | Show toast when `heartbeatConnected` returns to `true` after failing |
| 9 | Duplicate tab protection | Low — rare on showroom device | P3 | `BroadcastChannel` + `sessionStorage` instanceId; no server changes needed |
| 10 | `beforeunload` handler | Very low — intentionally omitted | — | Skip — blocks iOS navigation; `pagehide` is sufficient |
| 11 | Expired UX specificity (idle vs. link) | Low — generic message still correct | P3 | Add separate i18n key for idle expiry vs. invalid link |

---

## Browser Back Handling Implemented — 2026-05-03

### Architecture note

The mobile flow is a **single-page app** at `/room-preview/mobile/[sessionId]`. There are no per-step sub-routes. All steps are controlled by `viewState` + `session` state inside `useMobileSession`. Pressing Back navigates the user entirely off the session page (to the gate or landing). No server resume endpoint was needed.

### Files Changed

| File | Change |
|---|---|
| `features/room-preview/mobile/useMobileSession.ts` | Added `sessionRef` + browser Back guard `useEffect` |
| `lib/room-preview/session-diagnostics-client.ts` | Added `back_pressed` and `redirected_to_correct_step` to `UNTHROTTLED_EVENTS` |

### Where the `popstate` Listener Lives

Inside `useMobileSession`, a single `useEffect` with `[sessionId]` as its only dependency:

1. **On mount:** `window.history.pushState(null, "")` — duplicates the current history entry, creating a guard. Browser now has two identical entries for the same URL.
2. **On `popstate`:** Re-pushes the guard immediately (so every subsequent Back press is also caught), then executes the recovery logic.
3. **On unmount:** Removes the `popstate` listener.

The `sessionRef` (set via `sessionRef.current = session` in the render body) provides fresh session state to the event handler without causing the effect to re-register on every render.

### How Server Status Is Re-checked

After Back is pressed, the handler calls `fetchRoomPreviewSession(sessionId)` — the same function used by the initial load. This is a `GET /api/room-preview/sessions/[sessionId]` request. The response is authoritative: it reflects the current server-side session status.

### Redirect Mapping by Status

| Server status | Action |
|---|---|
| `expired` | `setViewState("expired")`, clear error |
| `completed` | `setViewState("expired")` (session is done; mobile has nothing to show) |
| `failed` | `setViewState("failed")` |
| `rendering` | `setViewState("ready")` (session page stays; render-in-progress UI renders) |
| `result_ready` | `setViewState("ready")` + `setShowResult(true)` (result image shown) |
| `ready_to_render` | `setViewState("ready")` (render step shown) |
| `product_selected` | `setViewState("ready")` (product+render step shown) |
| `room_selected` | `setViewState("ready")` (room+product step shown) |
| `mobile_connected` | `setViewState("ready")` (upload room step shown) |
| `waiting_for_mobile` / `created` | `setViewState("ready")` (auto-connect runs, gate is already guarded server-side) |
| fetch → 404 | `setViewState("not_found")` |
| fetch → expired error | `setViewState("expired")` |
| fetch → network error | No change — UI stays on current state; Back guard must never crash the flow |

### UX

After a successful re-fetch, sets `successMessage` to:
> **"أعدناك إلى الخطوة الصحيحة للحفاظ على تجربتك"**

This uses the existing `successMessage` state already rendered in `MobileSessionClient` (green text, no new UI components). Auto-clears after 4 seconds.

### Events Added

| Event | When | Unthrottled |
|---|---|---|
| `back_pressed` | Immediately on `popstate` | ✅ |
| `redirected_to_correct_step` | After successful server re-fetch | ✅ |

Metadata for `back_pressed`: `currentPath`, `currentStatus`, `timestamp`.
Metadata for `redirected_to_correct_step`: `fromPath`, `toPath`, `status`, `reason: "browser_back_recovery"`.

### Remaining Gaps

- **`mobile_disconnected` event** — no explicit event when heartbeat fails permanently.
- **Duplicate tab protection** — intentionally deferred.

---

## Inactive Warning UX Implemented — 2026-05-03

### Files Changed

| File | Change |
|---|---|
| `features/room-preview/mobile/useMobileSession.ts` | Added `prevHeartbeatConnectedRef` + `useEffect` to track `weak_connection_warning_shown` on `true → false` transition |
| `components/room-preview/MobileSessionClient.tsx` | Destructure `heartbeatConnected`; render amber warning banner when `!heartbeatConnected` |
| `lib/i18n/dictionaries.ts` | Updated Arabic and English `expiredDescription` for mobile |

### How `heartbeatConnected` / `failedCount` Is Surfaced

`heartbeatConnected` and `heartbeatFailedCount` were already returned from `useMobileSession` (wired in P1). `MobileSessionClient` now destructures `heartbeatConnected` and renders a non-blocking amber banner directly in the ready-state panel when its value is `false`.

The banner disappears automatically as soon as `heartbeatConnected` returns to `true` (no extra state or timer needed — it is entirely reactive).

### Warning Banner

Location: inside the ready-state `<div>`, immediately after the eyebrow caption, before any step components. Styled as an amber/warning pill to visually distinguish it from the red error state.

```
يبدو أن الاتصال ضعيف، نحاول إعادة الاتصال...
```

- Non-blocking — upload, product, and render steps are still visible and usable beneath it.
- Auto-hides when heartbeat recovers (`heartbeatConnected` flips back to `true`).
- Never shown during the `loading`, `not_found`, `expired`, or `failed` view states.

### Expired Session Arabic Message

**Before:** `"هذه الجلسة المؤقتة لم تعد متاحة. ابدأ جلسة جديدة وامسح رمز QR الجديد."`

**After:** `"انتهت الجلسة بسبب عدم النشاط، يرجى مسح رمز QR جديد من الشاشة."`

English updated in parallel: `"Your session ended due to inactivity. Please scan a new QR code from the screen."`

Both use the existing `expiredDescription` key in the mobile section of the dictionary — no new i18n keys introduced.

### Event Added

| Event | Trigger | Throttled |
|---|---|---|
| `weak_connection_warning_shown` | `heartbeatConnected` transitions `true → false` | Standard 5 s client throttle; fires once per disconnection event via `prevHeartbeatConnectedRef` guard |

Metadata: `{ failedCount }`.

### Remaining Gaps

- **`mobile_disconnected` event** — no explicit server-side event when heartbeat fails permanently (heartbeat just stops; mobile_reconnected fires on recovery). Deferred.
- **Reconnecting spinner** — the amber banner is static text; no animated spinner added. Intentional: keeps changes minimal.
- **Inactive vs. link-expired UX specificity** — `expiredLink` key still uses the generic "in-memory session" copy for the edge case where the session vanished during a hot reload. Only `expiredDescription` was updated.

---

## Mobile Disconnected Event Implemented — 2026-05-03

### Files Changed

| File | Change |
|---|---|
| `lib/room-preview/session-cleanup.ts` | Added `detectMobileStale()` export |
| `app/api/room-preview/cleanup/route.ts` | Import + call `detectMobileStale()`; add `mobileStale` to response JSON |

### Event Added

| Event | Source | Level | Trigger |
|---|---|---|---|
| `mobile_stale_detected` | `server` | `warning` | Cleanup cron detects a live session whose `lastMobileSeenAt` has been idle longer than the stale threshold |

Metadata: `{ lastMobileSeenAt, gapMs, staleThresholdMs }`.

### Detection Approach — Transition-Window Dedup

Each cron run (every 2 min) matches sessions where `lastMobileSeenAt` falls inside the half-open window:

```
(now − staleThresholdMs − cleanupIntervalMs,  now − staleThresholdMs]
  = (now − 195 s,  now − 75 s]
```

Because the window advances with each tick, a session's `lastMobileSeenAt` timestamp falls inside exactly one window — producing exactly one `mobile_stale_detected` event per stale episode. No dedup query, no extra schema column, no Redis needed.

Sessions with `NULL lastMobileSeenAt` are implicitly excluded (Prisma `gte` on null never matches).

### Reconnect Coverage

When the mobile client reconnects after a stale period, the heartbeat route already fires `mobile_reconnected` (distinct from `mobile_heartbeat_started`). The pair `mobile_stale_detected → mobile_reconnected` gives a complete disconnect/reconnect timeline in the admin event log.

### Thresholds

| Parameter | Default | Source |
|---|---|---|
| `staleThresholdMs` | 75 000 ms (75 s) | Matches heartbeat interval × 2.5 — same value used in the heartbeat route |
| `cleanupIntervalMs` | 120 000 ms (2 min) | Matches cron schedule in `vercel.json` (`*/2 * * * *`) |

### Sessions NOT Modified

`detectMobileStale()` is observation-only. It does not expire, fail, or transition any session — only emits an event. Session expiry for abandoned sessions is handled by the existing `expireIdleWaitingSessions()` path.

### Remaining Gaps

- **Immediate server-side detection** — stale detection latency is up to `staleThresholdMs + cleanupIntervalMs` = ~3 min. Real-time detection would require a background worker or Redis pub/sub. Acceptable for current showroom use case.
- **Screen stale detection** — `detectMobileStale` covers only the mobile client. A parallel `detectScreenStale` could be added following the same pattern if needed.

---

## Render Limit and Capacity Events Implemented — 2026-05-03

### Files Changed

| File | Change |
|---|---|
| `app/api/room-preview/sessions/[sessionId]/render/route.ts` | Added `render_limit_reached` event (deduped); added `code: "RENDER_LIMIT_REACHED"` to 429 response; widened `tooManyRequests` body type |
| `lib/room-preview/render-service.ts` | Added `render_capacity_exceeded` event before semaphore-capacity throw |
| `lib/room-preview/types.ts` | Added `"RENDER_LIMIT_REACHED"` to `RoomPreviewApiErrorCode` |
| `lib/room-preview/session-client.ts` | Added `"render_limit_reached"` to `RoomPreviewRequestErrorCode`; detect `RENDER_LIMIT_REACHED` API code and throw typed error |
| `features/room-preview/mobile/useMobileSession.ts` | Detect `renderError.code === "render_limit_reached"` and show Arabic limit message without recovery CTA |

### `render_limit_reached`

**Where tracked:** `render/route.ts` — inside the `!countResult.incremented` block (step 7), in a non-blocking `after()` callback.

**Source:** `"server"` / **Level:** `"warning"`

**Metadata:**
```
renderCount: countResult.currentCount   // how many renders the session has used
maxRendersPerSession: MAX_RENDERS_PER_SESSION  // the configured limit (default: 2)
status: session.status                  // session state at time of rejection
```

**Dedup/spam prevention:** Module-level `renderLimitWarnCooldown: Map<string, number>` with 60 s TTL per `sessionId`. The first rejection within any 60 s window fires the event; subsequent taps within that window skip the event silently. The 60 s window resets on the first rejection after it expires.

**API change:** The 429 response body now includes `code: "RENDER_LIMIT_REACHED"` alongside the existing `error` string. The `tooManyRequests()` helper's body type is widened to `{ error: string; code?: string }` — fully backwards-compatible.

### `render_capacity_exceeded`

**Where tracked:** `render-service.ts` — immediately after `acquireGeminiSlot()` returns `{ acquired: false }`, before the throw that fails the pipeline.

**Source:** `"renderer"` / **Level:** `"warning"`

**Metadata:**
```
reason: "semaphore_capacity_exceeded"
renderJobId: string | null              // render job ID for cross-correlation
```

**Dedup/spam prevention:** Inherently deduplicated — each session can only be in the `rendering` state once (atomic `tryClaimRenderingSlot` guard). If capacity is exceeded, the session is marked `failed` immediately after and the pipeline does not retry, so this event fires at most once per render attempt.

**Note:** The `render_capacity_exceeded` event fires before the generic `render_failed` event (which is emitted in the catch block). Both appear in the timeline, giving full context: `render_capacity_exceeded` → `render_failed`.

### UX — Render Limit

When the server returns `code: "RENDER_LIMIT_REACHED"`, `useMobileSession.ts` now detects it via `renderError.code === "render_limit_reached"` and shows:

```
وصلت إلى عدد المحاولات المتاحة لهذه التجربة.
```

No recovery CTA button is shown (none is appropriate — the limit is permanent for this session). Previously the UI showed the generic "حدثت مشكلة مؤقتة. يرجى إعادة تحميل الصفحة." reload message, which was misleading.

### UX — Render Capacity

The `render_capacity_exceeded` event fires **server-side only**. The client sees a generic render failure (session status `→ failed`) and shows the existing `retry_render` recovery message: "المعالجة تستغرق وقتاً أطول من المعتاد. أعد المحاولة." The capacity-specific Arabic message ("الطلبات كثيرة حالياً...") is not surfaced client-side without schema changes (the client cannot distinguish capacity failure from other render failures). Deferred.

### Additional Events — Budget and Cooldown

Both remaining rate-limit gaps were implemented in the same commit:

| Event | Source | Level | Where |
|---|---|---|---|
| `screen_budget_exhausted` | `server` | `warning` | render/route.ts step 8 — `!budget.allowed` block |
| `render_device_cooldown` | `server` | `warning` | render/route.ts step 6 — `cooldownResult.limited` block |

**`screen_budget_exhausted` metadata:** `{ screenId, dailyBudget, status }`  
Deduped per `screenId` (60 s) — multiple sessions on the same screen share one dedup bucket, which is correct since the budget is screen-level.

**`render_device_cooldown` metadata:** `{ ttl, status }`  
Deduped per `deviceId` fingerprint (60 s) — the fingerprint is per device/browser, matching the scope of the cooldown itself.

Both events fire in non-blocking `after()` callbacks so they do not add latency to the 429 response.

### Remaining Gaps

- **Capacity UX differentiation** — client cannot distinguish `render_capacity_exceeded` from other render failures without surfacing a reason field on the session or a separate API. Schema change deferred.

---

## Result Display Tracking Implemented — 2026-05-03

### Files Changed

| File | Change |
|---|---|
| `features/room-preview/screen/useScreenSession.ts` | Added `useRef` import; added `resultDisplayedRef` + `result_displayed_screen` effect |
| `features/room-preview/mobile/useMobileSession.ts` | Added `resultSeenRef` + `result_seen_mobile` effect |
| `lib/room-preview/session-diagnostics-client.ts` | Added both events to `UNTHROTTLED_EVENTS` |

### `result_displayed_screen`

**Where tracked:** `useScreenSession.ts` — a `useEffect` that watches `session` and fires when `session.status === "result_ready"` AND `session.renderResult.imageUrl` is non-empty.

**Source:** `"screen"` / **Level:** `"info"`

**Metadata:** `{ status, hasResultImage: true, timestamp }`

**Dedup approach:** `resultDisplayedRef = useRef<string | null>(null)` stores the `imageUrl` of the last tracked result. The effect only fires when the current `imageUrl` differs from the stored value — one event per unique render result, regardless of SSE reconnects, polling fallback, or repeated state pushes.

### `result_seen_mobile`

**Where tracked:** `useMobileSession.ts` — a `useEffect` that watches `showResult` and `session`. Fires when `showResult` is `true` AND `session.renderResult.imageUrl` is non-empty.

**Source:** `"mobile"` / **Level:** `"info"`

**Metadata:** `{ status, hasResultImage: true, timestamp }`

**Dedup approach:** `resultSeenRef = useRef<string | null>(null)` stores the `imageUrl` of the last tracked result. All three `setShowResult(true)` call sites (main render flow, back-navigation recovery, resume-polling flow) are covered by a single effect — the ref prevents duplicate events if any of them fires with the same result.

### UNTHROTTLED_EVENTS

Both events added to `UNTHROTTLED_EVENTS` in `session-diagnostics-client.ts`. They are one-shot by nature (one per result display) and must arrive without the 5 s client throttle suppressing them.

### Remaining Gaps

- **`result_displayed_screen` timing vs. image load** — the event fires when `session.status === "result_ready"` first arrives, not when the `<Image>` has finished rendering pixels on screen. True "image rendered" would require an `onLoad` callback on the `<Image>` element. Acceptable for current observability needs.
- **`renderJobId` in metadata** — `renderJobId` is not stored on the `RoomPreviewSession` object (it lives only in `RenderJob`), so it cannot be included without a schema or API change. Omitted from both events.

---

## UX State Matrix — 2026-05-03

> **Auditor:** claude-sonnet-4-6  
> **Scope:** All customer-facing states across mobile and screen, including lifecycle events, render limits, upload errors, and result tracking.  
> **Arabic copy** is the exact text currently rendered unless marked *recommended*.

---

### Core Session States

| State | Mobile UX | Screen UX | Event Logged | UX Clear? | Missing / Weak Message | Recommended Copy |
|---|---|---|---|---|---|---|
| **waiting_for_mobile** | Not applicable — mobile hasn't loaded yet | StatusPanel: "بانتظار اتصال الهاتف" + QR code displayed via screen launcher | — | ✅ Screen clear | None | — |
| **mobile_connected** | Ready panel: RoomStep visible — "ارفع صورة غرفتك" | StatusPanel: "بانتظار اختيار الغرفة" + phone-connected badge | `screen_connected` | ✅ Both clear | None | — |
| **room_selected** | RoomStep (preview shown) + ProductStep visible — "اختيار المنتج" | StatusPanel: "بانتظار اختيار العنصر" + room thumbnail | — | ✅ Both clear | None | — |
| **product_selected** | RoomStep + ProductStep + ResultStep (Create Render button visible) | StatusPanel: "جارٍ تجهيز المعاينة..." + room + product thumbnails | — | ✅ Both clear | Screen stays "تجهيز" even before tap — slightly premature | — |
| **ready_to_render** | ResultStep: render loading overlay with progress bar + rotating Arabic messages | StatusPanel: "جارٍ تجهيز المعاينة..." | `render_requested` | ✅ Both clear | None | — |
| **rendering** | ResultStep loading overlay with animated progress + 4 rotating messages: "خليك على هذه الشاشة..." → "نتحقق من الغرفة..." → "النظام يعيد المحاولة..." → "اقتربنا من الانتهاء..." | StatusPanel: "جارٍ إنشاء المعاينة..." + cyan progress box + same 4 rotating messages | `render_started`, `render_job_processing` | ✅ Both clear | None | — |
| **result_ready** | Full-screen result image + floating product card + Download / Share / Modify buttons (confetti on reveal) | Full-screen black overlay with rendered image centred | `result_displayed_screen`, `result_seen_mobile` | ✅ Both clear | None | — |
| **completed** | Mobile shows result image + **completed banner**: "تم عرض المعاينة بنجاح" / "إذا رغبت بتجربة جديدة..." + Download + Share. **Modify button hidden.** ✅ fixed 2026-05-04 | Screen auto-resets via `resetCountdown` (SCREEN_RESULT_RESET_MS = 60 s), then returns to screen launcher | `session_completed` | ✅ Both clear | None | Cooldown state not detectable at client; generic copy chosen (safe for cooldown and non-cooldown paths) |
| **failed** | SessionStatePanel: title "تعذر تحميل الجلسة" + "تعذر تحميل الجلسة حالياً. حاول مرة أخرى." + Retry + New Session buttons | StatusPanel: "فشلت المعالجة" + errorCountdown progress bar → auto-resets to launcher | `render_failed` / `render_timeout` | ✅ Both clear | None | — |
| **expired** | SessionStatePanel: "انتهت الجلسة" + "انتهت الجلسة بسبب عدم النشاط، يرجى مسح رمز QR جديد من الشاشة." + New Session + Retry | SessionStatePanel: "انتهت الجلسة" + "هذه الجلسة لم تعد متاحة. ابدأ جلسة جديدة وامسح رمز QR الجديد." + countdown | `session_expired` | ✅ Both clear | None | — |

---

### Connection / Lifecycle Events

| State/Event | Mobile UX | Screen UX | Event Logged | UX Clear? | Missing / Weak Message | Recommended Copy |
|---|---|---|---|---|---|---|
| **Weak heartbeat** (`heartbeatConnected = false`) | Amber banner: "يبدو أن الاتصال ضعيف، نحاول إعادة الاتصال..." — auto-hides on reconnect | No visible message shown to customer | `weak_connection_warning_shown` | ✅ Mobile clear | Screen has no awareness indicator. Acceptable — screen staff can observe visually | — |
| **mobile_stale_detected** | No message — background cron event, customer unaware | No message | `mobile_stale_detected` | ✅ Admin-only | No customer message needed | — |
| **mobile_reconnected** | Amber banner disappears when `heartbeatConnected` flips back to `true` | No visible change | `mobile_reconnected` | ✅ Clear (implicit via banner removal) | None | — |
| **screen_connected** | No message | No message — admin event only | `screen_connected` | ✅ Admin-only | No customer message needed | — |
| **screen_disconnected** | No message | If SSE drops, screen falls back to polling silently | `screen_disconnected`, `SCREEN_NOT_UPDATING` (if poll fails) | ⚠️ Screen may appear frozen without polling fallback notice | Screen silently switches to polling — customer may see a stale state briefly | Low priority |
| **SCREEN_NOT_UPDATING** | No message | StatusPanel continues showing last state; `pollError` prop triggers retry button | `SCREEN_NOT_UPDATING` issue opened | ⚠️ Screen operator may not know SSE is broken | `pollError` shows retry button but without a human-readable explanation | Staff-facing, not customer-facing |
| **Browser back recovery** | Brief loading → re-fetches session → updates `viewState` to correct step + Arabic toast (hardcoded, not in i18n) | No effect | `back_pressed`, `redirected_to_correct_step` | ✅ Clear | Toast message is hardcoded Arabic, not routed through i18n | — |
| **redirected_to_correct_step** | Same as above — mobile shows correct step after back press | No effect | `redirected_to_correct_step` | ✅ Handled | None | — |

---

### Render Limits

| State/Event | Mobile UX | Screen UX | Event Logged | UX Clear? | Missing / Weak Message | Recommended Copy |
|---|---|---|---|---|---|---|
| **render_limit_reached** | Red error box (no CTA button): "وصلت إلى عدد المحاولات المتاحة لهذه التجربة." | No visible change — session stays in `product_selected` | `render_limit_reached` | ✅ Clear on mobile | Screen stays in progress state indefinitely — operator may be confused | Screen could show "الجلسة وصلت للحد المسموح" but this is admin-level |
| **render_capacity_exceeded** | After 202 is accepted, polling sees `failed` → recovery message: "المعالجة تستغرق وقتاً أطول من المعتاد. أعد المحاولة." + retry button | StatusPanel: "فشلت المعالجة" + countdown | `render_capacity_exceeded` → `render_failed` | ⚠️ Unclear — customer told to "retry" but the system was at capacity, not broken | Message implies slowness but retrying may immediately fail again if capacity is still full | *"الطلبات كثيرة حالياً. يرجى المحاولة خلال لحظات."* (deferred — needs schema change to distinguish from other failures) |
| **screen_budget_exhausted** | Red error box (no CTA button): **"انتهى الحد اليومي لهذه الشاشة. يرجى التواصل مع الموظف المختص."** ✅ fixed | No visible change | `screen_budget_exhausted` | ✅ Clear | None | — |
| **render_device_cooldown** | Red error box (no CTA button): **"يمكنك طلب معاينة جديدة بعد ٥ دقائق."** ✅ fixed | No visible change | `render_device_cooldown` | ✅ Clear | None | — |

---

### Result Tracking

| State/Event | Mobile UX | Screen UX | Event Logged | UX Clear? | Missing / Weak Message | Recommended Copy |
|---|---|---|---|---|---|---|
| **result_displayed_screen** | Mobile may still be on loading overlay | Full-screen image shown on screen | `result_displayed_screen` | ✅ Clear | No customer message needed — the image is the message | — |
| **result_seen_mobile** | Full-screen result + floating product card + confetti | Full-screen image already shown | `result_seen_mobile` | ✅ Clear | None | — |
| **session_completed** | Mobile stays on result UI showing result (no change visible to customer) | Screen resets via countdown then navigates to launcher | `session_completed` | ⚠️ Slight confusion if customer tries to use Modify button after `completed` | Modify/Download still appear — if pressed after screen resets, mobile shows error | See `completed` row above |

---

### Upload / Product Events

| State/Event | Mobile UX | Screen UX | Event Logged | UX Clear? | Missing / Weak Message | Recommended Copy |
|---|---|---|---|---|---|---|
| **room_upload_started** | Spinner label from `roomSaveStatusLabel` (e.g., "جارٍ الرفع...") | StatusPanel: still "بانتظار اختيار الغرفة" | `room_upload_started` | ✅ Clear | None | — |
| **room_upload_failed** | Recovery: "تعذر رفع الصورة. يرجى المحاولة مرة أخرى." + "إعادة المحاولة" | StatusPanel: no change | `room_upload_failed` | ✅ Clear | None | — |
| **image_too_large** | Recovery (maps to `retake_room_photo`): **"الصورة غير مناسبة للمعاينة. يرجى رفع صورة تُظهر الأرضية بوضوح."** + "اختيار صورة أخرى" | No change | `IMAGE_TOO_LARGE` issue | ⚠️ Misleading — message says "not suitable for preview / show floor" but the real problem is file size | Customer told to retake the photo, not to compress it | *"حجم الصورة كبير جداً. اختر صورة أصغر حجماً من المعرض أو التقط صورة جديدة."* |
| **image_invalid** | Same `retake_room_photo` recovery | No change | `IMAGE_INVALID` issue | ✅ Reasonable — retaking is the correct action | None | — |
| **image_quality_insufficient** | Same `retake_room_photo` recovery | No change | `IMAGE_QUALITY_INSUFFICIENT` issue | ✅ Reasonable — retaking is correct | Message doesn't specify *why* quality is low | Optionally: *"الصورة غير واضحة بما يكفي. التقط صورة في مكان أكثر إضاءة وتأكد من ظهور الأرضية."* |
| **floor_not_visible** | Same `retake_room_photo` recovery | No change | `FLOOR_NOT_VISIBLE` issue | ✅ Message mentions floor | None | — |
| **product_selected** | "تم حفظ المنتج بنجاح" toast (green) + ProductStep carousel updates to selected product | Screen product thumbnail updates | `product_selected` | ✅ Clear | None | — |
| **product_changed** | Same as product_selected (carousel updates silently) | Screen thumbnail updates | `product_changed` | ✅ Clear | None | — |

---

## UX Gaps Before Build

### Must Fix Before Build — ✅ All Fixed (2026-05-03)

| Gap | Status | Files Changed |
|---|---|---|
| **`render_device_cooldown` shows wrong recovery message** | ✅ Fixed | `types.ts`, `render/route.ts`, `session-client.ts`, `useMobileSession.ts` |
| **`screen_budget_exhausted` shows wrong recovery message** | ✅ Fixed | Same files |
| **`image_too_large` message says "show the floor"** | ✅ Fixed | `issue-catalog.ts`, `customer-recovery.ts`, `useMobileSession.ts` |

**render_device_cooldown fix:**  
Route now returns `code: "RENDER_DEVICE_COOLDOWN"` on the 429. Client detects it via `renderError.code === "render_device_cooldown"` and shows *"يمكنك طلب معاينة جديدة بعد ٥ دقائق."* with no CTA button.

**screen_budget_exhausted fix:**  
Route now returns `code: "SCREEN_BUDGET_EXHAUSTED"` on the 429. Client detects it via `renderError.code === "screen_budget_exhausted"` and shows *"انتهى الحد اليومي لهذه الشاشة. يرجى التواصل مع الموظف المختص."* with no CTA button.

**image_too_large fix:**  
New `CustomerMessageKey` `"image_too_large"` added. `IMAGE_TOO_LARGE` issue now points to it instead of `"retake_room_photo"`. Upload error handler maps HTTP 413 to `"image_too_large"` recovery: *"حجم الصورة كبير. يرجى اختيار صورة أصغر أو التقاط صورة جديدة."* + "اختيار صورة أخرى" button.

### Can Wait

| Gap | Reason |
|---|---|
| **`completed` — Modify button removed** ✅ fixed 2026-05-04 | Modify hidden when `session.status === "completed"`; completed banner shown with cooldown-safe copy. |
| **`render_capacity_exceeded` shows generic retry message** | Needs schema change to distinguish from other failures. The "retry" message is actually correct user guidance — trying again will work once capacity is free. |
| **`image_quality_insufficient` doesn't explain why** | The current message is adequate for a showroom; detailed photo guidance is out of scope for in-store UX. |
| **Screen has no weak-heartbeat indicator** | Staff can observe the room directly. Adding a banner to the showroom screen during a demo would be distracting. |
| **`screen_disconnected` / SSE fallback not communicated** | Silent polling fallback is correct behaviour for staff-facing screen. |
| **Back navigation toast not in i18n** | Functional but not localised. Low impact — back navigation is an edge case. |

### Admin-Only / No Customer UX Needed

| Event | Reason |
|---|---|
| `mobile_stale_detected` | Background cron detection — no customer action possible |
| `screen_connected` / `screen_disconnected` | SSE connection events — admin observability only |
| `SCREEN_NOT_UPDATING` | Staff-facing issue only; `pollError` retry button is sufficient |
| `render_limit_reached` on screen | Screen status is informational for staff, not customer-facing |
| `render_capacity_exceeded` event itself | Admin timeline entry; customer sees the result (failed) not the cause |
| `screen_budget_exhausted` event itself | Admin timeline entry only |
| All `render_device_cooldown` / `screen_budget_exhausted` events | Timeline only — customer message is the UX surface |

---

## Current Customer Facing Messages Audit

> **Date:** 2026-05-04  
> **Scope:** All customer-visible strings in `useMobileSession.ts`, `MobileSessionClient.tsx`, `RoomStep.tsx`, `ResultStep.tsx`, `lib/i18n/dictionaries.ts`, `customer-recovery.ts`  
> **Instruction:** Inspection only — no code changes.

---

### Mobile — Session Load & Connection States

| State / Error | When It Happens | Mobile Message Shown (Arabic) | Source | Button / CTA | Clear? | Problem |
|---|---|---|---|---|---|---|
| **Loading** | Initial page load, all 3 retry attempts | "جارٍ تحميل الجلسة..." / "نتحقق من أن جلسة QR هذه لا تزال متاحة على الخادم." | `t.roomPreview.mobile.loadingTitle / loadingDescription` | None | ✅ | — |
| **Loading > 10 s stall** | Fetch hasn't resolved after 10 seconds | "يبدو أن الاتصال يستغرق وقتاً أطول من المعتاد" | Hardcoded — `MobileSessionClient.tsx:31` | "إعادة المحاولة" | ✅ | Hardcoded, not in i18n |
| **not_found** | Session ID doesn't exist in DB | Title: "الجلسة غير موجودة" / Body: "رابط هذه الجلسة غير صالح. ابدأ جلسة جديدة من شاشة QR الرئيسية." | `t.roomPreview.mobile.notFoundTitle` + `invalidLink` | "ابدأ جلسة جديدة" | ✅ | — |
| **expired** | Session passed expiry threshold | Title: "انتهت الجلسة" / Body: "هذه الجلسة المؤقتة لم تعد متاحة. ربما اختفت بعد تحديث الصفحة أو إعادة تشغيل الخادم." | `t.roomPreview.mobile.expiredTitle` + `expiredLink` | "ابدأ جلسة جديدة" + "إعادة المحاولة" | ⚠️ | `expiredLink` mentions "hot reload" / "server restart" — technical jargon inappropriate in a showroom |
| **failed — network interrupted** | All 3 load retries failed with `TypeError: Failed to fetch` | "تعذر الاتصال بالسيرفر، تأكد أن الجوال والكمبيوتر على نفس الشبكة" | Hardcoded — `useMobileSession.ts:34` | "إعادة المحاولة" | ✅ | Hardcoded, not in i18n |
| **failed — other** | Non-network load error (server 5xx, parse error, etc.) | "تعذر تحميل الجلسة. حاول مرة أخرى." | `t.roomPreview.mobile.loadFailed` | "إعادة المحاولة" | ✅ | — |
| **completed** (treated as expired on back-nav) | Customer presses Back after session completes | Title: "انتهت الجلسة" / Body: `expiredLink` text | Same as expired | "ابدأ جلسة جديدة" | ⚠️ | Same technical `expiredLink` message shown for a normal completion |
| **Weak heartbeat banner** | Heartbeat fails twice in a row | "يبدو أن الاتصال ضعيف، نحاول إعادة الاتصال..." | Hardcoded — `MobileSessionClient.tsx:204` | None | ✅ | Hardcoded, not in i18n |

---

### Mobile — Room Upload States

| State / Error | When It Happens | Mobile Message Shown (Arabic) | Source | Button / CTA | Clear? | Problem |
|---|---|---|---|---|---|---|
| **Upload in progress** | After file picked, during presign + PUT to R2 | "جاري رفع صورة الغرفة..." | Hardcoded — `useMobileSession.ts:675` | None (spinner) | ✅ | Hardcoded, not in i18n |
| **Upload in progress with percent** | During PUT to R2, progress event fires | "جاري رفع صورة الغرفة... {percent}%" | Hardcoded — `useMobileSession.ts:723` | None (spinner) | ✅ | Hardcoded, not in i18n |
| **Upload failed — generic** | Upload API returns non-413 error | "تعذر رفع الصورة. يرجى المحاولة مرة أخرى." | `CUSTOMER_RECOVERY_MESSAGES.retry_upload.text` | "إعادة المحاولة" | ✅ | — |
| **Upload failed — image too large** | HTTP 413 from room API | "حجم الصورة كبير. يرجى اختيار صورة أصغر أو التقاط صورة جديدة." | `CUSTOMER_RECOVERY_MESSAGES.image_too_large.text` | "اختيار صورة أخرى" | ✅ | — |
| **Upload failed — signed URL expired** | HTTP 403 on room confirm (presigned URL stale) | "انتهت صلاحية رابط الرفع، حاول مرة أخرى" | Hardcoded — `useMobileSession.ts:801` | None | ⚠️ | Technical message; customer can't do anything; no CTA provided |
| **Upload failed — fallback** | Network error during room upload | `createActionErrorMessage(error, "تعذر رفع الصورة، تحقق من الاتصال وحاول مرة أخرى")` | Hardcoded fallback — `useMobileSession.ts:802` | None | ✅ | — |

---

### Mobile — Render States

| State / Error | When It Happens | Mobile Message Shown (Arabic) | Source | Button / CTA | Clear? | Problem |
|---|---|---|---|---|---|---|
| **Rendering — rotating messages** | While `isSavingProduct && !localShowResult` | Cycles through 6 messages: "جاري إنشاء التصميم..." / "نحلل تفاصيل الغرفة" / "نختار أفضل التركيبات" / "نضبط الإضاءة والألوان" / "لحظات وسيكون جاهزاً" / "نضع اللمسات الأخيرة" | Hardcoded — `ResultStep.tsx:41-47` | None | ✅ | Hardcoded, not in i18n |
| **Rendering — progress bar labels** | During render loading overlay | "جاري المعالجة" (in-progress) / "اكتمل التصميم" (done) | Hardcoded — `ResultStep.tsx:201-202` | None | ✅ | Hardcoded, not in i18n |
| **Render start button** | After room + product saved, before render triggered | CTA button uses `t.common.actions.create` = "إنشاء" | `t.common.actions.create` | "إنشاء" (gold button) | ✅ | — |
| **Render pipeline failed** (poll returns `failed`) | `pollForRenderResult` resolves with `status === "failed"` | "المعالجة تستغرق وقتاً أطول من المعتاد. أعد المحاولة." | `CUSTOMER_RECOVERY_MESSAGES.retry_render.text` | "إعادة المعالجة" | ⚠️ | Message blames slowness but cause is actually failure; misleading. Can wait. |
| **Render timeout** (request throws `timeout`) | `createRenderForSession` call times out | "المعالجة تستغرق وقتاً أطول من المعتاد. أعد المحاولة." | `CUSTOMER_RECOVERY_MESSAGES.retry_render.text` | "إعادة المعالجة" | ✅ | Correct for this case |
| **Render failed — other error** | Any other `RoomPreviewRequestError` during render | "حدثت مشكلة مؤقتة. يرجى إعادة تحميل الصفحة." | `CUSTOMER_RECOVERY_MESSAGES.reload_page.text` | "إعادة تحميل الصفحة" | ⚠️ | CTA mapped to retry-in-page but label says "reload"; intercept prevents hard reload (correct), but label confuses |
| **Render limit reached** | HTTP 429 `RENDER_LIMIT_REACHED` | "وصلت إلى عدد المحاولات المتاحة لهذه التجربة." | Hardcoded — `useMobileSession.ts:1058` | None | ✅ | No CTA is correct (customer can't do more) |
| **Render device cooldown** | HTTP 429 `RENDER_DEVICE_COOLDOWN` | "يمكنك طلب معاينة جديدة بعد ٥ دقائق." | Hardcoded — `useMobileSession.ts:1061` | None | ✅ | — |
| **Screen budget exhausted** | HTTP 429 `SCREEN_BUDGET_EXHAUSTED` | "انتهى الحد اليومي لهذه الشاشة. يرجى التواصل مع الموظف المختص." | Hardcoded — `useMobileSession.ts:1064` | None | ✅ | — |
| **Result ready** | Render completes, `status === "result_ready"` | Success toast: "تم حفظ المنتج بنجاح" | `t.roomPreview.mobile.product.saveSuccess` | — | ⚠️ | Success toast says "product saved" instead of "preview ready" — misleading at result moment |
| **Result displayed** | Full-screen result overlay shown | Product badge: "جاهز" / Action bar: "تحميل" / "مشاركة" / "تعديل" | Hardcoded — `ResultStep.tsx:356,376,395,407` | Download / Share / Modify | ✅ | Hardcoded, not in i18n |

---

### Mobile — Product & Navigation States

| State / Error | When It Happens | Mobile Message Shown (Arabic) | Source | Button / CTA | Clear? | Problem |
|---|---|---|---|---|---|---|
| **Product save failed** | PATCH `/product` returns error | `t.roomPreview.mobile.product.saveFailed` = "فشل حفظ المنتج" | i18n | None | ✅ | — |
| **Back navigation recovery** | Customer presses Android/iOS Back | "أعدناك إلى الخطوة الصحيحة للحفاظ على تجربتك" (toast, 4 s) | Hardcoded — `useMobileSession.ts:280` | None | ✅ | Hardcoded, not in i18n |
| **Room section header** | Always visible when connected | "صورة الغرفة" / "ارفع صورة غرفتك" / "اختر صورة واضحة من معرض الهاتف..." | Hardcoded — `RoomStep.tsx:52-59` | "اختيار صورة من المعرض" | ✅ | Hardcoded, not in i18n |

---

### Screen — Status Display

| State | When It Happens | Screen Message (Arabic) | Source | Clear? |
|---|---|---|---|---|
| **Loading** | Screen page initial load | "جارٍ تحميل الجلسة..." / "نتحقق من أن هذه الجلسة ما تزال متاحة." | `t.roomPreview.screen.loadingTitle / loadingDescription` | ✅ |
| **Session not found** | `not_found` error | "الجلسة غير موجودة" / "رابط هذه الجلسة غير صالح. ابدأ جلسة جديدة لإنشاء رمز QR جديد." | `t.roomPreview.screen.notFoundTitle / notFoundDescription` | ✅ |
| **Session expired** | `expired` error | "انتهت الجلسة" / "هذه الجلسة لم تعد متاحة. ابدأ جلسة جديدة وامسح رمز QR الجديد." | `t.roomPreview.screen.expiredTitle / expiredDescription` | ✅ |
| **Failed to load** | `failed` error | "تعذر تحميل الجلسة" / "تعذر تحميل الجلسة حالياً. حاول مرة أخرى." | `t.roomPreview.screen.failedTitle / failedDescription` | ✅ |
| **Waiting for phone** | `waiting_for_mobile` | "بانتظار اتصال الهاتف" | `t.roomPreview.screen.statuses.waitingPhone` | ✅ |
| **Waiting for room** | `mobile_connected` | "بانتظار اختيار الغرفة" | `t.roomPreview.screen.statuses.waitingRoom` | ✅ |
| **Waiting for product** | `room_selected` | "بانتظار اختيار العنصر" | `t.roomPreview.screen.statuses.waitingItem` | ✅ |
| **Product selected, awaiting render** | `product_selected` (before customer taps render) | "تم اختيار المنتج، بانتظار بدء المعاينة" | `t.roomPreview.screen.statuses.waitingRender` ✅ fixed 2026-05-04 | ✅ |
| **Preparing / ready_to_render** | `ready_to_render` (render triggered) | "جارٍ تجهيز المعاينة..." | `t.roomPreview.screen.statuses.preparing` | ✅ |
| **Rendering** | `rendering` | "جارٍ إنشاء المعاينة..." | `t.roomPreview.screen.statuses.rendering` | ✅ |
| **Result ready** | `result_ready` | "المعاينة جاهزة" | `t.roomPreview.screen.statuses.ready` | ✅ |
| **Pipeline failed** | `failed` after render attempt | "فشلت المعالجة" + "فشل مسار المعالجة لهذه الجلسة." | `t.roomPreview.screen.statuses.failed` + `pipelineFailed` | ✅ |
| **SSE interrupted** | SSE drops, polling fallback starts | "انقطعت التحديثات الفورية. سيتم استخدام التحديث الاحتياطي." | `t.roomPreview.screen.realtimeInterrupted` | ✅ |
| **Poll failed** | Polling request fails | "فشل تحديث الجلسة." | `t.roomPreview.screen.pollFailedTitle` | ✅ |

---

### All Recovery Messages (customer-recovery.ts)

| Key | Arabic Text | CTA Arabic | CTA Intent | Trigger |
|---|---|---|---|---|
| `retry_upload` | "تعذر رفع الصورة. يرجى المحاولة مرة أخرى." | "إعادة المحاولة" | `retry_upload` | Generic upload failure |
| `retry_render` | "المعالجة تستغرق وقتاً أطول من المعتاد. أعد المحاولة." | "إعادة المعالجة" | `retry_render` | Render pipeline failed / timeout |
| `reload_page` | "حدثت مشكلة مؤقتة. يرجى إعادة تحميل الصفحة." | "إعادة تحميل الصفحة" | `reload_page` | Other render error; CTA intercepted → retry-in-page |
| `retake_room_photo` | "الصورة غير مناسبة للمعاينة. يرجى رفع صورة تُظهر الأرضية بوضوح." | "اختيار صورة أخرى" | `retake_room_photo` | IMAGE_INVALID / IMAGE_QUALITY_INSUFFICIENT / FLOOR_NOT_VISIBLE |
| `image_too_large` | "حجم الصورة كبير. يرجى اختيار صورة أصغر أو التقاط صورة جديدة." | "اختيار صورة أخرى" | `retake_room_photo` | HTTP 413 upload |
| `reconnect_mobile` | "تعذر الاتصال بالجلسة. يرجى فتح رمز QR مرة أخرى." | "إعادة الاتصال" | `reconnect_mobile` | QR_OPENED_NO_MOBILE_CONNECT |

---

## Current Must-Fix Message Gaps

| # | Gap | Severity | File | Fix |
|---|---|---|---|---|
| 1 | **`expiredLink` uses technical language** ("hot reload", "server restart") | High | `dictionaries.ts` (ar) | Replace with: "انتهت صلاحية هذه الجلسة. يرجى مسح رمز QR الجديد من الشاشة." |
| 2 | **Result ready shows "تم حفظ المنتج بنجاح"** — wrong success toast at result display | Medium | `useMobileSession.ts` | Use a dedicated `renderSuccess` i18n key like "تم إنشاء المعاينة بنجاح ✓" |
| 3 | **Signed URL expired (HTTP 403) shows technical message, no CTA** | Low-Medium | `useMobileSession.ts:801` | Map to `retry_upload` recovery so customer gets a retry button |

---

## Current Good Messages

- All 6 `CUSTOMER_RECOVERY_MESSAGES` entries are clear and actionable in Arabic
- Render limit/cooldown/budget messages are appropriately final (no misleading CTA)
- Network error message correctly instructs customer to check network configuration
- Screen status labels (waiting/rendering/ready/failed) are complete and in i18n
- Not-found and expired screen messages are clean and non-technical
- Room upload progress ("جاري رفع صورة الغرفة... {percent}%") gives useful feedback
- Back navigation recovery toast is friendly and reassuring
- Weak heartbeat banner is calm and informative

---

## Unknown / Needs Manual UI Test

| Item | Why Unknown |
|---|---|
| **`retake_room_photo` recovery message trigger path** | `IMAGE_QUALITY_INSUFFICIENT` and `FLOOR_NOT_VISIBLE` issues must be opened by the render service — unclear if they actually fire in current prod flow |
| **`reconnect_mobile` recovery message** | `QR_OPENED_NO_MOBILE_CONNECT` is opened by the cron job. No client-side handler currently surfaces this recovery message — it's only in `CUSTOMER_RECOVERY_MESSAGES` but nothing reads it on the mobile page |
| **Duplicate tab / second phone opening same QR** | No UI message defined. Session just auto-connects normally. Need to test what the second phone sees. |
| **`render_capacity_exceeded` customer message** | Render pipeline throws `"Render capacity reached. Please try again in a moment."` — this surfaces as `t.roomPreview.mobile.loadFailed` fallback. Customer sees generic "تعذر تحميل الجلسة" which is incorrect |
| **Gate page (`/room-preview/gate/[sessionId]`)** | This page has its own i18n keys (`gate.*`). Customer-facing intro copy ("يسعدنا انضمامك إلينا...") not included in this audit. |

---

# Room Preview Full Flow + Automation Map

> **Date:** 2026-05-04  
> **Scope:** Full system — screen, mobile, server, cron, heartbeat, SSE, cleanup, admin.  
> **Sources:** `features/room-preview/`, `components/room-preview/`, `app/api/room-preview/`, `lib/room-preview/`, `vercel.json`, `app/room-preview/gate/`  
> **Instruction:** Documentation only. No code changes.

---

## 1. Screen Home / Gallery State

### What the showroom screen starts on

The showroom screen lives at `/room-preview/screen` — the **screen launcher** page (`components/room-preview/ScreenLauncherClient.tsx`). There is no separate "gallery" or "home" view displayed between sessions. The launcher immediately begins creating a session and shows a **branded loading screen** (`BrandedQrLoadingScreen`) for at least 2 seconds (`BRANDED_LOADING_MIN_MS`).

- Title: `t.roomPreview.launcher.brandedLoadingTitle` = "جاري تجهيز التجربة"
- Description: "يتم الآن إنشاء جلسة QR وتجهيز الاتصال"

### Session reuse

Before creating a new session, `ScreenLauncherClient` checks `localStorage` (key: `room-preview:screen-session-id`) for a stored `sessionId`. If the stored session is still valid (not expired, not terminal, `mobileConnected === false`) it reuses it and skips creation. This prevents orphaned sessions on TV refresh.

A `localStorage` creation lock (`room-preview:screen-session-create-lock`, 30s TTL) prevents duplicate concurrent session creation on multi-tab or hot-reload.

### Session creation → QR appears

| Step | What happens |
|---|---|
| Launcher mounts at `/room-preview/screen` | Checks localStorage for reusable session |
| No reusable session | POST `/api/room-preview/sessions` with source `screen_launcher` |
| Session created | `router.replace(/room-preview/screen/[sessionId])` |
| Screen page loads | `ScreenSessionClient` mounts, fetches session, opens SSE stream |
| QR appears | `SessionQRCode` renders QR pointing to `/room-preview/gate/[sessionId]` |
| Idle countdown starts | `SCREEN_IDLE_RESET_MS = 5 minutes` — auto-resets to launcher if no mobile connects |

### Admin events logged
- `session_created` (always, source: server)
- `single_screen_session_created` (only if `ROOM_PREVIEW_SINGLE_SCREEN_MODE=true`)
- `screen_session_created` (from `ScreenLauncherClient` via `trackClientSessionEvent`)
- `screen_session_reused` (if localStorage session was reused)
- `duplicate_session_create_blocked` (if concurrent creation was blocked by lock)

---

## 2. QR / Session Creation

### API and initial state
- **Route:** POST `/api/room-preview/sessions`
- **Service:** `createRoomPreviewSession()` — `lib/room-preview/session-service.ts`
- **Initial status:** `waiting_for_mobile`
- **Initial `mobileConnected`:** `false`
- **`expiresAt`:** `Date.now() + SESSION_EXPIRY_MINUTES * 60_000` (default: **60 minutes**)

### Single-screen mode
If `ROOM_PREVIEW_SINGLE_SCREEN_MODE=true`: reuses the newest live session; expires all others immediately with `single_screen_duplicates_expired` event.

### What the screen shows
- Status label: "بانتظار اتصال الهاتف" (`t.roomPreview.screen.statuses.waitingPhone`)
- QR code visible; idle countdown visible: "إعادة التشغيل تلقائياً خلال {X}"

### SSE connection opens immediately
`ScreenSessionClient` opens `GET /api/room-preview/sessions/[sessionId]/events` right after session load. This is how the screen receives all live push updates for the session lifecycle.

- `screen_connected` event logged on SSE open (5-second cooldown per session)

### What mobile sees before scan
Nothing. Customer has not opened any URL yet.

---

## 3. Mobile QR Scan + Gate

### Scan to gate
Scanning the QR opens `/room-preview/gate/[sessionId]` in the customer's browser. A multi-step form collects identity before the session starts.

### Gate flows

| Flow | Description |
|---|---|
| `customer_new` | First visit — name + phone + country; creates Customer + UserSession |
| `customer_existing` | Returning — phone lookup → confirm screen; refreshes `lastSeenAt` |
| `customer_confirm` | Confirm step for returning customer |
| `employee` | Name + employee code; creates UserSession with `role: employee` |

### Token (no secret exposed)
- On gate page load: server mints `rp-mobile-token` cookie (httpOnly, `sameSite: lax`, 90 min, HMAC-signed against `sessionId`)
- `submitGateForm` verifies this cookie before any processing
- In dev: token is optional; in prod: required

### After gate form submit (`actions.ts → submitGateForm`)
1. Events: `customer_info_submit_started` → `gate_success_before_connect` → `mobile_connect_started` → `mobile_connect_success` → `customer_info_submit_success` → `gate_completed`
2. `connectMobileToSession()` — **atomic DB claim** via `tryClaimMobileConnection`; only one phone can win
3. Redis pub/sub publishes `session_updated` → screen SSE receives instantly
4. Short-lived `gate_ok_{sessionId}` cookie set (30s, httpOnly) — skips redundant DB gate check on redirect
5. Redirect to `/room-preview/mobile/[sessionId]`

### Status transition
`waiting_for_mobile` → `mobile_connected`

### What the screen shows
- Status: "بانتظار اختيار الغرفة" (`waitingRoom`)
- Helper: "تم توصيل الهاتف ✅"
- Idle countdown cancels (mobileConnected = true)

### What mobile shows
- `useMobileSession` sets `viewState = "ready"`
- `RoomStep` rendered: upload area visible

### Auto-connect backup
`useMobileSession` also calls `/connect` automatically if `mobileConnected === false` on load. Under normal flow the gate already called connect, so this is a backup only.

---

## 4. Room Upload

### Three-step direct upload to R2
1. GET `/api/room-preview/sessions/[sessionId]/room/upload-url` → presigned R2 PUT URL
2. Mobile PUTs file directly to R2 (with progress events at each percent milestone)
3. POST `/api/room-preview/sessions/[sessionId]/room/confirm-upload` → validates, saves `selectedRoom`, transitions status

Fallback (dev / non-R2): POST `/api/room-preview/sessions/[sessionId]/room` with FormData.

Client-side `compressRoomImage()` runs before upload; skipped if file is already small.

### Status transition
`mobile_connected` → `room_selected`

### Upload events

| Event | When |
|---|---|
| `room_upload_started` | File picker fires |
| `room_direct_upload_started` | Presigned URL received |
| `room_direct_upload_r2_failed` | R2 PUT fails (403, CORS, etc.) |
| `room_direct_upload_confirmed` | Confirm endpoint succeeds |
| `room_upload_completed` | Full upload + confirm succeeds |
| `room_upload_failed` | Any error path |

### Image validation issues

| Issue | Trigger | Customer sees (mobile) | Screen | Admin |
|---|---|---|---|---|
| `IMAGE_TOO_LARGE` | HTTP 413 | "حجم الصورة كبير. يرجى اختيار صورة أصغر أو التقاط صورة جديدة." + "اختيار صورة أخرى" | No change | `IMAGE_TOO_LARGE` issue |
| `IMAGE_INVALID` | Server rejects file | "الصورة غير مناسبة للمعاينة. يرجى رفع صورة تُظهر الأرضية بوضوح." + "اختيار صورة أخرى" | No change | `IMAGE_INVALID` issue |
| `IMAGE_QUALITY_INSUFFICIENT` | AI quality check fails | Same as IMAGE_INVALID | No change | Issue opened |
| `FLOOR_NOT_VISIBLE` | Floor detection fails | Same as IMAGE_INVALID | No change | Issue opened |
| Upload 403 (presigned URL expired) | HTTP 403 | "انتهت صلاحية رابط الرفع، حاول مرة أخرى" (no CTA) | No change | None — known gap |

### What the screen shows after room upload
- Status: "بانتظار اختيار العنصر" (`waitingItem`)
- Helper: "تم اختيار الغرفة ✅"
- Room thumbnail visible in `StatusPanel`

---

## 5. Product Selection

### Product list behavior
- Products loaded server-side, passed as props to `MobileSessionClient`
- Customer browses `ProductStep` component
- Selecting fires `handleProductSelect(productId)` — UI updates **immediately** (optimistic, via `localProductId`) without waiting for API

### Debounce save
- 700ms debounce: rapid swipes don't spam the server
- Each selection: `clearTimeout(debounce)`, then `setTimeout(save, 700)`
- Before render, any pending debounce is flushed synchronously

### Status transition
`room_selected` → `product_selected`

### Events logged
- `mobile_tap_detected` (target: "product")
- `product_selected` (unthrottled — arrives immediately)
- `session_status_changed` (`room_selected` → `product_selected`)

### `product_changed`
No dedicated `product_changed` event. Re-selecting fires `product_selected` again after each debounced save.

### What the screen shows
- Status: **"تم اختيار المنتج، بانتظار بدء المعاينة"** (`waitingRender` — fixed 2026-05-04)
- Helper: "تم وضع الجلسة في قائمة انتظار المعالجة." (technically premature — render not requested yet)
- Room + product thumbnails both visible in `StatusPanel`

---

## 6. Render Request

### Customer taps "إنشاء"

**Client** (`handleCreateRender` — `useMobileSession.ts`):
1. Pending product debounce flushed + product saved if needed
2. `renderRequestInFlightRef` prevents duplicate concurrent requests
3. Events: `render_start_clicked` → `render_product_debounce_flushed` → `render_request_started`
4. POST `/api/room-preview/sessions/[sessionId]/render`

**Server** (`app/api/room-preview/sessions/[sessionId]/render/route.ts`):

| Step | What happens |
|---|---|
| Auth guard | Verifies mobile token |
| Redis render lock | `acquireRenderLock(sessionId)` — one in-flight render per session |
| Parallel reads | `getSessionById` + `getSessionScreenFields` + `checkDeviceCooldown` — one round-trip |
| Session validation | `not_found` → 404, `expired` → 410 |
| Dedupe check | SHA-256 of `roomImageUrl::productId` — returns cached 200 if inputs unchanged |
| Device cooldown | 5-min per device fingerprint (IP+UA hash) → 429 `RENDER_DEVICE_COOLDOWN` |
| Session render count | Default max 2 per session → 429 `RENDER_LIMIT_REACHED` |
| Screen budget | Daily render budget per screen → 429 `SCREEN_BUDGET_EXHAUSTED` |
| Transition | `product_selected` → `ready_to_render`; SSE published via Redis |
| `after()` blocks | `setDeviceCooldown`, `touchScreenLastRenderAt`, `saveSessionRenderHash`, `render_requested` event, analytics `render_started` |
| `after()` pipeline | `executeRenderPipeline(sessionId)` — kept alive up to 5 min (`maxDuration = 300`) |
| Response | 202 with session in `ready_to_render` |

**Render pipeline** (`runRoomPreviewRenderPipeline` — `lib/room-preview/render-service.ts`):

| Stage | Status | Event |
|---|---|---|
| `tryClaimRenderingSlot` (atomic DB update) | → `rendering` | SSE push |
| `render_started` logged | `rendering` | `render_started` |
| Create render job, update to `processing` | — | `render_job_processing` |
| `acquireGeminiSlot` (semaphore) | — | If full: `render_capacity_exceeded` + throw |
| AI provider call | `rendering` | — |
| `releaseGeminiSlot` | — | — |
| Update render job to `completed` | — | `render_completed` |
| Resolve open `RENDER_FAILED` / `RENDER_TIMEOUT` issues | — | — |
| `completeRenderingTransition` → publish SSE | → `result_ready` | SSE push |
| `after()`: analytics + customer experience save | — | — |
| **On any error** | → `failed` | `render_failed` + `RENDER_FAILED` issue + `decrementRenderCount` |

### Rate-limit events (server-side, deduped 60s per key)

| Error code | Event | Mobile message | Screen |
|---|---|---|---|
| `RENDER_DEVICE_COOLDOWN` | `render_device_cooldown` | "يمكنك طلب معاينة جديدة بعد ٥ دقائق." — no CTA | No change |
| `RENDER_LIMIT_REACHED` | `render_limit_reached` | "وصلت إلى عدد المحاولات المتاحة لهذه التجربة." — no CTA | No change |
| (semaphore full) | `render_capacity_exceeded` | Generic fallback "تعذر تحميل الجلسة" — needs fix | No change |
| `SCREEN_BUDGET_EXHAUSTED` | `screen_budget_exhausted` | "انتهى الحد اليومي لهذه الشاشة. يرجى التواصل مع الموظف المختص." — no CTA | No change |

### Render polling (mobile)
- `pollForRenderResult` starts immediately after 202
- Poll interval: 2.5s (0–30s elapsed), 5s (30–90s), 10s (90s+)
- Client timeout: `RENDER_POLL_TIMEOUT_MS = 310s`
- On timeout: `RoomPreviewRequestError("timeout")` → `retry_render` recovery message shown

### What the screen shows during render
- `ready_to_render` → "جارٍ تجهيز المعاينة..."
- `rendering` → "جارٍ إنشاء المعاينة..." with animated progress bar + time-based stage messages

---

## 7. Result Display

### When result_ready happens
1. AI returns image URL
2. `completeRenderingTransition` saves `renderResult` + sets `status: result_ready`
3. `saveSessionState` DB write
4. Redis pub/sub → SSE → screen re-renders immediately (full-screen image)
5. Mobile `pollForRenderResult` resolves on next poll

### What mobile shows
1. `pollForRenderResult` resolves → `setShowResult(true)`
2. `RenderLoadingScreen` advances to 100%, fades out after 1.4s
3. Full-screen result portal renders:
   - Full-bleed render image
   - Floating product card (name, type, barcode, "جاهز" badge)
   - Action bar: **تحميل** (download `<a>`), **مشاركة** (Web Share API), **تعديل** (`setShowResult(false)`)
4. Success toast: "تم حفظ المنتج بنجاح" (misleading copy — known gap)

### What screen shows
- SSE delivers `result_ready` → `ScreenSessionClient`: `hasRenderResult = true`
- Renders `fixed inset-0 z-50` full-screen black overlay with `object-contain` image
- `StatusPanel` is replaced entirely
- Countdown appears: "جلسة جديدة خلال {X} ثانية"

### Result lifecycle events

| Event | Source | Dedup |
|---|---|---|
| `result_displayed_screen` | screen client | `useRef` keyed by `imageUrl` — fires once per unique result |
| `result_seen_mobile` | mobile client | `useRef` keyed by `imageUrl` — fires once per unique result |

### Auto-reset countdown (screen)
- Starts immediately when `status === result_ready`
- `SCREEN_RESULT_RESET_MS = 60 seconds`
- After 60s: `router.replace(ROOM_PREVIEW_ROUTES.screenLauncher)` → screen goes to `/room-preview/screen` → launcher creates new session → new QR

---

## 8. Completed State

### Which timer controls the screen reset
**Client-side**, in `useScreenSession.ts`:
```
if (status === "result_ready") → start SCREEN_RESULT_RESET_MS (60s) timer
→ router.replace(ROOM_PREVIEW_ROUTES.screenLauncher)
```
The screen navigates to the **launcher**, which creates a fresh session and new QR. It does **not** loop back to the old QR.

### DB completion (server-side, cron)
`completeResultReadySessions()` transitions `result_ready` → `completed` after **90 seconds** of inactivity on `updatedAt`. This runs every 2 minutes. The event `session_completed` is written.

### Approximate timeline
```
t+0s    result_ready → screen displays image, 60s countdown starts on screen
t+60s   screen auto-reset → router.replace(/room-preview/screen)
t+90s   cron: result_ready → completed → session_completed event
```

### What mobile shows after session completes
- `useMobileHeartbeat` stops (TERMINAL_STATUSES includes `completed`)
- Mobile page stays on result overlay — **no automatic redirect**
- Back press: sets `viewState = "expired"` → "انتهت الجلسة" with "ابدأ جلسة جديدة" button
- **Modify button**: still visible. Tapping it closes the overlay and returns to product step. If customer then triggers render, server returns `RENDER_LIMIT_REACHED` (render count consumed).

### Mobile behavior for completed state ✅ implemented 2026-05-04
- Result image stays visible
- **Completed banner** shown above action bar:
  - Title: "تم عرض المعاينة بنجاح"
  - Message: "إذا رغبت بتجربة جديدة، يرجى العودة إلى الشاشة الرئيسية ومسح رمز QR جديد. قد تحتاج للانتظار قليلاً قبل طلب معاينة أخرى."
- **Modify / تعديل button removed** — action bar collapses to 2 columns
- Download and Share remain available
- Cooldown state is not detectable at completed time (no Redis data in session object) → generic copy chosen; copy is safe for both cooldown and non-cooldown cases

---

## 9. Heartbeat / Presence Automation

### Architecture
Both clients send heartbeats to the **same route**: `POST /api/room-preview/sessions/[sessionId]/heartbeat`

The route identifies callers by token cookie:
- Mobile: `rp-mobile-token` (httpOnly, signed)
- Screen: `rp-screen-token` (httpOnly)

### Intervals and behavior

| Client | Hook | File | Interval | Fires immediately? | Stops when |
|---|---|---|---|---|---|
| Mobile | `useMobileHeartbeat` | `features/room-preview/mobile/useMobileHeartbeat.ts` | 30s | Yes | `expired` or `completed` |
| Screen | `useScreenHeartbeat` | `features/room-preview/screen/useScreenHeartbeat.ts` | 30s | Yes | `expired` or `completed` |

### Server behavior per heartbeat
1. Identify caller (mobile / screen) from token
2. Read `presence` (status + `lastMobileSeenAt` / `lastScreenSeenAt`)
3. If terminal status → return `{ ok: false, terminal: true }` → client clears interval
4. Call `updateSessionPresence(sessionId, source)` — updates the relevant `lastSeenAt` column
5. If first ping OR gap > 75s → emit lifecycle event

### Presence events

| Event | When | Includes |
|---|---|---|
| `mobile_heartbeat_started` | First heartbeat from mobile | — |
| `screen_heartbeat_started` | First heartbeat from screen | — |
| `mobile_reconnected` | Heartbeat after gap > 75s | `gapMs` |
| `screen_reconnected` | Heartbeat after gap > 75s | `gapMs` |

### `mobile_stale_detected` (cron, observation only)
- `detectMobileStale()` in cron — every 2 min
- Matches sessions where `lastMobileSeenAt` falls in transition window `(now−75s−2min, now−75s]`
- Window advances each run → fires exactly once per stale episode
- **Does not change session status**

### `weak_connection_warning_shown` (mobile client)
- Fires when `heartbeatConnected` transitions `true → false`
- At most once per disconnection episode (previous ref tracked)
- Mobile shows amber banner: "يبدو أن الاتصال ضعيف، نحاول إعادة الاتصال..."
- Banner disappears when heartbeat recovers

---

## 10. Browser Back / Recovery Automation

### History guard
`useMobileSession` pushes a duplicate history entry on mount:
```js
window.history.pushState(null, "");
```
Every Back press is intercepted by the `popstate` handler, which immediately re-pushes to keep the guard alive for future presses.

### Recovery sequence
1. Customer presses Back
2. `back_pressed` event fired (includes `currentPath`, `currentStatus`)
3. `fetchRoomPreviewSession(sessionId)` fetches fresh state
4. Status → viewState mapping:

| Session status | viewState | Extra action |
|---|---|---|
| `expired` or `completed` | `"expired"` | `setError(null)` |
| `failed` | `"failed"` | — |
| `result_ready` + imageUrl | `"ready"` | `setShowResult(true)` — result overlay re-opens |
| Any other live status | `"ready"` | Correct step component re-renders |

5. Success toast (4s): **"أعدناك إلى الخطوة الصحيحة للحفاظ على تجربتك"**
6. `redirected_to_correct_step` event fired with `{ reason: "browser_back_recovery", status }`

On network error during re-fetch: silently stays on current view. Back guard must never crash the customer flow.

---

## 11. Screen Realtime / SSE Automation

### Connection
- URL: `GET /api/room-preview/sessions/[sessionId]/events`
- Auth: `rp-screen-token` cookie (EventSource cannot send custom headers)
- On open: server sends `comment: connected`, `retry: 3000`, initial `session_updated` with full session
- `screen_connected` event logged (5s cooldown per session)

### Why retry: 3000
SSE `retry:` directive forces the browser to reconnect after exactly 3 seconds on any disconnect. Without it, reconnect delay is browser-defined (Chrome: 3s, others: up to 30s) — critical gap on a showroom TV with brief WiFi drops.

### Live updates
Every session state change triggers `publishRoomPreviewSessionEvent()` → Redis pub/sub → SSE → screen re-renders. No polling needed under normal conditions.

### Keepalive
SSE comment `: keepalive` every 15 seconds (`SSE_KEEPALIVE_MS`) keeps the connection alive through proxies that close idle TCP connections.

### Failure and fallback

| Event | What happens |
|---|---|
| Redis subscription fails | Server closes SSE stream, `screen_disconnected` logged |
| Client `onerror` fires | `isUsingPollingFallback = true`, `screen_stale_detected` event (code: `SCREEN_NOT_UPDATING`) |
| Polling starts | `createRoomPreviewSessionPoller` — 2000ms interval, `screen_polling_started` event |
| Screen shows | "انقطعت التحديثات الفورية. سيتم استخدام التحديث الاحتياطي." + Retry button |

### SSE events logged

| Event | When |
|---|---|
| `screen_connected` | SSE stream opens (5s cooldown) |
| `screen_disconnected` | SSE stream closes for any reason |
| `screen_polling_started` | Polling fallback activates |
| `screen_stale_detected` | SSE error fires |
| `screen_received_session_update` | Every session push (transport annotated: sse / polling / initial_fetch) |

---

## 12. Cleanup / Cron Automation

### Schedule
`vercel.json`: `"*/2 * * * *"` — fires every **2 minutes**.

### Auth
| Method | Header | Secret |
|---|---|---|
| Manual (cURL, dev) | `x-cleanup-secret: <value>` | `CLEANUP_SECRET` env var |
| Vercel Cron (production) | `Authorization: Bearer <token>` | `CRON_SECRET` env var |
| Local dev (no secrets configured) | None required | Both env vars absent |

Uses constant-time comparison (`timingSafeEqual`) to prevent timing attacks.

### Execution order
1. `detectStuckSessions()` — runs first (sequential)
2. `Promise.all([failStuckRenderingSessions, completeResultReadySessions, expireIdleWaitingSessions, expireOldSessions, detectMobileStale])` — parallel

### Cleanup functions

| Function | Threshold | Status change | Issue opened | Event fired |
|---|---|---|---|---|
| `failStuckRenderingSessions` | `rendering` / `ready_to_render` stuck > **7 min** | Yes → `failed` | `RENDER_TIMEOUT` | `render_timeout` |
| `completeResultReadySessions` | `result_ready` older than **90s** | Yes → `completed` | — | `session_completed` |
| `expireIdleWaitingSessions` | `waiting_for_mobile` idle > **1 min** | Yes → `expired` | `SESSION_STUCK` | `session_expired` |
| `expireOldSessions` | `expiresAt <= now` (any non-terminal) | Yes → `expired` | — | `session_expired` |
| `detectMobileStale` | `lastMobileSeenAt` in stale window (75s threshold, 2 min interval) | **No** | — | `mobile_stale_detected` |

### `detectStuckSessions` — issue detection only

Scans up to 250 live sessions, looks at recent events, opens issues without touching session status:

| Issue | Condition | Threshold |
|---|---|---|
| `QR_OPENED_NO_MOBILE_CONNECT` | `waiting_for_mobile` + `qr_opened` exists + no `mobile_page_loaded` | 2 min |
| `SESSION_STUCK` | `waiting_for_mobile` + no `mobile_page_loaded` at all | 2 min |
| `MOBILE_OPENED_NO_PROGRESS` | `mobile_page_loaded` exists, no upload/product/render progress | 2 min |
| `ROOM_UPLOAD_STUCK` | `room_upload_started` exists, no `room_upload_completed` or `_failed` | 90s |
| `RENDER_TIMEOUT` | `render_started` exists, no `render_completed/failed/timeout` | 7 min |
| `SESSION_STUCK` | Any non-`waiting_for_mobile` live session unchanged | 10 min |

---

## 13. Admin Dashboard / Diagnostics

### What admins can see today
No dedicated admin UI exists in the codebase. All observability is in two DB tables. Requires direct DB access or a future admin dashboard.

### `SessionEvent` timeline
Each row: `sessionId`, `source`, `eventType`, `level`, `statusBefore`, `statusAfter`, `code`, `message`, `metadata` (JSON), `timestamp`.

### `SessionIssue` list
Each row: `sessionId`, `type`, `severity`, `status` (open/resolved/ignored), `customerMessageKey`, `adminMessage`, `recommendedAction`.

### Key observable fields

| Field | Source | What it tells you |
|---|---|---|
| `session.status` | DB | Current lifecycle stage |
| `session.lastMobileSeenAt` | DB (heartbeat) | When mobile last phoned home |
| `session.lastScreenSeenAt` | DB (heartbeat) | When screen last phoned home |
| `session.expiresAt` | DB | When session auto-expires |
| `session.renderResult` | DB | Image URL + model name + `generatedAt` |
| `render_started` | renderer | When AI pipeline began |
| `render_completed` | renderer | When result was ready + which model was used |
| `render_failed` | renderer | Failure cause |
| `result_seen_mobile` | mobile client | Customer actually viewed the result |
| `result_displayed_screen` | screen client | Screen displayed the result |
| `back_pressed` / `redirected_to_correct_step` | mobile | Back navigation recovery detail |
| `mobile_stale_detected` | server cron | Mobile disappeared mid-session |
| `mobile_reconnected` / `screen_reconnected` | server heartbeat | Connection drop + resume, with `gapMs` |
| `gate_completed` | server gate | Customer info collected (role, new/existing) |
| `render_device_cooldown` | server | Device hit 5-min cooldown |
| `render_limit_reached` | server | Session hit max render count |
| `screen_budget_exhausted` | server | Screen daily budget used up |

### What admin cannot yet see
- No live admin dashboard — DB queries only
- No aggregated metrics (renders/day, avg duration, success rate)
- No alert system — issues opened silently, no notification
- No UI to force-expire or reset a session
- `render_capacity_exceeded` is observable in timeline but not surfaced clearly to customer

---

## 14. Full Timeline Example

### Happy path — successful render

```
[screen]  ScreenLauncherClient mounts at /room-preview/screen
[server]  session_created (status: waiting_for_mobile)
[screen]  screen_session_created
[screen]  screen_connected (SSE opens)
[screen]  QR code visible + "بانتظار اتصال الهاتف"
[screen]  idle countdown starts: 5:00

[customer scans QR]
[mobile]  gate page loads, rp-mobile-token cookie set
[server]  customer_info_submit_started → gate_completed
[server]  mobile_connect_started → mobile_connect_success
[server]  session_status_changed (waiting_for_mobile → mobile_connected)
[screen]  SSE: session_updated → "بانتظار اختيار الغرفة"
[screen]  idle countdown cancels

[mobile page loads]
[server]  mobile_heartbeat_started (first heartbeat)
[server]  screen_heartbeat_started (first heartbeat)
[mobile]  RoomStep shown

[customer picks room photo]
[mobile]  room_upload_started → room_direct_upload_started
[mobile]  PUT to R2 (with % progress)
[mobile]  room_direct_upload_confirmed → room_upload_completed
[server]  session_status_changed (mobile_connected → room_selected)
[screen]  SSE → "بانتظار اختيار العنصر"

[customer selects product]
[mobile]  product_selected (debounced 700ms)
[server]  session_status_changed (room_selected → product_selected)
[screen]  SSE → "تم اختيار المنتج، بانتظار بدء المعاينة"

[customer taps "إنشاء"]
[mobile]  render_start_clicked → render_request_started
[server]  rate limit checks pass
[server]  session_status_changed (product_selected → ready_to_render)
[screen]  SSE → "جارٍ تجهيز المعاينة..."
[server]  render_requested (after())
[mobile]  render_request_success; RenderLoadingScreen shown; pollForRenderResult starts

[server pipeline in after()]
[server]  tryClaimRenderingSlot → rendering
[screen]  SSE → "جارٍ إنشاء المعاينة..."
[server]  render_started → render_job_processing
[server]  acquireGeminiSlot (succeeds)
[server]  AI provider returns image (~30–120s)
[server]  render_completed
[server]  completeRenderingTransition → result_ready
[screen]  SSE → result_ready; full-screen image overlay rendered
[screen]  result_displayed_screen (once, deduped by imageUrl)
[screen]  60s countdown starts: "جلسة جديدة خلال {X} ثانية"

[mobile polls]
[mobile]  pollForRenderResult resolves (result_ready)
[mobile]  setShowResult(true); RenderLoadingScreen → 100% → fade
[mobile]  result_seen_mobile (once, deduped by imageUrl)
[mobile]  Result overlay: تحميل / مشاركة / تعديل buttons

[screen auto-reset at t+60s]
[screen]  router.replace(/room-preview/screen)
[screen]  Branded loading screen → new session created → new QR

[cron at ~t+90s]
[server]  completeResultReadySessions: result_ready → completed
[server]  session_completed
[mobile]  heartbeat stops (terminal status received)
```

---

### Failure examples

#### Customer inactive — never scans QR
```
session_created → waiting_for_mobile
[cron t+2min]  detectStuckSessions → SESSION_STUCK issue (or QR_OPENED_NO_MOBILE_CONNECT if qr_opened)
[cron t+2min]  expireIdleWaitingSessions → expired; session_expired event
[screen]       SSE → expired; errorCountdown (10s) → router to launcher
```

#### Weak connection then reconnect
```
[mobile heartbeat fails for ~75s]
  weak_connection_warning_shown (client, on first transition)
  mobile amber banner: "يبدو أن الاتصال ضعيف، نحاول إعادة الاتصال..."
[cron run catches stale window]
  mobile_stale_detected (observation only, no status change)
[heartbeat succeeds again]
  mobile_reconnected (with gapMs: ~90000)
  banner disappears; session continues normally
```

#### Render failed
```
[pipeline throws error]
  markSessionAsFailed → status: failed
  RENDER_FAILED issue opened; render_failed event; decrementRenderCount
[screen]  SSE → "فشلت المعالجة"; 15s countdown; router to launcher
[mobile]  pollForRenderResult resolves (failed)
  Recovery: "المعالجة تستغرق وقتاً أطول من المعتاد. أعد المحاولة." + "إعادة المعالجة"
```

#### Device cooldown
```
[mobile taps render; device used in last 5 min]
  checkDeviceCooldown → limited: true
  after(): render_device_cooldown event (deduped 60s/device)
  Returns 429 RENDER_DEVICE_COOLDOWN
[mobile]  "يمكنك طلب معاينة جديدة بعد ٥ دقائق." — no button
  Session stays product_selected; customer must wait
```

#### Screen budget exhausted
```
[screen has used all daily renders]
  checkAndIncrementScreenBudget → not allowed
  after(): screen_budget_exhausted event (deduped 60s/screen)
  Returns 429 SCREEN_BUDGET_EXHAUSTED
[mobile]  "انتهى الحد اليومي لهذه الشاشة. يرجى التواصل مع الموظف المختص." — no button
  Staff must reset screen budget in DB/config
```

#### Browser Back recovery
```
[customer presses Back mid product-selection]
  popstate → handler re-pushes; back_pressed event
  fetchRoomPreviewSession → status: product_selected
  viewState: ready; ProductStep shown; redirected_to_correct_step event
  Toast: "أعدناك إلى الخطوة الصحيحة للحفاظ على تجربتك" (4s)

[customer presses Back after result_ready]
  fetchRoomPreviewSession → status: result_ready
  setShowResult(true) → result overlay reopens

[customer presses Back after completed]
  fetchRoomPreviewSession → status: completed
  viewState: expired → "انتهت الجلسة" + "ابدأ جلسة جديدة"
```

---

## 15. Final Gaps / Recommendations

### Fully covered ✅

| Area | Coverage |
|---|---|
| Session lifecycle (11 statuses, all transitions) | State machine with guards in `session-machine.ts` |
| SSE realtime + polling fallback | Redis pub/sub + 2s polling with `screen_not_updating` detection |
| Heartbeat presence for mobile + screen | 30s interval; `lastMobileSeenAt` / `lastScreenSeenAt` in DB |
| Render pipeline (semaphore, dedup, rate limits) | Device cooldown + session limit + screen budget |
| Cleanup cron (expiry, stuck render, completion) | Every 2 min; all 5 functions |
| Stuck session detection (5 issue types) | `detectStuckSessions` on every cron run |
| Browser Back guard | `popstate` intercept + fresh session re-fetch |
| All 6 customer recovery messages | Clear Arabic copy, correct CTAs |
| Gate flow (new / existing / employee) | Full token + atomic connect chain |
| Result seen/displayed events | `useRef` dedup by `imageUrl` on both clients |
| Screen auto-reset (result 60s, failed 15s, idle 5min, error 10s) | 4 constants in `constants.ts` |

### Partially covered ⚠️

| Area | Gap |
|---|---|
| `render_capacity_exceeded` customer message | Mobile shows generic "تعذر تحميل الجلسة" — needs typed `RENDER_CAPACITY_EXCEEDED` error code |
| `completed` state on mobile | ✅ fixed 2026-05-04 — completed banner + Modify removed |
| `expiredLink` Arabic copy | Technical jargon ("hot reload", "server restart") — inappropriate in showroom |
| Result success toast | Shows "تم حفظ المنتج بنجاح" not "تم إنشاء المعاينة بنجاح" |
| Signed URL expired (403 on upload) | No CTA button — customer stranded without guidance |
| `product_selected` helper message | "تم وضع الجلسة في قائمة انتظار المعالجة" is premature (render not requested yet) |

### Needs implementation (before next customer milestone)

| Feature | Priority |
|---|---|
| Admin dashboard UI | High — today requires raw DB queries to review session health |
| Mobile "completed" state message | ✅ fixed 2026-05-04 |
| `render_capacity_exceeded` typed error code | Medium — current fallback is wrong |
| `qr_opened` event on gate page load | Low — `stuck-detection.ts` checks for it but nothing fires it |
| Duplicate tab protection message | Low — second phone fails `tryClaimMobileConnection` silently |

### Can wait

| Item | Reason |
|---|---|
| i18n for hardcoded Arabic strings | Functional; showroom is Arabic-only for now |
| Back navigation toast i18n | Edge case; only fires on Back press |
| `product_selected` helper message accuracy | Status label (`waitingRender`) is now correct; helper is secondary |
| Render stage messages i18n | Hardcoded but consistent and correct |
| Screen budget admin reset UI | Low frequency; manual DB update is acceptable for now |
