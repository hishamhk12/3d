// Typed error classes for the Gemini render provider.
//
// Kept in a separate file so they can be imported in tests without pulling in
// the full provider module (which has server-only side effects and native deps).

// ─── Supporting types ─────────────────────────────────────────────────────────

export type ParallelAttemptTiming = {
  attemptId: string;
  durationMs: number;
  status: "won" | "lost" | "aborted" | "timeout" | "failed";
  timeoutMs: number;
};

// ─── Error classes ────────────────────────────────────────────────────────────

export class AspectRatioMismatchError extends Error {
  readonly failureReason = "output_aspect_ratio_mismatch" as const;
  constructor(
    public readonly driftPercent: number,
    public readonly inputWidth: number,
    public readonly inputHeight: number,
    public readonly outputWidth: number,
    public readonly outputHeight: number,
  ) {
    super(
      `Aspect ratio mismatch: output ${outputWidth}×${outputHeight} vs input ${inputWidth}×${inputHeight} (drift ${driftPercent.toFixed(1)}%)`,
    );
    this.name = "AspectRatioMismatchError";
  }
}

/** Thrown when a parallel-attempt winner cancels the losing attempt's HTTP call. */
export class GeminiAbortedError extends Error {
  readonly code = "GEMINI_ABORTED" as const;
  constructor() {
    super("Gemini call aborted — another parallel attempt won.");
    this.name = "GeminiAbortedError";
  }
}

/**
 * Typed timeout error — carries failureReason so render-service.ts stores
 * "gemini_timeout" on the failed render job automatically via getFailureReason(),
 * without any changes to render-service.ts.
 *
 * Exported so tests can throw it directly without needing fake timers.
 */
export class GeminiTimeoutError extends Error {
  readonly failureReason = "gemini_timeout" as const;
  readonly code = "GEMINI_TIMEOUT" as const;
  readonly retryable = true as const;
  constructor(modelName: string, timeoutMs: number) {
    super(`Gemini call timed out after ${timeoutMs / 1000}s (model: ${modelName})`);
    this.name = "GeminiTimeoutError";
  }
}

/**
 * Thrown when every parallel attempt fails (all timed out, all errored, etc.).
 * Carries per-attempt timing data so the caller can emit rich diagnostics before
 * rethrowing. failureReason is "gemini_timeout" when all timed out so
 * render-service.ts stores the correct failure code without any changes.
 */
export class ParallelGeminiAllFailedError extends Error {
  readonly failureReason: "gemini_timeout" | "gemini_error";
  readonly code = "PARALLEL_ALL_FAILED" as const;
  readonly attemptTimings: ParallelAttemptTiming[];
  readonly numAttempts: number;
  readonly allTimedOut: boolean;

  constructor(
    lastError: unknown,
    attemptTimings: ParallelAttemptTiming[],
    numAttempts: number,
    allTimedOut: boolean,
    timeoutMs: number,
  ) {
    const message = allTimedOut
      ? `Both parallel Gemini attempts timed out after ${timeoutMs / 1000}s`
      : lastError instanceof Error
        ? lastError.message
        : "All parallel Gemini attempts failed";
    super(message);
    this.name = "ParallelGeminiAllFailedError";
    this.failureReason = allTimedOut ? "gemini_timeout" : "gemini_error";
    this.attemptTimings = attemptTimings;
    this.numAttempts = numAttempts;
    this.allTimedOut = allTimedOut;
  }
}
