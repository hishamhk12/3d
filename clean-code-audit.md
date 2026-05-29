# Executive Summary

## Overall Clean Code Score

**6.5 / 10**

A real-world platform that is functioning well in production, with strong test coverage on critical paths, a coherent session state machine, and several recent refactors that are visibly improving structure. It loses points for three god modules (`render-service.ts`, `gemini-provider.ts`, `useMobileSession.ts`), heavily interleaved diagnostics, and a sprawling event vocabulary (≈172 `trackSessionEvent` call sites, dozens of distinct event-type strings). The codebase is well above industry average for engineering rigor — but is one or two more layers of god-module decomposition away from being a textbook-clean platform.

## Project Strengths

1. **State machine is pure and well-tested.** `lib/room-preview/session-machine.ts` is the single best module: pure transitions, no I/O, 539-line unit-test file covering every transition and lock condition.
2. **Layered server architecture.** Routes call services, services call repositories, repositories call Prisma. The render route's deliberate bypass of the service layer is documented.
3. **Strong test coverage on critical paths.** 271 tests / 16 files. Render pipeline, Gemini provider serial path, diagnostics schema, route-handler safety, validators, and session-machine all have first-class coverage.
4. **Excellent typed-error vocabulary.** `GeminiTimeoutError`, `AspectRatioMismatchError`, `RoomPreviewSessionNotFoundError`, `RoomPreviewSessionExpiredError`, `RoomPreviewSessionTransitionError`, `RoomPreviewUploadError`, `RoomPreviewRequestError` all carry typed `code` fields used uniformly by callers.
5. **Self-healing distributed primitives.** Redis-backed semaphore with ZSET-and-expiry (`gemini-semaphore.ts`), atomic check-and-claim for rendering slot via DB conditional update, SSE channel ref-counting.
6. **Recent extraction work is paying off.** The Gemini provider has been split into 6 focused modules (errors, config, image utils, client, retry utils, provider); the render route now has 3 utility companions; the unused parallel branch has been excised.
7. **Comments are above average.** Most non-obvious decisions carry a "why" comment (e.g., "skip dedup when session is already at result_ready: the customer pressed تعديل") — these are durable design notes, not narration.

## Project Weaknesses

1. **`useMobileSession.ts` is a 1,273-line god hook** with 4 `eslint-disable react-hooks/exhaustive-deps`, mixing UI state, networking, polling, browser-back recovery, upload pipeline, render orchestration, and diagnostics in a single closure.
2. **`render-service.ts::runRoomPreviewRenderPipeline` is one 270-line try/catch** carrying the success path, the failure path, three rollback branches, six diagnostic event emissions, and four `after()` schedulings.
3. **`gemini-provider.ts` is still 923 lines** post-extraction, dominated by a single `render()` method that interleaves the serial retry loop with `trackSessionEvent` calls, diagnostics-snapshot construction, and storage upload.
4. **Diagnostics are not a layer — they're a cross-cutting concern leaking into every module.** 172 `trackSessionEvent` / `trackClientSessionEvent` call sites; dozens of event-type strings exist only as inline literals.
5. **The event-type vocabulary is undocumented and ungrouped.** Strings like `gemini_attempt_timeout`, `render_branch_resolved`, `render_diagnostics_snapshot`, `mobile_excessive_polling_detected`, `weak_connection_warning_shown` are scattered across files with no central registry.
6. **47 `console.*` calls in production source** (mostly `console.info`/`console.error`) sit alongside structured pino logging — two competing log channels.
7. **Module-level mutable `Map`s for rate-limit dedup don't scale horizontally** (`render-route-cooldowns.ts`, `events/route.ts`'s `screenConnectCooldown`) — they implicitly assume a single Vercel instance.
8. **Per-render env-var re-reads** (28 `process.env.*` in `gemini-provider.ts`) duplicate `gemini-config.ts` semantics at runtime, with their own `RESOLVED_CONFIG` snapshot and bespoke "stale module constant" warning emission.

---

# Architecture Review

## Positive Findings

- **Route → Service → Repository layering** is consistently applied for the session subdomain. `app/api/.../route.ts` only orchestrates HTTP concerns; `lib/room-preview/session-service.ts` owns the business transitions; `lib/room-preview/session-repository.ts` owns Prisma calls.
- **Render provider behind an interface** (`lib/room-preview/render-providers/types.ts`). The render service depends on `renderRoomPreviewWithProvider`, not on Gemini directly. A stub `ai-provider.ts` exists demonstrating the interface boundary.
- **Distributed concerns isolated**: Redis semaphore, SSE pub/sub, render-lock TTL all live in dedicated modules.
- **State machine is purely functional and testable** — no side effects, fixed inputs/outputs.
- **Server/client boundary is enforced via `import "server-only"`** consistently across server modules.

## Negative Findings

- **God modules** at every layer:
  - `useMobileSession.ts` — 1,273 lines (client orchestration)
  - `render-service.ts` — 459 lines, single function dominates
  - `gemini-provider.ts` — 923 lines, single `render()` method dominates
  - `room/route.ts` — 401 lines (HTTP handler with deeply nested upload-error branches)
  - `MobileSessionClient.tsx` — 474 lines (presentation + lifecycle + browser hooks + diagnostics)
- **The Gemini provider knows about diagnostics.** It imports `trackSessionEvent` and emits 6+ event types directly. A provider should not have a session-events dependency — that violates the provider abstraction.
- **`gemini-image-utils.ts` keeps the parent logger name (`getLogger("gemini-provider")`)** as a documented hack to preserve log output. This pins the modules together and prevents independent log filtering.
- **Render route bypasses the service layer deliberately** for a "one DB write instead of read+write" optimization. The comment is honest, but two code paths now do session transitions: `selectRoomForSession` → `persistTransition` in the service, vs the route applying `markReadyToRenderTransition` and calling `saveSessionState` directly. Future changes to transition semantics have to be made in both places.
- **Module-level mutable state** in serverless code:
  - `renderLimitWarnCooldown`, `deviceCooldownWarnMap`, `screenBudgetWarnMap` (`render-route-cooldowns.ts`)
  - `screenConnectCooldown` (`events/route.ts`)
  - `roomPreviewSessionEventBus` on globalThis (`session-events.ts`)
  - `roomPreviewRateLimitBypassLogged` on globalThis (`rate-limit-bypass.ts`)
  - `__pinoRootLogger` on globalThis (`logger.ts`)
  
  Some are defensible (logger singleton); the rate-limit Maps are not — they implicitly assume one Lambda instance, which contradicts the rest of the architecture (Redis semaphore, atomic DB claim, SSE ref-counting).
- **Two cleanup pipelines for stuck renders**: `lib/room-preview/render-job-cleanup.ts` (cron-driven, marks `processing` → `failed`) and `lib/room-preview/render-service.ts::recoverStuckRenderJob` (called from render route on retry). They share thresholds but no code.
- **`session-cleanup.ts` has five concurrent operations** in `app/api/room-preview/cleanup/route.ts` — `failStuckRenderingSessions`, `completeResultReadySessions`, `expireIdleWaitingSessions`, `expireOldSessions`, `detectMobileStale`. They run via `Promise.all`, but their ordering is documented as significant (must run in dependency order). Implicitly relies on Prisma serializability.

