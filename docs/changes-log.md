# Changes Log

Manual record of significant code changes to the render pipeline, admin tooling, and diagnostics.
Each entry documents what changed, why, and how to test or revert it.

---

## 2026-05-28 09:00 — Fix Parallel Gemini Branch Condition

### Goal
Ensure the parallel Gemini attempt branch actually executes when the env flag is set, regardless of Lambda warm-start or webpack build-time inlining.

### Problem Before
`ENABLE_PARALLEL_GEMINI_ATTEMPTS` and `PARALLEL_GEMINI_ATTEMPTS` were module-level constants evaluated once at cold start. Webpack could inline `process.env.*` to `false` at build time, making the `if` condition permanently false even when the env var was later set to `true`. Parallel mode never ran in production.

### Changes Made
- `lib/room-preview/render-providers/gemini-provider.ts`
  - Added per-render reads: `perRenderEnableParallel` and `perRenderParallelAttempts` inside `render()`.
  - Changed the parallel-branch `if` condition to use per-render reads instead of module constants.
  - Added stale-constant warning log when per-render read disagrees with module constant.
  - Emits `render_branch_resolved` session event with both module and per-render values.

### Behavior After
The parallel branch is evaluated fresh on every render call. If `ROOM_PREVIEW_ENABLE_PARALLEL_GEMINI_ATTEMPTS=true` is set in the environment, it takes effect without requiring a cold start. Diagnostics log when module constant and per-render read disagree.

### Risk Level
Low — additive diagnostics + condition fix. Serial path unchanged.

### How to Test
1. Set `ROOM_PREVIEW_ENABLE_PARALLEL_GEMINI_ATTEMPTS=true` in `.env.local`.
2. Trigger a render.
3. Check session diagnostics → "Render Branch Resolved" event should show `branch: parallel`.
4. Check server logs for `render_branch_resolved` with `branch: parallel`.

### How to Revert
- Revert the commit or restore:
  - `lib/room-preview/render-providers/gemini-provider.ts`

### Related Env Variables
```env
ROOM_PREVIEW_ENABLE_PARALLEL_GEMINI_ATTEMPTS=false
ROOM_PREVIEW_PARALLEL_GEMINI_ATTEMPTS=2
```

### TypeScript Result
✅ Pass

---

## 2026-05-28 09:30 — Improve Parallel Render Failure Diagnostics

### Goal
When both parallel Gemini attempts timeout or fail, emit rich diagnostics events (`render_timing_summary`, `render_diagnostics_snapshot`) so the admin diagnostics page shows per-attempt detail rather than just the top-level `gemini_timeout` error.

### Problem Before
On parallel render failure, neither `render_timing_summary` nor `render_diagnostics_snapshot` was emitted. The diagnostics view showed only `render_failed` with `failureReason: gemini_timeout`, with no visibility into individual attempt durations or which attempt failed first. Error message said "Gemini call timed out after 30s" even when two parallel attempts both failed.

### Changes Made
- `lib/room-preview/render-providers/gemini-provider.ts`
  - Added `ParallelGeminiAllFailedError` class carrying `attemptTimings`, `allTimedOut`, `numAttempts`, `failureReason`.
  - `runParallelGeminiAttempts` now catches `raceToFirstSuccess` rejection and wraps it in `ParallelGeminiAllFailedError`.
  - On parallel failure: emits `render_timing_summary` (level: warning) with normalized attempt table, `winnerAttemptId: null`, `allFailed: true`.
  - On parallel failure: emits `render_diagnostics_snapshot` with null output URL.
  - On parallel success: normalizes attempt timings to serial-compatible `{ attempt: number }` format for UI consistency.
  - Error message when all timed out: `"Both parallel Gemini attempts timed out after 30s"`.
- `app/(admin)/admin/diagnostics/[sessionId]/_components/TimelineClient.tsx`
  - Added `render_branch_resolved` to `JOURNEY_EVENT_TYPES`.
  - Added `render_branch_resolved: "Render Branch Resolved"` to `EVENT_LABELS`.

### Behavior After
Failed parallel renders emit full diagnostics. The Render Performance card shows `Gemini API call (2 parallel attempts)`, individual attempt rows (Attempt 1: timed out, Attempt 2: timed out), and `Winner: none`. Error message is human-readable.

### Risk Level
Medium — changes error propagation path in parallel mode, which is non-default.

### How to Test
1. Set `ROOM_PREVIEW_ENABLE_PARALLEL_GEMINI_ATTEMPTS=true`, `ROOM_PREVIEW_GEMINI_FIRST_ATTEMPT_TIMEOUT_MS=5000` (very short to force timeout).
2. Trigger a render.
3. Check session diagnostics → timeline should show `render_timing_summary` with `allFailed: true`.
4. Render Performance card should show two attempt rows with `timed_out` status.

