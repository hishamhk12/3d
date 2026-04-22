/**
 * instrumentation-client.ts
 *
 * Runs BEFORE React hydration begins (Next.js 15.3+).
 * Safe to use for polyfills and early error patches.
 *
 * iOS Safari throws "TypeError: Type error" when performance.measure() is
 * called with a start mark that doesn't exist yet. Next.js App Router and
 * Sentry both call this API during navigation — if it throws before React
 * hydrates, the entire JS thread halts and the page stays permanently on the
 * splash screen (white/blank). Wrapping it in a no-throw shim fixes this
 * without affecting any other browser or the collected timing data.
 */
if (typeof window !== "undefined" && typeof performance !== "undefined") {
  const _originalMeasure = performance.measure.bind(performance);
  performance.measure = function safePerformanceMeasure(...args) {
    try {
      return _originalMeasure(...args);
    } catch {
      // Safari: missing mark — return undefined (same as old Safari behaviour)
      return undefined as unknown as PerformanceMeasure;
    }
  };
}