> Checklist match: Understandability, Simplicity, Consistency, Source structure, Objects/data — modules too large.

---

# Naming Review

## Positive Findings

- **Domain terms are stable and consistent.** `session`, `screen`, `render`, `room`, `product`, `diagnostics`, `cooldown`, `budget` mean the same thing everywhere.
- **Status enum literals are central** (`ROOM_PREVIEW_SESSION_STATUSES` in `types.ts`) and reused via TypeScript narrowing.
- **Error class naming is consistent**: `Foo + Error` suffix; type guard companions named `isFooError`.
- **Test seam names communicate intent**: `setupSuccessPath()`, `setupFailurePath()`, `eventsOfType()`.

## Negative Findings

- **`getRoomPreviewSession` vs `fetchRoomPreviewSession`**: identical purpose, the first is the server service, the second is the client SDK. The verbs `get` and `fetch` are not domain-significant — they distinguish runtime context, which is implicit from the call site. Discoverability suffers in a global search.
- **`session-events.ts` (server) / `session-events-client.ts` (client)** and the same pattern for `session-diagnostics.ts`/`session-diagnostics-client.ts`. The `-client` suffix is treated as the differentiator, but is easy to miss in an import block. Files searched via `grep` produce paired hits that are hard to disambiguate.
- **`tryClaimRenderingSlot` vs `acquireRenderLock`**: both gate rendering, both return acquired/not. One is DB-conditional-update, the other is Redis. Names give no hint about that.
- **`MobileSessionViewState` and `ScreenSessionViewState`** are independent types in independent files with identical literal members `"loading" | "ready" | "not_found" | "expired" | "failed"`. Same concept, different declarations.
- **`saveSessionState` vs `saveSessionRenderHash` vs `touchScreenLastRenderAt`** — three "save" verbs with three different conventions: the first takes a partial session, the second takes two values, the third is a side-effecting update by id.
- **`shouldEmitRateLimitEvent` returns `true` if the event SHOULD fire.** The boolean semantics are correct, but the function also mutates the map. A reader expects `should*` predicates to be pure. The name doesn't reveal the side effect.
- **`getViewStateFromError`** exists in both `mobile-session-utils.ts` and `features/room-preview/screen/useScreenSession.ts`, with different return-state unions. Same name, different contracts.
- **Magic strings as event types.** `"gemini_attempt_timeout"`, `"render_branch_resolved"`, `"render_diagnostics_snapshot"`, `"mobile_excessive_polling_detected"`, `"failure_recovery_ui_shown"` — used as primary identifiers but live only as inline string literals at the call site. No `RoomPreviewEventType` union.
- **`code:` field carries inconsistent fallbacks.** Across diagnostics events the `code` field can be `null`, `"UNKNOWN"`, `"NETWORK_INTERRUPTED"`, `"RENDER_TIMEOUT"`, `"RENDER_FAILED"`, or the request error code itself. No declared discriminator.

> Checklist match: Naming, Consistency, Magic numbers (magic strings analogue).

---

# Function Review

## Positive Findings

- **State-machine functions are textbook** — `connectMobileTransition`, `selectRoomTransition`, `selectProductTransition`, `markReadyToRenderTransition`, `startRenderingTransition`, `completeRenderingTransition`, `failRenderingTransition` are all small, single-purpose, pure.
- **Tiny helpers were recently extracted**: `getErrorMessage`, `getRequestErrorCode`, `hasRequestErrorCode`, `isCachedRenderHit`, `cachedRenderResponse`, `sessionNotFoundResponse`, etc. — these are exactly the right granularity.
- **Repository functions are mostly one-line Prisma wrappers** with explicit `select:` clauses that document their contract.

## Negative Findings

- **`runRoomPreviewRenderPipeline`** (`lib/room-preview/render-service.ts:120-396`) — 276 lines, one try/catch:
  - 8 distinct responsibilities: claim slot, fetch session + screen fields, publish SSE, emit `render_started`, create + transition render job, acquire+release semaphore, call provider, persist result, emit `render_completed` + `render_timing_summary`, schedule analytics in `after()`, save customer experience in `after()`.
  - The catch block does 5 more: update render job to failed, mark session failed, open `RENDER_FAILED` issue, emit `render_failed` + `render_timing_summary`, decrement render count, decrement screen budget, emit `render_failed` analytics in `after()`.
  - Has 3 separate timing variables (`tSetupDone`, `tProviderDone`, `tSaved`) tracked across both happy and failure paths.
- **`geminiRoomPreviewRenderProvider.render`** (`lib/room-preview/render-providers/gemini-provider.ts:175-919`) — 744 lines. The serial retry loop is nested 4 levels deep (`for model { for attempt { try { ... } catch { multiple branches } } }`) and contains the `render_branch_resolved` event, `render_config_mismatch` warning, "warn when no floor polygon" branch, "build diagnostics snapshot" block (60 lines, lines 1030–1085 of pre-refactor history), and the `render_timing_summary` emission (50+ lines) inside the success branch.
- **`handleCreateRender`** (`features/room-preview/mobile/useMobileSession.ts:1018-1232`) — 215 lines. The catch block alone is ~80 lines of `if (hasRequestErrorCode(...)) { ... } else if (...) { ... } else { ... }` cascade, each branch setting a different Arabic error string and emitting a different `failure_recovery_ui_shown` reason. After the cascade, an unconditional second `trackClientSessionEvent` call emits `render_timeout` or `render_failed`.
- **`handleFileSelection`** (`useMobileSession.ts:693-867`) — 175 lines. Mixes: compress, request signed URL (with 501-fallback), PUT to R2, confirm direct upload, AND legacy FormData fallback, AND failure branch with 413-vs-403-vs-generic message selection, AND a separate `room_upload_failed` event.
- **`render/route.ts` POST handler** is 311 lines (after recent extraction). Despite 11 numbered sections, the catch block still does its own openSessionIssue + log.error + response building for both transition errors and unexpected errors.
- **Flag arguments survive in private helpers**: e.g., `expireIdleWaitingSessions(idleAfterMs = 1 * 60 * 1000)`, `failStuckRenderingSessions(stuckAfterMs = 7 * 60 * 1000)`, `completeResultReadySessions(displayAfterMs = 90 * 1000)` — defaults make the call site silent about the configured threshold.

> Checklist match: Function design, Arguments, Source structure.

---

# Module Boundary Review

## Positive Findings

- **`session-machine.ts` has zero outbound dependencies** beyond types and a transition-error class. This is the cleanest boundary in the project.
- **`session-repository.ts`** depends on Prisma alone; service-level concerns (events, diagnostics) live in `session-service.ts`.
- **`render-providers/types.ts`** defines the provider interface (`name`, `render(request)`), and both implementations conform.
- **The recent split of the Gemini provider** introduced clear sub-boundaries: errors / config / image-utils / client / retry-utils.