### How to Revert
- Revert the commit or restore:
  - `lib/room-preview/render-providers/gemini-provider.ts`
  - `app/(admin)/admin/diagnostics/[sessionId]/_components/TimelineClient.tsx`

### Related Env Variables
```env
ROOM_PREVIEW_ENABLE_PARALLEL_GEMINI_ATTEMPTS=false
ROOM_PREVIEW_GEMINI_FIRST_ATTEMPT_TIMEOUT_MS=30000
```

### TypeScript Result
✅ Pass

---

## 2026-05-28 10:00 — Add Render Branch Diagnostics Card to Session Diagnostics

### Goal
Show which render branch (serial / parallel) was chosen for each render, including raw env values and winner attempt, directly in the single-session diagnostics page.

### Problem Before
The session diagnostics page showed render timing but no visibility into the branch decision. Admins could not see whether parallel was enabled, what env values were read at render time, or which parallel attempt won.

### Changes Made
- `app/(admin)/admin/diagnostics/[sessionId]/page.tsx`
  - Added `RenderBranchMeta` type.
  - Added `extractRenderBranch(timeline)` — reads most recent `render_branch_resolved` event, supplements with `winnerAttemptId` and `attemptCount` from timing summary.
  - Added `BranchRow` and `RenderBranchCard` components.
  - Card shows: branch badge (green = parallel, grey = serial), parallel enabled/attempts, raw env values, winner attempt ID, attempt count, Vercel region.
  - Amber warning shown when raw env says `true` but resolved branch is `serial` (staleness indicator).
  - Updated `RenderPerformanceCard`: Gemini stage shows "(N parallel attempts)" in parallel mode; attempt rows use consistent status coloring; winner row displayed below attempt table.

### Behavior After
Session diagnostics page now has a "Render Branch" card immediately below the render performance grid showing full branch decision context.

### Risk Level
Low — read-only diagnostics UI, no runtime behavior changes.

### How to Test
1. Trigger a render (parallel or serial).
2. Open `/admin/diagnostics/[sessionId]`.
3. Verify "Render Branch" card appears with correct branch, env values, and attempt details.

### How to Revert
- Restore `app/(admin)/admin/diagnostics/[sessionId]/page.tsx` to previous version.

### Related Env Variables
```env
ROOM_PREVIEW_ENABLE_PARALLEL_GEMINI_ATTEMPTS=false
ROOM_PREVIEW_PARALLEL_GEMINI_ATTEMPTS=2
```

### TypeScript Result
✅ Pass

---

## 2026-05-28 11:00 — Add Render Errors Log Admin Page

### Goal
Provide a dedicated admin page listing all failed render jobs with correlated diagnostics, filters, summary stats, and per-row expandable detail panels — enabling faster triage of render failures.

### Problem Before
Render failures were only visible through the general session diagnostics page one session at a time. There was no aggregated view of all failed renders, no filtering by failure reason or branch, and no quick way to spot patterns across multiple failures.

### Changes Made
- `lib/admin/render-errors-queries.ts` *(new file)*
  - `getRenderErrors(filters)` — queries up to 200 failed `RenderJob` rows + up to 5000 correlated `SessionEvent` rows (5 event types), correlates by `metadata.renderJobId`, applies in-memory branch/product filters.
  - `computeRenderErrorSummary(records)` — derives 7 summary stats in memory.
  - Types: `RenderErrorFilters`, `AttemptRow`, `RenderErrorRecord`, `RenderErrorSummary`.
  - `getRecommendedAction()` maps failure reason + context to Arabic recommended action string.
- `app/(admin)/admin/render-errors/_components/RenderErrorsTable.tsx` *(new file)*
  - Client component: 20-column horizontally scrollable table with expandable detail rows.
  - Expanded row: error message, attempt timings table, raw JSON panels for timing/branch/snapshot metadata.
  - Arabic recommended action with `dir="rtl"`.
  - Links each session ID to `/admin/diagnostics/[sessionId]`.
- `app/(admin)/admin/render-errors/page.tsx` *(new file)*
  - Server page with filter form (date range, failure reason, branch, product, session ID, job ID).
  - 7 summary cards: total errors, gemini timeouts, parallel failures, prompt-only, missing snapshots, avg duration, top reason.
  - 3 bar charts: errors by reason, branch distribution, floor detection.
  - Default view: last 7 days of failed jobs.
- `app/(admin)/admin/_components/admin-header.tsx`
  - Added "Render Errors" nav link after "Diagnostics".

