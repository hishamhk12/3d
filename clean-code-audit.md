# Clean Code Audit — Room Preview Platform

> Audit Date: 2026-05-28
> Reviewer role: Senior Software Architect / Principal Engineer
> Scope: Full codebase read — architecture, services, render pipeline, session machine, React layer, API routes, diagnostics, tests

---

# Executive Summary

## Overall Clean Code Score

**6.4 / 10**

The backend service layer and session state machine are well-engineered. Concurrency primitives, atomic database patterns, Redis abstractions, and the diagnostics story are production-grade. The system degrades cleanly under infrastructure failure (Redis unavailability, Lambda termination, semaphore timeout). These are real strengths.

The weaknesses are concentrated in three areas: god files that carry far too many responsibilities, a client-side hook that has become a 1,300-line orchestration monolith, and a render provider that mixes infrastructure, configuration, retry logic, prompt management, and diagnostics emission all in one ~1,900-line file. These are the largest sources of future maintenance cost.

---

## Project Strengths

1. **Session state machine** (`session-machine.ts`) — pure functions, no side effects, explicit transition guards, well-named errors. Easily testable in isolation.
2. **Atomic concurrency** — `tryClaimMobileConnection` and `tryClaimRenderingSlot` use conditional DB updates, eliminating TOCTOU races across multiple Lambda instances.
3. **Redis Gemini semaphore** — Lua script-based distributed concurrency with self-healing TTL expiry and transparent Redis-down fallback. Production-grade implementation.
4. **Redis Pub/Sub with ref-counting and event deduplication** — prevents channel subscription leaks across multiple concurrent SSE streams; graceful in-memory fallback for local dev.
5. **Session diagnostics story** — `trackSessionEvent`, `openSessionIssue`, `resolveSessionIssue` form a coherent observability layer; events are written to a durable DB table, not just logs.
6. **Layer separation** — routes → services → repositories → Prisma is consistently respected. Direct Prisma calls outside repositories are rare and deliberate.
7. **`render-service.ts` pipeline** — setup, Gemini call, DB update, and analytics are sequenced correctly with rollback paths for render count and screen budget on failure.
8. **Schema design** — `SessionEvent`, `SessionIssue`, `RenderJob`, and `CustomerExperience` are well-modeled with appropriate indexes. Cascade deletes are intentional and documented.
9. **Provider abstraction** — `renderRoomPreviewWithProvider` hides the Gemini-specific implementation; swapping providers requires no changes to `render-service.ts`.
10. **Redis client design** — three separate connections (pub/sub/cmd) with correct `maxRetriesPerRequest` semantics per role.

---

## Project Weaknesses

1. **`useMobileSession.ts` is a 1,300-line god hook** — manages networking, local state (15+ variables), product save concurrency, render polling, heartbeat, diagnostics, browser back-guard, auto-connect, and error recovery in one object.
2. **`gemini-provider.ts` is a ~1,900-line god file** — configuration constants, custom error classes, image loading, Gemini API calls, timeout orchestration, parallel attempt coordination, prompt fallback, and diagnostics events all coexist in one module.
3. **`render/route.ts` is a 444-line route handler** — auth, idempotency lock, device fingerprint, rate limiting, session state transition, dedup hashing, screen budget, analytics, and pipeline dispatch are all inlined into one POST handler.
4. **Mixed-language hardcoding** — Arabic error strings are scattered across hook code (`useMobileSession.ts`), component files (`MobileSessionClient.tsx`), and query files, bypassing the i18n system in use elsewhere.
5. **Duplicated `persistSessionTransition`/`persistTransition`** — the same pattern (save state → publish SSE → track event) is implemented independently in both `session-service.ts` and `render-service.ts`.
6. **Module-level in-process Maps in route handlers** — cooldown dedup Maps in `render/route.ts` and `events/route.ts` are module-scope state that accumulates in serverless warm instances and is lost on cold starts, making their behavior inconsistent and untested.
7. **Test coverage** — the render provider, session-events Redis logic, and the mobile session hook have zero test coverage despite being the highest-complexity and highest-risk code.
8. **`isSavingProductRef` shadow pattern** — an underscore-prefixed React setter overridden by a non-standard wrapper creates a fragile pattern for synchronizing ref and state.

---

# Architecture Review

## Positive Findings

**Clean layering — routes delegate to services; services delegate to repositories.**
The call graph flows consistently: API route → service function → repository → Prisma. Routes do not call Prisma directly for core session operations. This layering survives across the entire session lifecycle.

**State machine is decoupled from persistence.**
`session-machine.ts` contains only pure transition functions. It knows nothing about Prisma, Redis, or SSE. This is the textbook separation for a state machine; the machine can be tested without any infrastructure.

**Render provider abstraction is correctly placed.**
`render-service.ts` calls `renderRoomPreviewWithProvider(...)` without any knowledge of Gemini, image resizing, or prompt building. Adding a second AI provider would only require implementing the provider interface.