## Negative Findings

- **The provider interface is leaky**: the Gemini provider imports `trackSessionEvent` and emits domain events. A future alternative provider would have to replicate that emission protocol or callers would lose diagnostics. The interface declares no `onEvent` callback or telemetry contract.
- **`gemini-image-utils.ts` re-uses the parent logger name (`"gemini-provider"`)** by explicit design to preserve log output. This is the inverse of what a module boundary should do — modules should own their own log identity.
- **The Gemini provider re-reads env vars at request time** even though `gemini-config.ts` exists. This works around webpack inlining but means the module boundary is honoured only at module load, not at request time. The provider also keeps its own `RESOLVED_CONFIG` block referring to many config-module constants, duplicating its surface area.
- **The render route reaches into `session-repository.ts` directly** (calls `getSessionById`, `saveSessionState`, `tryIncrementRenderCount`, `getSessionScreenFields`, `decrementRenderCount`) instead of going through `session-service.ts`. Justified by the comment as a perf optimization, but in clean-architecture terms the layer is broken: the route now knows the persistence shape and the in-flight transition semantics.
- **The mobile diagnostics layer is split across three modules** (`session-diagnostics-client.ts`, `useMobileDiagnostics.ts`, the 41-call-site usage inside `useMobileSession.ts` + `MobileSessionClient.tsx`) and each has its own dedup/throttle vocabulary.
- **Render-route cooldown Maps share state with the route handler closure** by being module-level — this is a single-file design that lifts to file-level once it crosses 60s windows. The Maps are not exposed as a service abstraction.
- **Session events have a global fan-out channel (`GLOBAL_EVENTS_CHANNEL`) declared but unused.** Publish-only with no subscriber is dead code at the API boundary level.

> Checklist match: Law of Demeter, Dependency injection, Source structure.

---

# React / Next.js Review

## Positive Findings

- **Server/client boundary is correctly enforced** via `"use client"` and `import "server-only"`. Tests have an alias stub for `"server-only"` to allow Node-side imports.
- **`useDebugLog`** is a thoughtful design: production no-op, dev-mode log accumulator, stable callback identity.
- **`useMobileHeartbeat`** is well-isolated — 71 lines, single responsibility, clean cleanup on unmount.
- **`MobileSessionClient`** lifts the browser-lifecycle hook into its own internal `useMobileBrowserLifecycle` — small, named, testable in principle.
- **`pollForRenderResult` and `createRoomPreviewSessionEventsClient`** are framework-agnostic primitives consumed by both mobile and screen hooks — good factoring.

## Negative Findings

- **God hook**: `useMobileSession.ts` is 1,273 lines and returns 31 fields. The return shape is a "kitchen sink" interface: i18n bundle (`t`, `locale`, `dir`, `formatMessage`), UI state (`viewState`, `isConnecting`, `isSavingRoom`, `isSavingProduct`, `showResult`, `roomSaveStatusLabel`, ...), derived state (`isConnected`, `hasSavedRoom`, `hasSavedProduct`, `localProductId`, `sectionAlignClass`, ...), 6 handlers, heartbeat output, and 2 debug fields. A consumer cannot tell which subset they actually use without scanning the file.
- **4 `eslint-disable react-hooks/exhaustive-deps`** in `useMobileSession.ts` — at lines 220 (mount-only effect), 304 (browser-back guard), 492 (initial load), 549 (render polling resume). Each disables a real dependency tracking concern. Replacing the disables would either change behavior or require restructuring.
- **`MobileSessionClient.tsx` is 474 lines** with 4 distinct view branches (`viewState === "loading" | "not_found" | "expired" | "failed"`), a fallback for "no session data", and the main rendering tree which itself has 6 conditional sub-trees (`shouldUseProductList`, `shouldShowProductQrStep`, `shouldShowLegacyProductStep`, `shouldShowResultStep`, plus restart/error/success states).
- **State-management duplication**: `useMobileSession` keeps its own session in `useState`, an `sessionRef`, and a separate `isSavingProductRef`/`renderRequestInFlightRef`/`restartDoneRef`/`productAbortRef`/`productSavePromiseRef`/`resultSeenRef`/`prevHeartbeatConnectedRef` — 8 refs alongside ~12 useStates and one custom mutator (`setIsSavingProduct = (v) => { isSavingProductRef.current = v; _setIsSavingProduct(v); }`). The shadowing isn't bad per se but signals state that is over-modeled.
- **Browser-back popstate handler** (`useMobileSession.ts:248-330`) is 80 lines of nested fetch+state-mutate with its own error classification (`isRoomPreviewRequestError(err) && err.code === "not_found" | "expired"`) inline rather than via the centralized `getViewStateFromError`.
- **`MobileSessionClient.tsx` `onClick` of "إعادة المحاولة" button is a 40-line inline arrow function** with `if (recoveryMessage.ctaIntent === "...")` branches — duplicate of the dispatch table that should arguably live in the hook.
- **`shouldShowResultStep`** depends on 5 boolean expressions; `shouldShowProductQrStep` depends on 6. The branching logic is reverse-engineered through `&&` chains rather than enumerated in a `derive(view)` function.

> Checklist match: Understandability, Function design, Source structure, React component design.

---

# Session State Machine Review

## Positive Findings

- **`session-machine.ts` is the single best module in the project.** All transition functions are pure, all throw a typed `RoomPreviewSessionTransitionError` with `currentStatus`. 539-line unit-test file covers every transition.
- **Status enum is centrally defined** (`ROOM_PREVIEW_SESSION_STATUSES` in `types.ts`).
- **Lock predicates are explicit**: `isLockedStatus`, `assertAllowedStatus`, `assertValidSelectedRoom`, `assertValidSelectedProduct`.
- **The `"تعديل"` re-render flow** allowing `result_ready` → `product_selected` is documented inline and has its own positive test.

## Negative Findings

- **The enum lists `"created"`** as the first value, but `createRoomPreviewSessionState` returns `"waiting_for_mobile"`. The `"created"` value is referenced by `LIVE_STATUSES` and `STATUS_GROUP` but is never actually set by any caller. Dead state.
- **The `"completed"` status is only set by the cleanup cron** (`completeResultReadySessions`), not by any state transition function. There is no `completeSessionTransition`. This breaks the "all status changes go through the machine" invariant by making the cleanup script a second writer.
- **`isEffectivelyExpired`** treats `expiresAt === null` as expired. Combined with `createRoomPreviewSessionState` setting `expiresAt: null`, fresh sessions appear expired until `createSession` assigns a real timestamp. A subtle invariant that test fixtures must repeatedly remember (witness: `tests/integration/render-route-safety.test.ts` sets `expiresAt: new Date(Date.now() + 24h).toISOString()` to work around this).
- **Status guards are duplicated** across the codebase:
  - `session-machine.ts::isLockedStatus`
  - `session-status.ts::LIVE_STATUSES` / `SUCCESS_STATUSES` / `CLOSED_STATUSES` / `PROBLEM_STATUSES` / `STATUS_GROUP`
  - `session-polling.ts::TERMINAL_SESSION_STATUSES`
  - `useScreenSession.ts::STATUS_RANK`
  - `useMobileHeartbeat.ts::TERMINAL_STATUSES`
  
  Each tracks its own subset of statuses, with no shared definition of "terminal" / "live" / "completed".