### Behavior After
New page at `/admin/render-errors` lists all failed renders with filters, stats, charts, and expandable diagnostics. Navigation item appears in admin header.

### Risk Level
Low — read-only admin page, no changes to runtime render pipeline.

### How to Test
1. Navigate to `/admin/render-errors`.
2. Verify table shows failed render jobs from the last 7 days.
3. Test each filter field (date, reason, branch, product, session, job).
4. Expand a row to verify diagnostics panel renders correctly.
5. Click a session ID link — confirm it navigates to the correct diagnostics page.

### How to Revert
- Delete:
  - `lib/admin/render-errors-queries.ts`
  - `app/(admin)/admin/render-errors/` (entire directory)
- Revert `app/(admin)/admin/_components/admin-header.tsx`.

### Related Env Variables
None — read-only query page.

### TypeScript Result
✅ Pass

---

## 2026-05-28 12:00 — Add Error Aggregation by Reason to Render Errors Page

### Goal
Show grouped counts by derived error category at the top of the Render Errors Log page, with clickable filter cards so admins can quickly drill into a specific error type.

### Problem Before
The Render Errors Log showed a flat table and a raw "Errors by Reason" bar chart. There was no quick way to click on an error category and filter the table to matching rows. Categories like "both parallel attempts timed out" or "missing snapshot" were not surfaced as actionable groups.

### Changes Made
- `lib/admin/render-errors-queries.ts`
  - Added `ReasonGroupCount` type.
  - Added `REASON_GROUP_DEFS` — 10 group definitions with keys, English/Arabic labels, color tags, and match predicates. Groups: `both_parallel_timed_out`, `gemini_timeout`, `prompt_only_mode`, `floor_polygon_missing`, `missing_snapshot`, `output_validation_failed`, `storage_upload_failed`, `material_unclear`, `floor_not_visible`, `unknown`.
  - Added `computeReasonGroups(records)` — returns only groups with `count > 0`, with percentage of total.
  - Added `filterByReasonGroup(records, key)` — applies group predicate to filter records in memory.
- `app/(admin)/admin/render-errors/_components/ReasonFilterCards.tsx` *(new file)*
  - Client component using `useSearchParams` / `useRouter` for URL navigation.
  - Renders "All Errors" card + one card per active group.
  - Each card shows: label, count badge, percentage, Arabic label.
  - Active card is highlighted. Clicking updates `?reasonGroup=` param without losing other filters.
  - "Clear filter" button removes the param.
- `app/(admin)/admin/render-errors/page.tsx`
  - Fetches `allRecords` without `reasonGroup` (for aggregation counts + charts).
  - Applies `filterByReasonGroup` in-memory to get `tableRecords`.
  - Renders `<ReasonFilterCards>` between summary cards and charts, wrapped in `<Suspense>`.
  - Hidden `<input name="reasonGroup">` in the filter form preserves active group on form submit.
  - Active-filter banner above the table shows current group and record count.
  - "Clear" nav link strips all params including `reasonGroup`.

### Behavior After
Clicking a reason card (e.g. "Both Parallel Timed Out") filters the table to matching rows. Aggregation counts always reflect the full date-filtered dataset, not the currently selected group. Group filter and form filters compose correctly.

### Risk Level
Low — all filtering is in-memory on already-fetched data; no new DB queries.

### How to Test
1. Open `/admin/render-errors`.
2. Verify reason cards appear above the charts with counts and percentages.
3. Click "Gemini Timeout" — table should show only `failureReason: gemini_timeout` rows.
4. Change date range with filter form — verify the reason group is preserved.
5. Click "All Errors" — verify full table restores.
6. Click "Clear" — verify all filters including reason group are removed.

### How to Revert
- Revert additions to `lib/admin/render-errors-queries.ts`.
- Delete `app/(admin)/admin/render-errors/_components/ReasonFilterCards.tsx`.
- Restore `app/(admin)/admin/render-errors/page.tsx` to previous version.

### Related Env Variables
None.

### TypeScript Result
✅ Pass

---

## 2026-05-28 14:00 — Serial Adaptive Retry: Fallback Prompt on Gemini Timeout

### Goal
Improve render success rate by using a shorter, simpler fallback prompt on the second serial attempt after a timeout. Timeout budgets updated to match real-world Gemini response latency. New session events emitted so the diagnostics timeline clearly shows attempt-1 timeout → retry with fallback prompt.

