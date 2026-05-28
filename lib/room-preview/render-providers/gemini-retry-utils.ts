// Pure retry/fallback helper utilities for the Gemini render provider.
// No server-only APIs, no side effects — safe to import from any module
// that already sits behind the server-only boundary of gemini-provider.ts.

/**
 * Short, low-complexity prompt used when attempt 1 times out.
 * Intentionally omits floor-polygon coordinates and quality constraints so Gemini
 * has the best chance of returning quickly within the longer retry budget.
 */
export function buildFallbackPrompt(productName: string | null): string {
  const productRef = productName ? `"${productName}"` : "the provided flooring product";
  return [
    `Replace only the visible floor with ${productRef}.`,
    "Keep walls, furniture, ceiling, lighting, shadows, and perspective unchanged.",
    "Do not modify anything except the floor surface.",
    "Return a realistic photo result.",
  ].join("\n");
}

export function isRetryableError(error: unknown): boolean {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status: number }).status;
    return status === 503 || status === 429;
  }
  return false;
}

export async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