- **The state machine has no public "all transitions" table.** Discovering "from X you can go to Y" requires reading every transition function. A reachability graph would be a one-page document.
- **Transition error messages are partially in Arabic** (`markReadyToRenderTransition` throws "الرجاء اختيار منتج قبل البدء بالتصميم.") and partially in English ("This session can no longer accept a mobile connection."). Inconsistent for an i18n-friendly app.

> Checklist match: Consistency, Naming, Source structure, Comments.

---

# Render Pipeline Review

## Positive Findings

- **Atomic check-and-claim via DB conditional update** (`tryClaimRenderingSlot`) replaces an earlier `globalThis` guard. This is the right primitive for serverless.
- **Per-attempt timeouts are clamped** (`5–120 s` first, `30–240 s` retry) and the IIFEs preserve safe defaults when env vars are missing.
- **Typed errors carry `failureReason`** that the render service stores verbatim on the failed job — no string parsing.
- **Recent removal of the unused parallel branch** eliminated ≈200 lines of dead code, plus its config flags, while serial behavior remained unchanged.
- **Smart polling** (`session-polling.ts::getSmartPollIntervalMs`) varies the interval by status (4s for waiting, 1s for rendering, 4× multiplier when tab hidden).
- **Aspect-ratio guard with two thresholds** (warn at 2%, reject at 5%) is documented inline and tested.

## Negative Findings

- **`runRoomPreviewRenderPipeline` carries the entire pipeline in one function**, with three named-but-shared timing variables. There is no `try/finally` split between "do the render" and "emit diagnostics" — the diagnostic emission is interleaved with state mutation.
- **The render route + render service both transition session status**: route does `markReadyToRenderTransition`; render service does `completeRenderingTransition` / `failRenderingTransition` / `markSessionAsFailed`. There is no single "transition" entry point. `markSessionAsFailed` quietly catches `RoomPreviewSessionTransitionError` and ignores it.
- **`recoverStuckRenderJob` lives in `render-service.ts`** but is called by the render route to allow a stuck `"rendering"` session to retry. The route now has to know about an internal recovery API; the render service no longer has a clean public surface (`executeRenderPipeline` + `recoverStuckRenderJob`).
- **Three timing snapshots are emitted** for the same render: `render_timing` (log), `render_timing_summary` (event), `render_diagnostics_snapshot` (event). The fields differ slightly. The provider emits the snapshot; the render service emits a different summary; the log entries don't have a stable shape.
- **The provider's failure-diagnostics block** (in `runParallelGeminiAttempts.catch`, now removed) was duplicated across success and failure paths with subtle structural differences. The current serial path still has a 60-line `snapshotMeta` constructor inside the success branch.
- **Render failure paths swallow errors with `.catch(() => undefined)`** for `updateRenderJob`, `markSessionAsFailed`, `decrementRenderCount`, `decrementScreenBudget`, `trackSessionEvent`. The intent ("don't let cleanup failure cascade") is right, but the swallowed errors are never inspected and don't even emit a `cleanup_failed_after_render_failure` event.
- **The pipeline writes to the DB at least 6 times** per successful render (claim slot → save processing → update with result → resolveSessionIssue×2 → save result_ready → after() saves customer experience). No batching or transactional boundary.
- **`gemini-provider.ts` lazily imports `sharp` inside the render path** (`const { default: sharp } = await import("sharp")`) twice — once in `loadAndPrepareImage` (image utils), once in the provider for PNG conversion. The dynamic import is duplicated.

> Checklist match: Function design, Root cause clarity, Source structure, Code smells (rigidity).

---

# Error Handling Review

## Positive Findings

- **Typed errors with `code` discriminators** are the standard pattern across the entire codebase. Type guards (`isRoomPreviewSessionNotFoundError`, `isRoomPreviewRequestError`, etc.) are co-located with the error classes.
- **Render service catches and stores `failureReason`** from typed errors, propagating it to the failed `RenderJob` row.
- **The recent `getErrorMessage` / `getRequestErrorCode` / `hasRequestErrorCode` extraction** centralized 28 repeated inline patterns in `useMobileSession.ts`.
- **Route catch blocks discriminate by error type** rather than by status code or string match.

## Negative Findings

- **`.catch(() => undefined)` is used 14+ times** across `render-service.ts`, `useMobileSession.ts`, and route handlers. Each silently swallows an error. Some are appropriate (post-response cleanup); none are tagged as such.
- **The mobile render-error UI cascade has 4 branches** producing 4 different Arabic error messages from one `catch`:
  - `render_limit_reached` → "فشل التصميم أكثر من مرة." 
  - `render_device_cooldown` → "يمكنك طلب معاينة جديدة بعد ٥ دقائق."
  - `screen_budget_exhausted` → "انتهى الحد اليومي لهذه الشاشة. يرجى التواصل مع الموظف المختص."
  - Default (incl. timeout) → "فشل إنشاء التصميم. يرجى المحاولة مرة أخرى." / "فشل إنشاء التصميم أو استغرق وقتًا طويلًا."
  
  Each branch also emits a distinct `failure_recovery_ui_shown` event with a different `reason`. No table; pure cascade.
- **The render route's 429 responses use 4 different body shapes**:
  - `{ error, code: "RENDER_DEVICE_COOLDOWN" }` (with `Retry-After: cooldownResult.ttl`)
  - `{ error, code: "RENDER_LIMIT_REACHED" }` (with `Retry-After: 300`)
  - `{ error }` (screen cooldown, with `Retry-After: screenCooldown.retryAfterSeconds`)
  - `{ error, code: "SCREEN_BUDGET_EXHAUSTED" }` (with `Retry-After: 3600`)
  
  Plus two "RENDER_IN_PROGRESS" variants: `{ error }` (no code) and `{ error, code: "RENDER_IN_PROGRESS" }`.
- **The room route's catch block** (`app/api/.../room/route.ts`) is the longest in the project — `RoomPreviewUploadError` produces 3 different status codes via `err.status` (set by the error class), and the route has a nested `openSessionIssue` call selecting one of three issue types via a ternary chain.
- **Network errors are detected by string comparison** in `mobile-session-utils.ts::isNetworkInterrupted`: `error instanceof TypeError && error.message === "Failed to fetch"`. Browser-specific fragility.
- **Error fallbacks duplicate `getErrorMessage` semantics inconsistently**:
  - `getErrorMessage(error)` (new utils) — `error instanceof Error ? error.message : String(error)`
  - `getErrorMessage(error, fallback)` (private in `session-client.ts`) — adds a `fallback` argument
  - `createActionErrorMessage(error, fallback)` (mobile-session-utils) — adds request-error short-circuit
  
  Three nearly-identical functions, three slightly-different semantics.

