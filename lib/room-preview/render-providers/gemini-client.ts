import "server-only";

import { GoogleGenAI } from "@google/genai";
import {
  GeminiAbortedError,
  GeminiTimeoutError,
} from "@/lib/room-preview/render-providers/gemini-errors";

// ─── Gemini SDK client factory ────────────────────────────────────────────────

export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");
  return new GoogleGenAI({ apiKey });
}

// ─── Per-call timeout wrapper ─────────────────────────────────────────────────
//
// SDK capability (verified against @google/genai 1.49.0):
//   • `config.abortSignal`     — AbortSignal honoured by the SDK fetch layer.
//                                Client-side cancellation (won't stop server-side
//                                billing/processing) but it DOES abort the in-flight
//                                HTTP request so we stop holding the connection.
//   • `config.httpOptions.timeout`     — real fetch-level timeout (ms).
//   • `config.httpOptions.retryOptions.attempts` — SDK's own retry count
//                                (default 5, including on timeouts).
//
// Two layers of defence:
//   1. Promise.race() remains the AUTHORITATIVE gate and always rejects with a
//      typed GeminiTimeoutError after timeoutMs — the provider's retry logic keys
//      off `err instanceof GeminiTimeoutError`, so this must stay the source of truth.
//   2. When the timer fires we now call controller.abort() AND the signal is passed
//      to the SDK *inside config* (previously it was on the top-level params object,
//      where the SDK ignored it — so the underlying fetch was never cancelled). The
//      abort now actually tears down the HTTP request.
//
//   `retryOptions.attempts: 1` disables the SDK's internal 5× retry loop, which
//   otherwise re-issues the request in the background after our timeout fires.
//   `httpOptions.timeout` is set as a backstop comfortably ABOVE our gate so our
//   timer always wins and the typed GeminiTimeoutError stays authoritative.

const SDK_TIMEOUT_BACKSTOP_MS = 30_000;

export async function generateContentWithTimeout(
  ai: GoogleGenAI,
  modelName: string,
  contentRequest: Record<string, unknown>,
  timeoutMs: number,
  externalAbortSignal?: AbortSignal,
) {
  const controller = new AbortController();

  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new GeminiTimeoutError(modelName, timeoutMs));
    }, timeoutMs);
  });

  // Propagate external abort (e.g., from the parallel-attempt winner cancelling the loser).
  const externalAbortPromise = externalAbortSignal
    ? new Promise<never>((_, reject) => {
        if (externalAbortSignal.aborted) {
          controller.abort();
          reject(new GeminiAbortedError());
          return;
        }
        externalAbortSignal.addEventListener(
          "abort",
          () => {
            controller.abort();
            reject(new GeminiAbortedError());
          },
          { once: true },
        );
      })
    : null;

  // abortSignal + httpOptions live INSIDE config (GenerateContentConfig) — that is
  // where the SDK reads them. Merge into any caller-supplied config.
  const existingConfig = (contentRequest.config as Record<string, unknown> | undefined) ?? {};
  const params = {
    model: modelName,
    ...contentRequest,
    config: {
      ...existingConfig,
      abortSignal: controller.signal,
      httpOptions: {
        ...((existingConfig.httpOptions as Record<string, unknown> | undefined) ?? {}),
        timeout: timeoutMs + SDK_TIMEOUT_BACKSTOP_MS,
        retryOptions: { attempts: 1 },
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  // If our timer (or an external abort) cancels the request, the SDK rejects with a
  // raw AbortError. Translate it back to the typed errors the provider expects so the
  // retry/fallback logic still fires regardless of which racer settles first.
  const geminiPromise = ai.models.generateContent(params).catch((err: unknown) => {
    if (timedOut) throw new GeminiTimeoutError(modelName, timeoutMs);
    if (externalAbortSignal?.aborted) throw new GeminiAbortedError();
    throw err;
  });

  const racers: Promise<unknown>[] = [geminiPromise, timeoutPromise];
  if (externalAbortPromise) racers.push(externalAbortPromise);

  try {
    return await Promise.race(racers) as Awaited<typeof geminiPromise>;
  } finally {
    clearTimeout(timer);
  }
}
