/**
 * Admin session token utilities.
 *
 * Uses the Web Crypto API (SubtleCrypto) intentionally — it works in both
 * Edge runtime (middleware) and Node.js (server actions), so the same
 * verify function can be called from either context.
 *
 * Token format:  base64url(JSON payload) . base64url(HMAC-SHA256 signature)
 */

export const ADMIN_SESSION_COOKIE = "admin_session";
const TOKEN_EXPIRY_SECONDS = 8 * 60 * 60; // 8 hours

// ─── Internal helpers ─────────────────────────────────────────────────────────

function encodeBase64Url(bytes: ArrayBuffer): string {
  const u8 = new Uint8Array(bytes);
  let binary = "";
  for (const byte of u8) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(str: string): Uint8Array {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function getHmacKey(): Promise<CryptoKey> {
  const secret = process.env.ADMIN_JWT_SECRET;

  if (!secret) {
    throw new Error(
      process.env.NODE_ENV === "production"
        ? "ADMIN_JWT_SECRET is required in production. Generate one with: openssl rand -hex 32"
        : "ADMIN_JWT_SECRET is not set. Add it to .env.local to use the admin panel in development.",
    );
  }

  const keyBytes = new TextEncoder().encode(secret);
  return crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a signed admin session token.
 * Call this after validating credentials — store the result in the session cookie.
 */
export async function signAdminToken(): Promise<string> {
  const payload = JSON.stringify({
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + TOKEN_EXPIRY_SECONDS,
  });

  const encodedPayload = btoa(payload)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const key = await getHmacKey();
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(encodedPayload),
  );

  return `${encodedPayload}.${encodeBase64Url(signature)}`;
}

/**
 * Verify an admin session token.
 * Returns true only if the signature is valid AND the token has not expired.
 * Safe to call from Edge middleware.
 */
export async function verifyAdminToken(token: string): Promise<boolean> {
  try {
    const dotIndex = token.lastIndexOf(".");
    if (dotIndex === -1) return false;

    const encodedPayload = token.slice(0, dotIndex);
    const encodedSig = token.slice(dotIndex + 1);

    if (!encodedPayload || !encodedSig) return false;

    const key = await getHmacKey();
    const sigBytes = decodeBase64Url(encodedSig);

    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes as unknown as ArrayBuffer,
      new TextEncoder().encode(encodedPayload),
    );

    if (!valid) return false;

    const payloadJson = atob(encodedPayload.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(payloadJson) as { exp: number };

    return payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}