> Checklist match: Root cause clarity, Consistency, Naming, Error handling.

---

# Diagnostics & Logging Review

## Positive Findings

- **Pino logging is well-configured**: pretty in dev, NDJSON in prod, error serializer, global cache against hot-reload. `getLogger(name)` is the standard entry point.
- **`session-diagnostics.ts::trackSessionEvent`** is the right abstraction: a typed input, a single DB write, a defensive try/catch that never throws.
- **`session-diagnostics.ts::openSessionIssue`** uses Prisma `upsert` with a dedupe key for one-per-(session, type) semantics.
- **`useMobileDiagnostics`** is genuinely passive and never modifies state — comment says so and the code agrees.
- **`session-diagnostics-client.ts` has a documented throttle** (`THROTTLE_MS = 5_000`) with an `UNTHROTTLED_EVENTS` allowlist for high-value events.
- **`tests/unit/diagnostics-schema.test.ts`** documents the contract of critical events (`render_completed`, `render_failed`, `render_timing_summary`, `render_capacity_exceeded`, `gemini_retry_started`).

## Negative Findings

- **172 `trackSessionEvent` / `trackClientSessionEvent` call sites** across the codebase. The volume signals that diagnostics is a primary concern, but there is no central registry of event types or schemas.
- **47 `console.*` calls in production source** sit alongside structured pino logging. Examples: `console.info("[room-preview] mobile_connect_started", ...)`, `console.error("[room-preview] Failed to save QR product", ...)`, `console.log("[render] handler called", ...)`. Two parallel log channels with no shared format.
- **Event-type strings are inline literals everywhere.** No `enum RoomPreviewEventType` or `const EVENT_TYPES = { ... } as const`. Find-references on `"gemini_attempt_timeout"` returns 3 separate string literals; refactoring a name requires textual search.
- **The throttle's `UNTHROTTLED_EVENTS` allowlist** in `session-diagnostics-client.ts` lists ~30 event types as hard-coded strings. New event types default to throttled — a future event author has to remember to add their event to the allowlist, or it silently disappears in dev.
- **`RESOLVED_CONFIG` is logged on every cold start** of `gemini-provider.ts` with 20+ fields. The same info is duplicated:
  - Once at module load (cold-start log)
  - Per render in the `render_branch_resolved` event metadata
  - Per render in the `render_timing_summary` event metadata
  - Per render in the `render_diagnostics_snapshot` event metadata
  - In `gemini_call_starting` log on every attempt
- **Mobile `console.info("[room-preview] mobile_connect_started", ...)` is paired with `trackClientSessionEvent(sessionId, { eventType: "mobile_connect_started" })`.** Same event, two destinations. Holds for ≈10 mobile lifecycle events.
- **Diagnostic events are constructed inline at every emission**, repeating boilerplate: `{ sessionId, source: "mobile", eventType: "...", level: "...", metadata: { ... } }`. No builder, no typed input. Inconsistent metadata field naming (`status` vs `currentStatus` vs `statusBefore`/`statusAfter`).
- **`render_timing_summary`** is emitted from both the render service and the Gemini provider, with overlapping but non-identical metadata shapes. The provider's version has `mode`, `attemptCount`, `attemptTimings`, `envConfig`; the service's version has `setupMs`, `providerMs`, `saveMs`, `totalMs`.
- **`floor_polygon_missing_prompt_only_mode` event** is emitted even though the field is optional and "no polygon" is the common case — this looks like a permanent warning. Likely creates noise in the dashboard.
- **`render_config_mismatch` event** is emitted only when `ROOM_PREVIEW_RENDER_QUALITY=fast` but the resolved prompt is not `fast-v1`. This guard exists because of past webpack-inlining bugs. A defensive emission for a fixed problem — should probably be a startup assertion instead.

> Checklist match: Consistency, Magic numbers, Naming, Code smells (needless repetition).

---

# Duplication Review

## Positive Findings

- **Tiny shared helpers are correctly extracted** (recent work): `getErrorMessage`, `getRequestErrorCode`, `hasRequestErrorCode`, `tooManyRequests`, `buildRenderHash`, `getDeviceFingerprint`.
- **Validators (`lib/room-preview/validators.ts`)** define type guards once, used by both server and client.
- **`ROOM_PREVIEW_ROUTES` constant** centralizes URL templates for both client and server.

## Negative Findings

- **`sleep` / `wait` exist in two places**: `gemini-retry-utils.ts::sleep(ms)` and `mobile-session-utils.ts::wait(ms)` and `lib/room-preview/room-service.ts::wait(ms)`. Identical bodies.
- **`getViewStateFromError`** exists in `mobile-session-utils.ts` and inside `features/room-preview/screen/useScreenSession.ts`. Different return types but the same error-classification structure.
- **`isRoomPreviewSessionEvent`** is defined twice — once in `session-events.ts` (server, validates Redis payload), once in `session-events-client.ts` (browser, validates SSE payload). Same check, different files.
- **Stuck-render-job detection** lives in three places:
  - `render-job-cleanup.ts::isRenderJobStuck` + `markStuckRenderJobsAsFailed` (cron)
  - `render-service.ts::recoverStuckRenderJob` (per-request)
  - `session-cleanup.ts::failStuckRenderingSessions` (cron, different threshold)
- **Rate-limit dedup cooldowns** are in `render-route-cooldowns.ts` (Maps for render route warnings) and `events/route.ts` (`screenConnectCooldown` Map for SSE-connect events). Same shape, different files.
- **The render route emits the same diagnostic-event shape from 3 `after()` callbacks** (`render_device_cooldown`, `render_limit_reached`, `screen_budget_exhausted`). Each repeats the dedup check + emit boilerplate.
- **Image preparation logging** duplicates fields between the image-utils logger and the provider logger (both use logger name `"gemini-provider"`); the `render_input_image_loaded`, `render_input_image_dimensions_before_resize`, `render_input_image_dimensions_after_resize`, `render_input_image_prepared`, `product_image_resized_for_gemini` events all carry overlapping subsets of `originalBytes`, `finalBytes`, `width`, `height`, `originalWidth`, `originalHeight`, `imageRole`, `sessionId`.
- **`getActiveScreenById` and `findActiveScreenByToken`** in `screen-repository.ts` have identical select clauses and identical "return null if !screen.isActive" logic.
- **`RoomPreviewSession` JSON serialization** uses `toIsoString(value)` helpers duplicated in `session-repository.ts` and (implicitly via `JSON.stringify`) elsewhere.

> Checklist match: DRY, Consistency, Naming.

---

# Testability Review

## Positive Findings