**Redis graceful degradation is first-class.**
Every Redis consumer (`session-events.ts`, `gemini-semaphore.ts`, `render-rate-limit.ts`) checks `isRedisEnabled()` and provides an explicit fallback. The fallback behavior is documented and logged. Redis is a performance and distribution enhancement, not a hard requirement.

**Distributed race condition prevention.**
Two critical races — mobile connection claim and rendering slot claim — are handled with atomic conditional DB updates rather than application-level locks. This is correct and safe across multiple Lambda instances.

## Negative Findings

**`render/route.ts` violates Single Responsibility Principle severely.**
The POST handler on the render endpoint performs at least ten distinct responsibilities: auth guard, idempotency lock acquisition and release, device fingerprint extraction, device cooldown check, session validation and expiry check, render deduplication (hash comparison), session render count increment with rollback, screen budget check with rollback, stuck-job recovery, session state transition, post-response analytics fire-and-forget, and render pipeline dispatch. Each of these is a reason for the handler to change. They should be extracted into service functions.

**`render-service.ts` `runRoomPreviewRenderPipeline` is a 277-line function.**
It mixes: semaphore acquisition, render job creation, provider call, DB state updates, analytics events, issue resolution, screen budget rollback, render count rollback, and customer experience saving — all in one linear function. The single-pass structure makes the error path especially hard to reason about.

**The render pipeline split across route and service is unclear.**
The route handler calls `markReadyToRenderTransition` and `saveSessionState` directly, which is a service-layer responsibility. The service then calls `tryClaimRenderingSlot` to transition to "rendering". These overlapping responsibilities blur the contract between route and service.

**Admin query layer is a flat collection of files without domain grouping.**
`lib/admin/` contains eight files that span session diagnostics, render errors, user analytics, dashboard charts, and auth. There is no sub-module grouping or shared abstraction. As the admin tool grows this becomes harder to navigate.

---

# Naming Review

**`createRoomPreviewSessionState("pending")`** — in `session-service.ts` line 149, the function is called with the string `"pending"` as its `sessionId` argument. The returned object's `id` field is set to `"pending"` but is never used. Only the returned `status` field is consumed. The call is misleading: the argument name (`sessionId`) suggests a real session ID is expected, but a sentinel string is passed. This should either call the function with no argument, or the intent should be made explicit.

**`isTimeExpired` alias** — in `session-service.ts` line 62, `const isTimeExpired = isEffectivelyExpired` creates a second name for the same function, used in the same file only. This is needless indirection.

**`RenderResult` and `RoomPreviewRenderResult`** — `types.ts` defines both types and then aliases one to the other (`export type RoomPreviewRenderResult = RenderResult`). A consumer must read two type definitions to understand they are the same.

**`MockRoomPreviewProduct`** — marked `@deprecated Use RoomPreviewProduct` but still exported. Deprecated exports that are never removed teach developers to ignore deprecation warnings.

**`_setIsSavingProduct` and `setIsSavingProduct`** — in `useMobileSession.ts`, a React state setter is stored as `_setIsSavingProduct` and then a non-standard wrapper function named `setIsSavingProduct` is defined inline. The underscore convention for private members does not apply to React state setters and the wrapper is not obvious on first read.

**`SaveRoomPreviewSessionRoomResponse` and `SaveRoomPreviewSessionResult`** — two types in `types.ts` with near-identical names for overlapping concerns. A reader must inspect both to discover the difference.

**`debugLog`** — the `debug` module inside `features/room-preview/mobile/` uses `debugLog` as both a function name and an export. The variable receiving the `useDebugLog()` return includes `{ add: debugLog }` — a property named `add` is destructured and aliased to `debugLog`. The aliasing at call site (`const { add: debugLog } = useDebugLog()`) and the property name `add` are inconsistent.

**`perRenderRawQuality`, `perRenderRawLongEdge`** — in `gemini-provider.ts`, two per-render reads are declared but `perRenderRawLongEdge` is only ever used in the config mismatch event metadata. Reading an env var per-render for diagnostics only, under a name that suggests it influences behavior, is misleading.

---

# Function Review

**`useMobileSession` (1,300 lines, 30+ return values).**
This hook violates every measure of function design: it is not small, it is not focused, it has hidden side effects across 15+ state variables, and its return signature is a large flat object. Functions that large are not readable and are not maintainable. The hook combines: session lifecycle management, auto-connect, back-navigation guard, heartbeat status, product save with abort controller, QR product resolution, render polling, expiry timer, diagnostics tracking, and i18n provision. Each of these concerns could be its own hook.

**`runRoomPreviewRenderPipeline` (277 lines).**
The function's setup, happy path, error path, and rollback paths are all inlined. It is difficult to read the happy path in isolation because error-handling branches interrupt it. Named helper functions would make the stages — acquire, render, persist, emit — independently readable and testable.

**`handleFileSelection` in `useMobileSession` (~135 lines).**
A single callback handles: file validation, event tracking, image compression, direct-upload URL request, R2 PUT, upload confirmation, fallback FormData upload, progress reporting, success state update, and three different error recovery paths. Clean Code Rule: a function should do one thing.