### Problem Before
- Attempt 1 timeout (25s) was too short, causing unnecessary retries.
- Attempt 2 used the same full prompt as attempt 1 (rebuilt from `buildRenderPrompt`) — if Gemini timed out on the complex prompt once, it would likely timeout again.
- Attempt 2 timeout (90s) was longer than needed; total max render time could reach ~115s.
- No `gemini_attempt_timeout` or `gemini_retry_started` session events were emitted — the diagnostics timeline showed only `render_failed` with no intermediate visibility into the retry.
- `render_timing_summary` had no `mode` field in the serial path, making it hard to distinguish normal serial from retried serial in the admin tools.

### Changes Made
- `lib/room-preview/render-providers/gemini-provider.ts`
  - `GEMINI_FIRST_ATTEMPT_TIMEOUT_MS` default: `25 000ms` → `30 000ms`.
  - `GEMINI_RETRY_ATTEMPT_TIMEOUT_MS` default: `90 000ms` → `60 000ms`.
  - Added `buildFallbackPrompt(productName)` — 4-line focused prompt (replace floor, keep everything else, return realistic result). No floor-polygon coordinates, no quality constraints.
  - Added `currentPromptVariant: "normal" | "fallback"` tracking variable in serial loop.
  - Added `promptVariant` field to every entry in `attemptTimings` array.
  - On `GeminiTimeoutError && !timeoutRetried`:
    - Emits `gemini_attempt_timeout` session event (level: warning) — now visible in diagnostics timeline.
    - Sets `currentPromptVariant = "fallback"` and `activePrompt = buildFallbackPrompt(product.name)`.
    - Emits `gemini_retry_started` session event (level: info) with `promptVariant: "fallback"`, retry timeout, and image dimensions.
    - Images still reloaded at reduced dimensions (1024px room / 640px product) as before.
  - `render_timing_summary` on success now includes `mode: "serial_adaptive"` when retry happened, `mode: "serial"` otherwise, and `winnerPromptVariant` field.
- `app/(admin)/admin/diagnostics/[sessionId]/_components/TimelineClient.tsx`
  - Added `gemini_attempt_timeout`, `gemini_retry_started`, `gemini_retry_succeeded` to `JOURNEY_EVENT_TYPES`.
  - Added labels for all three event types.

### Behavior After
- Serial mode is the stable default (`ROOM_PREVIEW_ENABLE_PARALLEL_GEMINI_ATTEMPTS` defaults to `false`).
- Attempt 1: 30s timeout, normal full prompt.
- If attempt 1 times out: attempt 2 starts automatically with a shorter prompt and smaller images, 60s timeout.
- If attempt 2 succeeds: `result_ready` — user sees the render.
- If attempt 2 also fails: `render_failed` — retry UI shown.
- Total max render time: ≈30s + 60s + overhead = ~92–95s.
- Diagnostics timeline shows: `gemini_attempt_timeout` → `gemini_retry_started` → `render_timing_summary` (or `render_failed`).
- `render_timing_summary` `attemptTimings` array shows `promptVariant: "normal"` for attempt 1 and `promptVariant: "fallback"` for attempt 2.

### Risk Level
Medium — changes the retry prompt and timeout budgets. The fallback prompt is simpler and omits floor-polygon coordinates; output quality on retry may be slightly lower but the render succeeds instead of failing. Parallel mode is unchanged.

### How to Test
1. Set `ROOM_PREVIEW_GEMINI_FIRST_ATTEMPT_TIMEOUT_MS=1000` (force timeout).
2. Trigger a render.
3. Observe server logs: `gemini_attempt_timeout` then `gemini_retry_started` with `promptVariant: fallback`.
4. Open `/admin/diagnostics/[sessionId]` → Journey tab should show `Gemini Attempt Timeout` and `Gemini Retry Started` events.
5. If attempt 2 succeeds: session status is `result_ready`; `render_timing_summary` has `mode: serial_adaptive`, `winnerPromptVariant: fallback`.
6. Reset `ROOM_PREVIEW_GEMINI_FIRST_ATTEMPT_TIMEOUT_MS=30000`.

### How to Revert
- Restore `lib/room-preview/render-providers/gemini-provider.ts` to previous version.
- Restore `app/(admin)/admin/diagnostics/[sessionId]/_components/TimelineClient.tsx`.

### Related Env Variables
```env
ROOM_PREVIEW_ENABLE_PARALLEL_GEMINI_ATTEMPTS=false
ROOM_PREVIEW_GEMINI_FIRST_ATTEMPT_TIMEOUT_MS=30000
ROOM_PREVIEW_GEMINI_RETRY_ATTEMPT_TIMEOUT_MS=60000
ROOM_PREVIEW_RENDER_LONG_EDGE=1024
```

### TypeScript Result
✅ Pass