- **271 tests passing** across 16 files, 3,890 lines of test code.
- **Pure modules have first-class tests**: `session-machine.test.ts` (539 lines), `validators.test.ts` (429 lines), `session-status.test.ts`.
- **Render-pipeline tests use mock-first architecture**: every external dependency is mocked at the import level via `vi.mock`. `render-service.test.ts` covers success, failure, rollback, semaphore-full, and stuck-job recovery.
- **`tests/__mocks__/sharp.ts` alias** is a clean test seam — pinned via `vitest.config.ts::resolve.alias` so `await import("sharp")` returns a stub everywhere.
- **`tests/__mocks__/server-only.ts` alias** allows route handlers to be imported in Node tests.
- **Gemini provider tests** use the now-exported `GeminiTimeoutError` as a "test seam" — throwing it directly from the mock avoids fake timers entirely.
- **Diagnostics schema tests** assert the existence of required fields on critical events — acts as a regression guard.

## Negative Findings

- **Zero tests for the god hook** `features/room-preview/mobile/useMobileSession.ts` despite it being the largest file in the project.
- **Zero tests for `features/room-preview/screen/useScreenSession.ts`** (724 lines).
- **Zero tests for SSE pub/sub** (`session-events.ts`).
- **Zero integration tests for `room/route.ts`** (401 lines, the second-largest route) despite its multi-branch upload error handling.
- **Zero tests for `customer-service.ts`** (phone normalization, customer upsert).
- **Zero tests for `useMobileDiagnostics`, `useMobileHeartbeat`, `useScreenHeartbeat`** (≈350 lines of timer-heavy code).
- **No E2E browser tests** beyond the single `tests/e2e/room-preview-flow.spec.ts` (which is mostly API-contract assertions).
- **Test files have setup boilerplate duplication**: `vi.mock("@/lib/logger", ...)`, `vi.mock("@/lib/room-preview/session-diagnostics", ...)`, `vi.mock("next/server", ... after: vi.fn(...))` — repeated across 5+ test files with no shared `testHelpers/mocks.ts`.
- **Many module-level mutable Maps and globalThis singletons are not reset between tests**, which is why two tests cannot run in any order today without surprise (e.g., `screenConnectCooldown` in `events/route.ts`). The test suite avoids this by not testing those modules; the implicit cost is that they remain untested.
- **The `tests/setup.ts` file is a 1-line env stub** — no shared mock factories, no setup/teardown for global state.

> Checklist match: Tests, Dependency injection, Testability.

---

# Findings Table