**`handleCreateRender` (~215 lines).**
Handles: restart guard, in-flight product save await, duplicate render guard, event tracking, render API call, render polling, result state update, error classification for five distinct error codes, recovery message selection, and analytics. Same violation.

**`render/route.ts` POST handler (~350 lines of business logic).**
See Architecture section. The function has at least ten reasons to change. A change to rate limiting logic risks introducing a bug in the state transition; a change to screen budget checking risks the auth section.

**`generateContentWithTimeout`** — the function correctly races a timeout against a Gemini call. However, it accepts an `externalAbortSignal` that is only used in the parallel-attempt path. Adding a conditional parameter that is only meaningful in one of the two call contexts is a flag argument — the function now has two different behaviors based on whether the signal is present.

**`buildFloorRenderPromptV2`** returns a string that is ~150 lines of prompt text. The prompt content itself (which is necessarily long) is not a code quality issue, but the function cannot easily be tested for correctness — the output is an opaque string with no structure that unit tests can assert against.

**`assertValidSelectedRoom` throws `RoomPreviewSessionTransitionError` with hardcoded `currentStatus: "mobile_connected"`.** The function does not have access to the actual current session status, so it fabricates one. A caller in a different state would receive a misleading error. The function's contract is broken.

---

# Module Boundary Review

**`lib/room-preview/` has 38 source files with no sub-grouping.**
The module boundary is the entire `room-preview/` directory. Inside it, files ranging from `country-dial-options.ts` (a data file), `session-machine.ts` (business logic), `gemini-semaphore.ts` (infrastructure), and `session-diagnostics.ts` (observability) all live as siblings. As the directory grows, a developer new to the codebase cannot tell which files are critical, which are utilities, and which are infrastructure.

**`lib/admin/` is a flat bag of unrelated admin concerns.**
Eight files span four different domains: user analytics, session diagnostics, render error analysis, dashboard statistics, and authentication. No sub-grouping is applied. If a new admin feature is added, the author has no structural guidance on where to put it.

**`features/room-preview/mobile/` and `components/room-preview/`** — the split between `features/` and `components/` is not consistently enforced. `MobileSessionClient.tsx` is in `components/` but it orchestrates the entire mobile session flow, which belongs to `features/` by the project's own organization intent.

**`lib/room-preview/session-diagnostics.ts` is imported directly by at least 10 different files** across routes, services, and providers. There is no single facade that owns the decision of when and what to track. The diagnostics interface is effectively a global side-effect that every module calls directly, creating tight coupling to a concrete implementation.

**The `lib/generated/prisma/` directory is committed to source control.** Generated code inside the source tree can cause confusing diffs and makes it unclear whether the Prisma schema or the generated client is the source of truth. The standard practice is to generate into a gitignored location.

---

# React / Next.js Review

**`MobileSessionClient` does not follow component responsibility rules.**
The component renders five different step components, handles browser lifecycle events, tracks diagnostic events on user interactions, manages abandon/restart state, and coordinates a two-step `qrProductSaveRef` pattern — all inline. It is a partial view into `useMobileSession`'s state. These responsibilities should be further split.

**Multiple uses of `void` operator to explicitly discard async promises.**
`void trackClientSessionEvent(...)` appears 30+ times in `useMobileSession.ts` and `MobileSessionClient.tsx`. While technically correct, this pattern indicates that the callers consider error handling optional. The `trackSessionEvent` server-side function already swallows errors internally. Providing a single fire-and-forget wrapper that encapsulates this intent would be cleaner.

**`// eslint-disable-next-line react-hooks/exhaustive-deps` appears 4 times** in `useMobileSession.ts`. This is a signal that the hook's effect dependencies are not correctly modeled. Each disable comment is a potential stale-closure bug waiting to surface.

**`console.info(...)` and `console.error(...)` are mixed with the structured diagnostics system.** In `useMobileSession.ts`, about 20 `console.info`/`console.error`/`console.log`/`console.warn` calls coexist with `trackClientSessionEvent`. In production, console output goes to browser DevTools only. These calls are either noise or they indicate that the structured system is not being trusted for some events.

**`handleConnect` in `useMobileSession` manually constructs an optimistic session state update** (lines 648–657) by cherry-picking fields from the previous session. This bypasses the session state machine. If the server returns a different session state than what is assumed, the client state diverges. The server response `connectedSession` is set in `setSession` only briefly and then discarded in favor of the manual construction.

**`shouldShowResultStep`, `shouldShowProductQrStep`, `shouldShowLegacyProductStep`** — three boolean derivations in `MobileSessionClient` use multi-condition logic that is fragile and hard to reason about. The rendering decision for which step to show depends on six or seven boolean/status combinations. This is a sign that the state machine has not been brought to the UI layer — the component is re-implementing transition guards that the server-side machine already encodes.

---

# Session State Machine Review

**The state machine itself is clean.**
`session-machine.ts` is pure functions with no imports of Prisma, Redis, or HTTP. Each transition function takes a session, validates preconditions, throws a typed error if invalid, and returns a new session. This is correct functional state machine design.

