import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { getLogger } from "@/lib/logger";

const log = getLogger("session-token");

// ─── Secret ──────────────────────────────────────────────────────────────────

const DEV_FALLBACK_SECRET = "dev-only-secret-do-not-use-in-production";

function getSecret(): string {
  const secret = process.env.SESSION_TOKEN_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "[session-token] SESSION_TOKEN_SECRET is required in production. " +
          "Generate one with: openssl rand -hex 32",
      );
    }

    log.warn("SESSION_TOKEN_SECRET is not set — using an insecure dev fallback. Set this variable before deploying.");

    return DEV_FALLBACK_SECRET;
  }

  return secret;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate a session token for the given sessionId.
 * The token is an HMAC-SHA256 over the sessionId, base64url-encoded.
 * It is deterministic: calling this twice with the same sessionId returns the
 * same token, which means no DB storage is required.
 */
export function generateSessionToken(sessionId: string): string {
  return createHmac("sha256", getSecret())
    .update(sessionId)
    .digest("base64url");
}

/**
 * Verify that a token belongs to the given sessionId.
 * Uses a timing-safe comparison to prevent timing attacks.
 */
export function verifySessionToken(token: string, sessionId: string): boolean {
  try {
    const expected = generateSessionToken(sessionId);
    const tokenBuf = Buffer.from(token);
    const expectedBuf = Buffer.from(expected);

    if (tokenBuf.length !== expectedBuf.length) return false;

    return timingSafeEqual(tokenBuf, expectedBuf);
  } catch {
    return false;
  }
}