| Severity | Category | File | Description | Production Risk |
|---|---|---|---|---|
| Critical | Hook Design | `features/room-preview/mobile/useMobileSession.ts` | God hook: 1,273 lines, 31-field return type, 8 refs, 12 useStates, 4 `eslint-disable react-hooks/exhaustive-deps`. Single closure orchestrates upload, polling, render, browser-back recovery, diagnostics, heartbeat, restart flow. | Any change risks regressing an unrelated concern; review difficulty is high; every new bug investigation requires reading the whole file. |
| Critical | Render Pipeline | `lib/room-preview/render-service.ts` | `runRoomPreviewRenderPipeline` is one 276-line try/catch handling success, failure, three rollback branches, six diagnostic emissions, and four `after()` schedulings. | A miswired catch branch silently corrupts session state or omits diagnostics. Already has `.catch(() => undefined)` in 5 places. |
| Critical | Function Design | `lib/room-preview/render-providers/gemini-provider.ts` | `geminiRoomPreviewRenderProvider.render` is 744 lines with a 4-level-nested serial retry loop and 5 diagnostic-event emissions interleaved with state mutation, prompt construction, and storage upload. | Retry/timeout/diagnostics changes require reading hundreds of lines of unrelated logic; high risk of inadvertently changing one path while modifying another. |
| High | Diagnostics | (multiple) | 172 `trackSessionEvent`/`trackClientSessionEvent` call sites with event-type strings as inline literals. No `RoomPreviewEventType` registry. | Renaming an event silently drops data. Admin dashboard parsing is brittle. Onboarding requires reading every emission site to know which events exist. |
| High | Logging | (multiple) | 47 `console.*` calls in production source coexist with structured pino logging. No central log policy. | Logs are not consistently aggregatable. Some production-relevant info goes only to `console.info` and is lost in log shippers. |
| High | Architecture | `lib/room-preview/render-route-cooldowns.ts`, `app/api/.../events/route.ts` | Module-level mutable `Map`s used for rate-limit dedup. Implicitly assume single Lambda instance. | Multi-instance Vercel deployments would emit warning events 2-N times for the same trigger; not a correctness bug but signals architecture mismatch with the rest of the system. |
| High | Module Boundary | `lib/room-preview/render-providers/gemini-provider.ts` | Provider imports `trackSessionEvent` directly and emits 6 event types. Provider interface declares no telemetry contract. | A second provider would have to replicate the emission protocol or break the dashboard. Coupling is invisible at the type level. |
| High | Module Boundary | `lib/room-preview/render-providers/gemini-image-utils.ts` | Image-utils module uses `getLogger("gemini-provider")` by design to preserve log output, pinning module boundaries to log-name identity. | Splitting the module further is blocked by the log-name constraint. Documented as intentional. |
| High | State Management | `lib/room-preview/types.ts`, `lib/room-preview/session-status.ts`, `lib/room-preview/session-polling.ts`, `useMobileHeartbeat.ts`, `useScreenSession.ts` | Five separate definitions of "terminal" / "live" / "completed" / "expired" status subsets. | Adding a new status requires updating five places; missing one silently breaks polling or heartbeat logic. |
| High | Error Handling | `lib/room-preview/render-service.ts` | 14+ `.catch(() => undefined)` silently discard rollback / cleanup / diagnostics errors. | Recurring rollback failures invisible in production. No `cleanup_failed_after_render_failure` event. |
| High | Render Pipeline | `lib/room-preview/render-service.ts`, `app/api/.../render/route.ts` | Two code paths transition session status: route does `markReadyToRenderTransition`; service does `completeRenderingTransition`/`failRenderingTransition`/`markSessionAsFailed`. `markSessionAsFailed` swallows `RoomPreviewSessionTransitionError`. | Future changes to status semantics must be made in both places; the silent transition-error catch hides real bugs. |
| Medium | Architecture | `lib/room-preview/render-providers/gemini-provider.ts` | 28 `process.env.*` reads at request time despite `gemini-config.ts` extraction. Has its own `RESOLVED_CONFIG` snapshot. | Config drift between module-load and request-time is the explicit workaround; the workaround surface is now duplicated. |
| Medium | Duplication | (multiple) | `sleep`/`wait` exists in `gemini-retry-utils.ts`, `mobile-session-utils.ts`, `room-service.ts`. `getViewStateFromError` exists in mobile and screen hooks. `isRoomPreviewSessionEvent` in two files. | Drift between copies; tests need to remember which copy applies. |
| Medium | Duplication | `lib/room-preview/render-job-cleanup.ts`, `lib/room-preview/render-service.ts::recoverStuckRenderJob`, `lib/room-preview/session-cleanup.ts::failStuckRenderingSessions` | Three "mark stuck render job failed" pathways with different thresholds. | Threshold/policy changes need to be made in three places; rendering-stuck definition is ambiguous. |
| Medium | Naming | (multiple) | Many similar pairs: `session-events.ts` / `session-events-client.ts`; `getRoomPreviewSession` (server) / `fetchRoomPreviewSession` (client); `tryClaimRenderingSlot` (DB) / `acquireRenderLock` (Redis); `MobileSessionViewState` vs `ScreenSessionViewState`. | Disambiguation requires opening files. Grep returns paired hits. |
| Medium | Function Design | `features/room-preview/mobile/useMobileSession.ts::handleCreateRender` | 215-line callback. Catch branch is a 4-way Arabic-message cascade with parallel `failure_recovery_ui_shown` reasons. | UI message changes need careful coordination across 4 branches and parallel diagnostic events. |
| Medium | Function Design | `features/room-preview/mobile/useMobileSession.ts::handleFileSelection` | 175-line callback mixing direct-upload, R2 PUT, confirmation, FormData fallback, error-recovery selection. | Upload-pipeline modifications require reading the full handler; failure messages mixed with success path. |
| Medium | React Component | `components/room-preview/MobileSessionClient.tsx` | 474 lines; 4 viewState branches; 6 conditional sub-trees; 40-line inline `onClick` arrow function with `if (recoveryMessage.ctaIntent === "...")` dispatch chain. | Visual changes require deep reading; intent dispatching is implicit. |
| Medium | State Management | `lib/room-preview/types.ts` | Status `"created"` is in the enum but never set; `"completed"` is set only by the cleanup cron. State machine has no `completeSessionTransition`. | Adding "create flow" code accidentally relying on `"created"` will silently never trigger. |
| Medium | Source Structure | `app/api/.../room/route.ts` | 401-line POST handler. Upload error handling has nested ternary chain selecting one of three `SessionIssueType` values inside `openSessionIssue`. | Adding a new upload error code requires editing the ternary; error mapping is implicit. |
| Medium | Comments | `lib/room-preview/render-providers/gemini-provider.ts` | `render_config_mismatch` event is a defensive emission for a past webpack-inlining bug; comments say so. Now permanently in the code path. | Future readers may not know it's a workaround; would emit on legitimate env changes too. |
| Medium | Testability | (multiple) | Zero tests for `useMobileSession.ts`, `useScreenSession.ts`, `session-events.ts`, `room/route.ts`, `customer-service.ts`. | High-risk areas (god hook, SSE) are unprotected by regression tests. |
| Medium | Testability | `tests/setup.ts` | 1-line env stub. No shared mock factories. Each test file re-declares `vi.mock("@/lib/logger", ...)`, `vi.mock("@/lib/room-preview/session-diagnostics", ...)`, etc. | Mock drift across tests; setup boilerplate duplicated 5+ times. |
| Medium | Error Handling | `app/api/.../render/route.ts` | 4 distinct 429 body shapes (RENDER_DEVICE_COOLDOWN, RENDER_LIMIT_REACHED, screen-cooldown-no-code, SCREEN_BUDGET_EXHAUSTED). 2 RENDER_IN_PROGRESS variants. | Mobile client has to discriminate by inspecting body shape; new codes risk client-side fall-through to generic error. |
| Medium | Performance | `lib/room-preview/render-service.ts` | 6+ DB writes per successful render with no batching or transactional boundary. | Each round-trip adds latency; partial failure mid-sequence leaves session in inconsistent state. |
| Low | Naming | `lib/room-preview/render-route-cooldowns.ts` | `shouldEmitRateLimitEvent` returns `true` AND mutates the map. Name implies a pure predicate. | Future reader assumes it's idempotent; calling twice debounces twice. |
| Low | Function Design | `lib/room-preview/session-cleanup.ts` | Functions take `idleAfterMs = 1 * 60 * 1000`, `stuckAfterMs = 7 * 60 * 1000`, `displayAfterMs = 90 * 1000` as defaulted arguments. Call sites are silent about the threshold. | A misconfigured threshold value silently overrides production policy. |
| Low | Duplication | `lib/room-preview/screen-repository.ts` | `getActiveScreenById` and `findActiveScreenByToken` have identical `select` clauses + identical "return null if !screen.isActive" logic. | Schema change to `screen` table requires editing both. |
| Low | Naming | `lib/room-preview/session-machine.ts` | Transition error messages mix Arabic and English. | i18n consumers see mixed-language errors. |
| Low | Source Structure | `lib/room-preview/session-events.ts` | `GLOBAL_EVENTS_CHANNEL` is declared and published to but has no subscribers in production. | Dead API surface. Future readers spend time tracing a no-op. |
| Low | Diagnostics | `lib/room-preview/render-providers/gemini-provider.ts` | `floor_polygon_missing_prompt_only_mode` event emitted on every render without a floor polygon — the common case. | Dashboard noise; harder to spot real issues. |
| Low | Diagnostics | (multiple) | Event metadata field names inconsistent: `status` vs `currentStatus` vs `statusBefore`/`statusAfter`. | Dashboard parsing brittle; queries differ per event. |
| Low | Logging | `lib/room-preview/render-providers/gemini-image-utils.ts` | Module re-uses `getLogger("gemini-provider")` to preserve log output identity. | Log filtering at the module level no longer possible. |
| Low | Source Structure | `features/room-preview/mobile/debug.tsx` | `// eslint-disable-next-line react-hooks/purity` on a `useRef(Date.now())`. | Lint rule disabled at the symbol level; reader has to understand why. |

---

# Technical Debt Assessment

**Medium-High.**

The codebase is not in a state of crisis. Critical paths are tested, the recent extraction work demonstrates an active commitment to clean code, and the state machine + repository + service layering is sound. However:

- Three god modules (`useMobileSession.ts`, `render-service.ts::runRoomPreviewRenderPipeline`, `gemini-provider.ts::render`) account for an outsized share of total cognitive load. Each is large enough that any change risks regressing unrelated behavior.
- Diagnostics has become a cross-cutting concern leaking into every layer. The event-type vocabulary is large, ungrouped, and emitted as inline string literals. This is the single biggest hidden tax.
- Duplication across server/client (event validators, view-state helpers, sleep/wait, stuck-job detection) means small policy changes turn into 2–3 file edits.
- The two-channel logging story (`pino` + `console.*`) is unresolved.

Estimated effort to bring the debt to "Low":

- **God-module decomposition** (god hook + render-service pipeline + provider render method): roughly 1–2 engineer-weeks per module, with strong test coverage to catch regressions. The recent gemini-provider extraction shows the pattern works.
- **Event-type registry** (typed enum + central schema): 2–3 days, mechanical, low risk if backed by tests.
- **Console-to-pino migration**: 1–2 days, mechanical.
- **Server/client dedup consolidation**: 1 week, blocked on agreeing where the canonical form should live.

---

# Maintainability Assessment