**`isLockedStatus` and the inline `isHardLocked` check in `selectProductTransition` are inconsistent.**
`isLockedStatus` lists `ready_to_render`, `rendering`, `result_ready`, `completed`, `expired` as locked. `selectProductTransition` defines its own `isHardLocked` that intentionally excludes `result_ready` (to allow re-selection after a result). The divergence is intentional but the duplication means future additions to locked states must be made in both places.

**`assertValidSelectedRoom` uses a hardcoded status string.**
When validation fails, it throws `new RoomPreviewSessionTransitionError("...", "mobile_connected")`. The `"mobile_connected"` status is hardcoded and may not reflect reality if the function is ever called in a different context. The function signature should accept the actual session status or not accept it at all — the current design makes the error message unreliable.

**`connectMobileTransition`** is defined in `session-machine.ts` but is never called from `session-service.ts`. The service calls `tryClaimMobileConnection` (a direct atomic DB update) instead. The `connectMobileTransition` function exists in the state machine but is bypassed in the actual service. This creates a discrepancy between the documented state machine and the actual transition path.

**Mixed-language error messages in the machine.**
`markReadyToRenderTransition` throws `"الرجاء اختيار منتج قبل البدء بالتصميم."` and `"يجب اختيار غرفة ومنتج قبل البدء بالتصميم."` — Arabic strings embedded in a TypeScript module. All other transition errors in the file use English. This inconsistency suggests the messages were added at different times without a language policy.

---

# Render Pipeline Review

**The pipeline has a clear and correct happy path.**
`route.ts` → `executeRenderPipeline` → `runRoomPreviewRenderPipeline` → `renderRoomPreviewWithProvider` → `geminiRoomPreviewRenderProvider.render` is a clean linear chain. Each layer has a defined contract.

**`gemini-provider.ts` is a god file.**
It contains: module-level config constants evaluated at cold start, per-render env re-reads to detect stale module values, custom error classes (`GeminiTimeoutError`, `GeminiAbortedError`, `AspectRatioMismatchError`, `ParallelGeminiAllFailedError`), image loading and resizing logic, Gemini API timeout wrapping, output validation logic, a debug artifact uploader, retry helpers, a parallel attempt coordinator (`runParallelGeminiAttempts`), a serial retry loop with fallback prompt switching, and extensive diagnostics event emission. These are at minimum seven distinct responsibilities.

**The module-level constant / per-render re-read duality is fragile.**
The file declares module-level constants for timeouts and feature flags (evaluated once at cold start), then re-reads the same environment variables inside `render()` on every request to detect webpack inlining issues. A comment explains this is necessary. While the workaround is correct, the root cause — build-time inlining of `process.env.*` — means any new developer who adds an env-driven constant to this file will unknowingly create a stale-value bug unless they also add the per-render re-read.

**The serial retry loop is a `for` loop with `continue` and `break` for control flow.**
The loop iterates over models, then over attempts per model. Within the loop, `continue` retries with different parameters and `break` gives up. Non-linear control flow inside a long loop is difficult to follow. There are effectively four separate exit paths: success (return), aspect-ratio timeout (retry once), Gemini timeout (retry once with fallback), and exhausted retries (break/fall through). Each exit path has different state mutations on `currentRoomImage`, `activePrompt`, and `attemptTimings`.

**`render_timing_summary` is emitted from three different places.**
The parallel success path, the parallel failure path, and the serial success path each emit their own `render_timing_summary` with slightly different field sets. The parallel failure path also emits from a `.catch()` block. A consumer reading the diagnostics cannot know which schema variant to expect.

**`TIMEOUT_RETRY_ROOM_MAX_PX` and `TIMEOUT_RETRY_PRODUCT_MAX_PX` are magic numbers in the form of named constants** — but they are not configurable via environment variables. The corresponding primary dimension constants (`MAX_IMAGE_DIMENSION_PX`) are env-configurable. The retry dimensions are hardcoded at 1024 and 640 regardless of what the primary dimensions are set to, which means the fallback path may use a larger image than the primary path if primary is configured below 1024.

---

# Error Handling Review

**Server-side error handling is generally good.**
`render-service.ts`, `session-service.ts`, and the API routes all catch typed errors, provide fallback paths for expected failure modes, and roll back increments (render count, screen budget) on unexpected failures. The Gemini semaphore and Redis clients fail open (allow requests through) rather than blocking all traffic during infrastructure issues.

**`trackSessionEvent` and `openSessionIssue` swallow all errors internally.**
Both functions have a `try/catch` that logs and discards write failures. This is intentional for availability — diagnostics must never fail a render. However, it means that if the diagnostics DB table becomes unavailable, no signal is emitted to operators beyond a `log.warn`. The system has no circuit breaker on the diagnostics write path.

**`releaseGeminiSlot` logs but does not surface failures.**
If the slot cannot be released, subsequent renders in that slot's TTL window are blocked until the TTL expires (5.5 minutes). The failure is logged but there is no alert path. For a production showroom, a single failed slot release would silently prevent further renders for several minutes.

