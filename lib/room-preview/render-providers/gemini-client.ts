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
// Promise.race() is the authoritative timeout gate — it fires after timeoutMs
// regardless of whether the SDK honours the AbortSignal. AbortController is
// still passed so the SDK can clean up its HTTP connection on a best-effort
// basis, but the caller is never blocked beyond timeoutMs.

export async function generateContentWithTimeout(
  ai: GoogleGenAI,
  modelName: string,
  contentRequest: Record<string, unknown>,
  timeoutMs: number,
  externalAbortSignal?: AbortSignal,
) {
  const controller = new AbortController();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params = { model: modelName, ...contentRequest, abortSignal: controller.signal } as any;
  const geminiPromise = ai.models.generateContent(params);

  const racers: Promise<unknown>[] = [geminiPromise, timeoutPromise];
  if (externalAbortPromise) racers.push(externalAbortPromise);

  try {
    return await Promise.race(racers) as Awaited<typeof geminiPromise>;
  } finally {
    clearTimeout(timer);
  }
}