## If a new developer joins tomorrow

### How difficult is onboarding?

**Medium-hard.**

A new developer can be productive on small fixes in the route layer within a few days because route handlers are reasonably linear, the state machine is well-documented by tests, and most error classes follow the same pattern. They can confidently make repository changes within a week.

However, the developer will hit a wall the first time they need to change `useMobileSession.ts`, `runRoomPreviewRenderPipeline`, or the Gemini provider's `render()` method. Each of these requires reading 500–1,300 lines to understand what the change might inadvertently affect. The diagnostics emissions are tangled with business logic, so they will not be sure whether a change in a `catch` branch is "just logging" or "load-bearing".

### Which areas are easiest to understand?

1. **`session-machine.ts`** — pure functions, transitions documented by name, exhaustive tests.
2. **`session-repository.ts`** — thin Prisma wrappers with explicit `select` clauses.
3. **`validators.ts`** — straightforward type guards with full test coverage.
4. **`render-rate-limit.ts`, `screen-repository.ts`, `render-repository.ts`** — small, focused, single-purpose.
5. **Recent extraction modules**: `mobile-session-utils.ts`, `mobile-session-error-utils.ts`, `render-route-utils.ts`, `render-route-guards.ts`, `render-route-cooldowns.ts`, `gemini-errors.ts`, `gemini-config.ts`, `gemini-retry-utils.ts`, `gemini-client.ts` — all under 200 lines, all single-purpose.
6. **Test files** — uniformly structured, easy to follow as documentation.

### Which areas are hardest to understand?

1. **`useMobileSession.ts`** — 1,273 lines, 8 refs, 4 disabled lint rules, 41 diagnostic emissions, browser-back recovery interleaved with render-poll resume interleaved with initial-load retry-with-backoff.
2. **`render-service.ts::runRoomPreviewRenderPipeline`** — success path and failure path interleaved with diagnostic event emissions, render-job updates, rollback, and `after()` scheduling.
3. **`gemini-provider.ts::geminiRoomPreviewRenderProvider.render`** — 744 lines, 4-level nesting, two parallel "snapshot meta" constructors (one for success, the failure path's having been recently removed).
4. **`session-cleanup.ts`** + `render-job-cleanup.ts` + `stuck-detection.ts` — overlapping responsibilities with different thresholds.
5. **The SSE layer** — `session-events.ts` (server, with Redis ref-counting), `session-events-client.ts` (browser, with reconnect-with-jitter and keepalive-timeout), `app/api/.../events/route.ts` (handler with manual SSE byte streaming), and the consumers in `useMobileSession.ts` / `useScreenSession.ts`. Cross-file mental model required.
6. **Event-type vocabulary** — discovery requires global search of trackSessionEvent / trackClientSessionEvent call sites.

### Which areas create the most future maintenance cost?

1. **The god hook** — every mobile-flow change risks regressing a different concern.
2. **The render pipeline function** — every retry/diagnostic/rollback policy change requires understanding the whole function.
3. **Event-type strings** — every UI/dashboard change risks dropping data via a typo.
4. **Module-level mutable state for rate limiting** — first multi-instance deployment will surface latent drift.
5. **Status-subset duplication** — adding a new session status requires updating five subset definitions.
6. **Duplicated stuck-render detection** — policy changes need three edits.

---

# Final Verdict

## 1. Is this codebase clean?

**Partially.** The lower-level modules (state machine, repository, recent extraction modules, error classes, type guards) are clean to very clean. The higher-level orchestration modules (`useMobileSession`, `render-service`, `gemini-provider`) are not — they are recognizable god modules with cross-cutting diagnostics interleaved with business logic. The codebase is in a clear state of **active improvement** rather than decay: recent commits show targeted extraction work that has measurably reduced complexity, but several structural decisions (event-type inline strings, module-level Maps, two log channels, status-subset duplication) remain unresolved.

## 2. Is it production maintainable?

**Yes, with caveats.** The test suite (271 passing tests) protects critical paths. Typed errors, typed status enum, structured logging, Redis-backed primitives, and atomic DB claims give the production system the durability it needs. However:

- A new senior engineer cannot safely touch the god modules without significant ramp-up.
- The next class of bug (diagnostic emissions missing data, rate-limit dedup firing twice, status-subset inconsistency after adding a status) will be hard to attribute and slow to diagnose.
- Horizontal scaling beyond a single Vercel instance has latent inconsistencies in the rate-limit warning maps.

Day-to-day maintenance — adding a new product type, tweaking timeouts, fixing an upload-validation rule, adjusting an Arabic error message — is feasible. Significant architectural work or any change touching the god modules will be expensive.

## 3. Is it easy for another developer to understand?

**Mixed.** The architecture is *describable* in a few sentences (Screen → QR → Mobile → Room → Product → AI → Result; session state machine + per-session SSE; Redis for distributed primitives; pino + diagnostics events). The lower-level modules can each be read in an afternoon.

However, the developer will not feel confident touching the god modules without extended onboarding, and they will not be able to enumerate the event-type vocabulary or the status-subset semantics without a global search.

## 4. Top 10 sources of complexity

1. **`features/room-preview/mobile/useMobileSession.ts`** — 1,273-line god hook with 31-field return type and 4 disabled `react-hooks/exhaustive-deps`.
2. **`lib/room-preview/render-service.ts::runRoomPreviewRenderPipeline`** — 276-line single function carrying success + failure + rollback + four `after()` schedulings.
3. **`lib/room-preview/render-providers/gemini-provider.ts::render`** — 744-line method with 4-level retry nesting and 60-line diagnostic snapshot construction inline.
4. **The diagnostic-event vocabulary** — 172 emission sites, dozens of distinct event-type strings, no central registry, no schema.
5. **Mixed log channels** — 47 `console.*` calls alongside structured `pino`. No policy for which goes where.
6. **`components/room-preview/MobileSessionClient.tsx`** — 474-line component with 4 view branches, 6 conditional sub-trees, and a 40-line inline `onClick` dispatch.
7. **Module-level mutable Maps for rate-limit dedup** — `renderLimitWarnCooldown`, `deviceCooldownWarnMap`, `screenBudgetWarnMap`, `screenConnectCooldown` — invisible cross-instance drift.
8. **Status-subset duplication** — five independent definitions of "terminal" / "live" / "completed" across `types.ts`, `session-status.ts`, `session-polling.ts`, `useMobileHeartbeat.ts`, `useScreenSession.ts`.
9. **Stuck-render detection in three places** — `render-job-cleanup.ts`, `render-service.ts::recoverStuckRenderJob`, `session-cleanup.ts::failStuckRenderingSessions` — different thresholds, different code, overlapping intent.
10. **Per-render env-var re-reads in `gemini-provider.ts`** (28 `process.env.*` calls) duplicating `gemini-config.ts` semantics at runtime, plus the `RESOLVED_CONFIG` snapshot, plus the `render_config_stale_module_constant` defensive warning emission — a multi-layer workaround for past webpack-inlining bugs.