**`after()` is called four times in the render route handler.**
In Next.js, `after()` schedules work after the response is sent. Each call is independent. If `executeRenderPipeline` is registered but an earlier `after()` call throws synchronously, the behavior is framework-dependent and not documented. The four calls (`setDeviceCooldown`, screen timestamp, render hash, analytics, and pipeline) would be clearer and safer as a single `after(async () => { await Promise.allSettled([...]) })` with explicit error handling per task.

**`connectMobileTransition` is defined but the actual service bypasses it.**
The service uses `tryClaimMobileConnection` (a DB-level atomic update) that can succeed without running through the state machine's `connectMobileTransition` guard. If a session is in a state where `connectMobileTransition` would throw, the DB update might still succeed. The atomic update guards only on the DB `status` column values — it does not enforce all state machine preconditions (e.g., `!isLockedStatus`).

**Error messages in `useMobileSession` mix structured typed codes with free-form Arabic text.**
Some error paths use `isRoomPreviewRequestError(err)` and compare typed codes. Others compare `err.code === "timeout"` against a string that is not a member of the typed `RoomPreviewApiErrorCode` union. If the API ever changes a code string, the client-side comparison silently breaks without a TypeScript error.

---

# Diagnostics & Logging Review

**The logging architecture is excellent.**
Pino with child loggers per module, structured JSON in production, human-readable dev output, `err` key auto-serialization, and the `globalThis` hot-reload fix are all correct choices. The module-name field on every log line makes log filtering immediate.

**Session events double as a structured activity log.**
The `session_events` table captures the full session lifecycle from mobile mount to result delivery with typed levels, sources, codes, and arbitrary metadata. This is the most valuable observability artifact in the system and has enabled the admin diagnostics tooling.

**`render_timing_summary` schema is not stable across code paths.**
Three different emitters of the same event type produce different field sets: the serial path includes `uploadMs`, `validationMs`, `retryReason`, `winnerPromptVariant`; the parallel success path includes `winnerAttemptId`, `loserStatuses`, `lateResultIgnored`; the parallel failure path includes `allFailed`, `allTimedOut`. The render errors admin page (`render-errors-queries.ts`) reads these fields with defensive null-checks, but the schema drift creates fragile consumers.

**`GLOBAL_EVENTS_CHANNEL`** in `session-events.ts` publishes all session events to a global Redis channel for "future subscribers." Nothing subscribes to this channel in production. It is a published-but-unread channel that adds Redis write overhead on every session event. Whether this has measurable cost depends on event volume, but the comment "Nothing subscribes to this channel in production yet" is a warning sign that cleanup has been deferred.

**`console.info`/`console.log` calls alongside structured diagnostics** — approximately 20 raw console calls exist in `useMobileSession.ts` and `MobileSessionClient.tsx`. In production these emit to browser DevTools only. They are a second, non-aggregatable log stream that duplicates some of the structured `trackClientSessionEvent` calls.

---

# Duplication Review

**`persistTransition` vs `persistSessionTransition`.**
`session-service.ts` defines `persistTransition(nextSession, statusBefore?)` and `render-service.ts` defines `persistSessionTransition(nextSession)`. Both call `saveSessionState`, `publishRoomPreviewSessionEvent`, and `trackSessionEvent`. The difference is that `session-service`'s version conditionally tracks `session_status_changed` (comparing `statusBefore` and `statusAfter`), while `render-service`'s version compares `nextSession.status` against `updatedSession.status`. These are two independently maintained implementations of the same pattern.

**`getViewStateFromError` / `createActionErrorMessage` / error state branches** are repeated across `handleConnect`, `handleFileSelection`, `handleProductSelect`, `handleProductCodeSelect`, and `handleCreateRender` in `useMobileSession`. Each handler has an almost-identical `catch` block that: checks `isRoomPreviewRequestError`, handles `expired`/`not_found` specially, and sets error state. This five-way duplication means any change to error classification must be applied in five places.

**`session_issue_opened` session event** is emitted from within `openSessionIssue` itself, meaning callers do not need to separately track it. This is good. However, some callers also call `trackSessionEvent` with custom codes adjacent to `openSessionIssue` calls — the intention is not always clear.

**`buildRenderHash`** is implemented twice: once in `render/route.ts` as a local function and once in `render-service.ts` using `createHash`. The hashes serve the same deduplication purpose.

**Auth guard pattern** — every API route that requires session token authentication begins with the same guard call (`guardSession(request, sessionId)`). This is correctly centralized. However, the events route has a custom dual-transport token extraction (header OR cookie) that is not handled by the shared guard, creating a divergent auth pattern for one endpoint.

---

# Testability Review

**Session state machine is fully testable** and has tests (`tests/unit/session-machine.test.ts`). This is the best-tested module.

**`gemini-provider.ts` has zero test coverage** despite being the highest-risk, highest-complexity module in the system. It depends directly on `GoogleGenAI` with no injection point, making unit testing impossible without deep mocking. The `sharp` image library is loaded via dynamic import inside functions, making it impossible to stub. Testing any path through the serial retry loop (timeout → fallback prompt → retry → success/fail) requires a network call or complex test infrastructure.

