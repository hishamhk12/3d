import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

// ─── Device fingerprint ───────────────────────────────────────────────────────

/**
 * Derives a stable 32-char hex fingerprint from the request's IP and
 * User-Agent header. Used to enforce per-device render cooldowns.
 */
export function getDeviceFingerprint(request: Request): string {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip")?.trim() ??
    "";

  const ua = (request.headers.get("user-agent") ?? "").slice(0, 300);

  const input = ip || ua ? `${ip}|${ua}` : "unknown";

  return createHash("sha256")
    .update(input)
    .digest("hex")
    .slice(0, 32);
}

// ─── Response builders ────────────────────────────────────────────────────────

export function tooManyRequests(
  body: { error: string; code?: string },
  retryAfter: number,
): NextResponse {
  return NextResponse.json(body, {
    status: 429,
    headers: { "Retry-After": String(retryAfter) },
  });
}

// ─── Render hash ──────────────────────────────────────────────────────────────

/**
 * Deterministic SHA-256 hash of room+product inputs used for dedup.
 * Two render requests with identical inputs produce the same hash.
 */
export function buildRenderHash(roomImageUrl: string, productId: string): string {
  return createHash("sha256")
    .update(`${roomImageUrl}::${productId}`)
    .digest("hex");
}