**`render-service.ts` has zero test coverage.** The `runRoomPreviewRenderPipeline` function has 9 distinct execution paths (success, semaphore full, stuck job recovery, each error type, rollback on failure) with no tests for any of them.

**`session-events.ts` (Redis Pub/Sub) has zero test coverage.** The ref-counting logic, deduplication logic, and fallback-to-memory path are untested.

**`useMobileSession.ts` has zero test coverage.** It is the most complex client-side module in the project.

**The 7 unit tests cover relatively simple logic** (session machine, validators, token generation, cleanup). They are correct and well-structured but represent a thin coverage layer for a production system of this complexity.

**Integration tests cover API endpoints** but mock Prisma using `vi.mock`. This is correct practice for integration tests but means that Prisma schema changes are not caught by the test suite.

**No test verifies the render provider returns a valid image URL.** The entire AI render flow — the core product feature — is exercised only in production.

---

# Findings Table

| Severity | Category | File | Description | Production Risk |
|----------|----------|------|-------------|-----------------|
| Critical | Function Design | `features/room-preview/mobile/useMobileSession.ts` | 1,300-line hook with 30+ returned values; manages 15+ state variables, 6 handlers, 7 effects, and 3 sub-hooks in one module | Any change to one concern risks breaking another; bugs are hard to isolate; performance regressions are invisible |
| Critical | Architecture | `lib/room-preview/render-providers/gemini-provider.ts` | ~1,900-line god file: config, error classes, image loading, Gemini API, timeout wrapping, parallel coordination, serial retry, fallback prompts, diagnostics | Render regression in any of 7 concern areas requires debugging the entire file |
| Critical | Testability | `lib/room-preview/render-providers/gemini-provider.ts` | Zero test coverage; no injection points for Gemini SDK or sharp; entire production render path is untested | Silent regressions in retry logic, timeout handling, or prompt switching |
| Critical | Testability | `lib/room-preview/render-service.ts` | Zero test coverage for `runRoomPreviewRenderPipeline`; 9 execution paths untested | Budget rollback, semaphore release, and state transition correctness are unverified |
| High | Architecture | `app/api/room-preview/sessions/[sessionId]/render/route.ts` | 444-line route handler with 10+ distinct responsibilities inlined | A change to rate limiting can break state transitions; hard to read, hard to change |
| High | Duplication | `lib/room-preview/session-service.ts` + `lib/room-preview/render-service.ts` | `persistTransition` and `persistSessionTransition` are two independent implementations of the same save-publish-track pattern | Divergence over time; one implementation will drift from the other |
| High | Architecture | `features/room-preview/mobile/useMobileSession.ts` | `getViewStateFromError` / error handling / `isRoomPreviewRequestError` pattern duplicated 5× across handlers | Bug fix in error classification must be applied in 5 places |
| High | Session Flow | `lib/room-preview/session-machine.ts` | `connectMobileTransition` is defined but bypassed in the service layer; service uses direct DB update that does not run all machine preconditions | A session in a locked status could theoretically be claimed by a concurrent mobile connect via DB-level race |
| High | Naming | `lib/room-preview/session-machine.ts` | `assertValidSelectedRoom` throws `RoomPreviewSessionTransitionError` with hardcoded `currentStatus: "mobile_connected"` regardless of actual session status | Misleading error messages in production; incorrect current status in error response |
| High | Render Pipeline | `lib/room-preview/render-providers/gemini-provider.ts` | Module-level constants and per-render env re-reads coexist; any new env-driven constant added without the per-render pattern creates a silent stale-value bug | New developers will add module-level constants only, reintroducing the parallel-branch-not-running bug |
| High | State Management | `features/room-preview/mobile/useMobileSession.ts` | `isSavingProductRef` synchronized with `_setIsSavingProduct` via a non-standard shadow wrapper function; React state and ref diverge if the wrapper is not used consistently | Product save state inconsistencies; possible incorrect render guard behavior |
| High | Testability | `lib/room-preview/session-events.ts` | Redis ref-counting, deduplication, and in-memory fallback path have zero test coverage | SSE stream silently stops receiving events if ref-counting logic has a bug |
| Medium | Diagnostics | `lib/room-preview/session-diagnostics.ts` | Imported and called directly from 10+ files (routes, services, providers); no facade; diagnostics is a global side-effect with no abstraction | Any change to the diagnostics interface requires updating all call sites |
| Medium | Logging | `features/room-preview/mobile/useMobileSession.ts` | ~20 `console.info`/`console.log`/`console.error` calls alongside structured `trackClientSessionEvent`; two separate log streams | Production logs are split; events are not aggregatable from console output |
| Medium | Architecture | `lib/room-preview/` | 38 source files with no sub-grouping; `country-dial-options.ts`, `session-machine.ts`, `gemini-semaphore.ts` are siblings | New developers have no navigation guidance; discovery by filename only |
| Medium | State Management | `features/room-preview/mobile/useMobileSession.ts` | `handleConnect` constructs an optimistic session state manually (lines 648–657) instead of using the server response, bypassing the state machine | Client state can diverge from server state if server returns unexpected status |
| Medium | React Component | `components/room-preview/MobileSessionClient.tsx` | Component handles browser lifecycle, diagnostics, abandon state, QR product coordination, and step rendering in one component | Difficult to test individual steps; changes to lifecycle logic require understanding all render paths |
| Medium | Module Boundary | `lib/generated/prisma/` | Generated Prisma client committed to source control | Confusing diffs; unclear whether schema or generated client is authoritative; generated files can drift from schema on developer machines |
| Medium | Duplication | `app/api/room-preview/sessions/[sessionId]/render/route.ts` | `buildRenderHash` duplicated from a similar hash in `render-service.ts` | Two implementations; if hashing changes, both must be updated |
| Medium | Performance | `lib/room-preview/session-events.ts` | `GLOBAL_EVENTS_CHANNEL` publishes all session events to a Redis channel with no subscribers in production | Unnecessary Redis write on every session state change; dead code that adds latency |
| Medium | Error Handling | `features/room-preview/mobile/useMobileSession.ts` | `renderError.code === "timeout"` compared against untyped string; not a member of `RoomPreviewApiErrorCode` | TypeScript does not catch API code changes; silent mismatch in production |
| Medium | Naming | `lib/room-preview/session-service.ts` | `createRoomPreviewSessionState("pending")` passes `"pending"` as `sessionId` argument; result object id is never used | Misleading; future reader may believe "pending" is a valid sentinel; obscures intent |
| Medium | Architecture | `app/api/room-preview/sessions/[sessionId]/events/route.ts` | Module-level `screenConnectCooldown` Map; `render/route.ts` has similar module-level `renderLimitWarnCooldown`, `deviceCooldownWarnMap`, `screenBudgetWarnMap` Maps | In serverless: accumulate indefinitely in warm instances (memory leak); reset to empty on cold starts (inconsistent dedup behavior) |
| Medium | Function Design | `lib/room-preview/render-providers/gemini-provider.ts` | `generateContentWithTimeout` has an optional `externalAbortSignal` parameter that changes the function's behavior — a flag argument | Serial and parallel code paths use the same function with different meanings |
| Medium | Naming | `lib/room-preview/types.ts` | `RenderResult` and `RoomPreviewRenderResult` are the same type (alias); `MockRoomPreviewProduct` deprecated but still exported | Redundant exports add confusion; deprecations that are never removed erode trust in annotations |
| Medium | Session Flow | `lib/room-preview/session-machine.ts` | `isLockedStatus` list and `isHardLocked` in `selectProductTransition` are independent definitions of overlapping locked-state sets | Future status additions must be applied in both places; will be missed |
| Medium | Architecture | `lib/room-preview/session-machine.ts` | Arabic strings in `markReadyToRenderTransition` error messages; all other transition errors use English | Inconsistent language policy; untranslatable error messages in API responses |
| Medium | Render Pipeline | `lib/room-preview/render-providers/gemini-provider.ts` | `render_timing_summary` emitted from 3 different code paths with different field schemas | Consumers must handle all schema variants defensively; admin tooling has already accumulated null-checks |
| Low | Naming | `lib/room-preview/session-service.ts` | `const isTimeExpired = isEffectivelyExpired` — alias for the same function used only locally | Unnecessary indirection; adds a name to search for with no semantic difference |
| Low | Function Design | `lib/room-preview/session-machine.ts` | `getTimestamp()` is a 1-line wrapper for `new Date().toISOString()` with no additional logic | Not wrong, but adds a name to track with minimal value; direct call is equally clear |
| Low | Testability | `app/api/room-preview/sessions/[sessionId]/render/route.ts` | `getDeviceFingerprint` reads request headers and produces a SHA-256 hash; not exported; cannot be unit tested | Fingerprint behavior cannot be verified without an HTTP request |
| Low | Comments | `lib/room-preview/render-providers/gemini-provider.ts` | Comments in the serial loop sometimes explain what the code does rather than why a non-obvious design choice was made | Low density of why-comments relative to the complexity; future developers will need to re-derive decisions |
| Low | Architecture | `lib/admin/render-errors-queries.ts` | Arabic recommended action strings (`getRecommendedAction`) hardcoded in a server-only query module | Display strings belong in the UI layer or i18n system; query module is not the right location |
| Low | Naming | `features/room-preview/mobile/useMobileSession.ts` | `_setIsSavingProduct` — underscore prefix on a React state setter is a non-standard, unfamiliar pattern | Confusing to developers unfamiliar with the convention in this file |

---

# Technical Debt Assessment

## Level: **High**

**Why:**

The render provider (`gemini-provider.ts`) is the highest-risk file in the system and it currently has zero test coverage. Any change to timeout handling, retry logic, prompt selection, or diagnostics emission requires manual end-to-end testing to verify correctness. This is not sustainable as the AI model, prompt strategy, and retry policy evolve.

The mobile session hook (`useMobileSession.ts`) has accumulated 1,300 lines of tangled state and behavior over time. The pattern of adding more concerns to the hook rather than extracting them is evident from the file's structure — the heartbeat, diagnostics, back-guard, and restart-flow were all added as additional state and effects to an already-large hook. This will continue until a refactor is forced by a bug or capability limitation.

The duplicated `persistTransition` pattern, the two separate `buildRenderHash` implementations, and the five-way duplicated error handler in the hook are all signs of incremental addition without a shared abstraction. These will diverge over time.

The absence of tests for the core product feature (render provider, render service, session events) means that future changes to these areas have no safety net. The cost of validating changes is entirely borne by manual testing in production-like environments.

---

# Maintainability Assessment

## If a new developer joins tomorrow:

### How difficult is onboarding?

**Moderately difficult.** The overall flow (QR → Mobile → Session → Render → Result) is coherent and the session state machine makes the business logic explicit. However, the render provider's `~1,900` lines, the mobile hook's `~1,300` lines, and the render route's `~444` lines are individually overwhelming. A developer who needs to understand the render pipeline will spend most of their ramp time in these three files before they can make a confident change.

### Which areas are easiest to understand?

- `lib/room-preview/session-machine.ts` — pure functions, clear naming, no side effects, well-commented
- `lib/room-preview/session-repository.ts` — clear CRUD operations with explicit type mapping
- `lib/redis.ts` — well-structured, excellent explanatory comments for non-obvious Redis patterns
- `lib/room-preview/gemini-semaphore.ts` — self-contained, Lua scripts explained clearly
- `prisma/schema.prisma` — clean schema with inline documentation on non-obvious fields
- `lib/room-preview/prompt-template-v2.ts` — well-organized with clear variant dispatch

### Which areas are hardest to understand?

1. **`lib/room-preview/render-providers/gemini-provider.ts`** — module-level vs per-render env reads, parallel vs serial branch selection, four custom error classes, three `render_timing_summary` emission sites, serial loop with multiple exit paths
2. **`features/room-preview/mobile/useMobileSession.ts`** — 1,300 lines, 15 state variables, 6 handlers, 7 effects, three overlapping ref/state synchronization patterns
3. **`app/api/room-preview/sessions/[sessionId]/render/route.ts`** — 10+ distinct responsibilities with explicit rollback logic that must be mentally traced for every change
4. **`lib/room-preview/session-events.ts`** — Redis ref-counting, dedup, and dual-transport logic require deep concurrency knowledge to verify correctly

### Which areas create the most future maintenance cost?

1. **Render provider** — every AI model, timeout, retry policy, or diagnostics change happens here; zero test coverage means every change is high-risk
2. **Mobile session hook** — every new mobile feature and every bug fix accumulates here; the hook is already at a size where accidental state variable interactions are probable
3. **Hardcoded Arabic strings scattered across non-UI files** — will need systematic extraction as the product scales or when internationalizing further
4. **Module-level cooldown Maps in route handlers** — will cause subtle production bugs (lost cooldowns on cold start, unbounded growth on warm instances) that are hard to reproduce in development

---

# Final Verdict

### 1. Is this codebase clean?

Partially. The backend service layer and session state machine are clean. The infrastructure abstractions (Redis, semaphore, logger) are clean. The render provider and mobile session hook are not clean by any measure — they are large, multi-responsibility modules with no test coverage.

### 2. Is it production maintainable?

With reservations. The system handles distributed systems concerns correctly and degrades gracefully. Core business logic is protected by atomic DB operations. However, the absence of tests on the render pipeline means that production defects in the highest-risk path are discovered in production, not in CI. A team maintaining this at scale would require significant investment in test coverage for the render and session-events layers before introducing major changes.

### 3. Is it easy for another developer to understand?

The high-level architecture is understandable in a few hours. The session state machine and API layer are teachable. The render provider and mobile hook require days of reading to understand fully and confidently. The mixed-language strings (Arabic embedded in TypeScript) are disorienting for developers who do not read Arabic.

### 4. Top 10 sources of complexity

1. **`gemini-provider.ts`** — multiple concerns, two execution branches, per-render env re-read workaround, zero tests
2. **`useMobileSession.ts`** — 1,300 lines, 15+ state variables, 6 async handlers, 7 effects, manual ref/state sync
3. **`render/route.ts`** — 10+ responsibilities inline, two rollback paths, four `after()` calls
4. **`session-events.ts`** — Redis ref-counting, deduplication, dual in-memory/Redis transport
5. **The `connectMobileTransition` bypass** — state machine defined but not used on the critical connect path
6. **`render_timing_summary` schema variance** — three emitters with different field sets
7. **Module-level Maps in route handlers** — serverless lifecycle mismatch between intent and behavior
8. **Mixed Arabic/English strings across non-UI files** — no single source of truth for user-facing text
9. **Duplicated `persistTransition` logic** — two independently maintained implementations of the same pattern
10. **`assertValidSelectedRoom` fabricated status** — hardcoded error state that does not reflect real session status
