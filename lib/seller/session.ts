import "server-only";

// Signed seller session tokens (JWT/HS256 via `jose`) stored in a dedicated
// httpOnly cookie. SEPARATE from the admin (`admin_session`) and room-preview
// (`rp-*`) cookies/secrets — no cookie or secret is shared between flows.
//
// The token carries ONLY `sub` (seller id) and `tokenVersion`. Identity, role,
// status, and showroom are re-derived from the 3d database on every protected
// request (see account-access.ts). Tampering invalidates the signature.
import { SignJWT, jwtVerify } from "jose";

export const SELLER_SESSION_COOKIE = "seller_session";

const SELLER_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const ISSUER = "3d-app";
const AUDIENCE = "seller";
const MIN_SECRET_LENGTH = 32;

// Dev-only fallback so the app boots locally without setup. Refused in
// production (see getSecretKey). Never a real secret.
const DEV_FALLBACK_SECRET =
  "dev-insecure-seller-secret-please-set-SELLER_SESSION_SECRET";

function isWeakSecret(value: string | undefined | null): boolean {
  if (!value) return true;
  const v = value.trim();
  if (v.length < MIN_SECRET_LENGTH) return true;
  const lower = v.toLowerCase();
  return lower.includes("change-me") || lower.includes("insecure");
}

function getSecretKey(): Uint8Array {
  const value = process.env.SELLER_SESSION_SECRET;
  if (isWeakSecret(value)) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "SELLER_SESSION_SECRET is missing, too short (< 32 chars), or still a " +
          "default placeholder. Set a strong SELLER_SESSION_SECRET before running in production.",
      );
    }
    return new TextEncoder().encode(
      value && value.trim().length > 0 ? value : DEV_FALLBACK_SECRET,
    );
  }
  return new TextEncoder().encode(value as string);
}

export interface SellerSessionInput {
  id: string;
  tokenVersion: number;
}

// Only `sub` and `tokenVersion` are trusted on read; everything else is resolved
// from the database.
export interface SellerSessionClaims {
  sub: string;
  tokenVersion: number;
}

/** Mint a signed seller session token. */
export async function createSellerToken(input: SellerSessionInput): Promise<string> {
  return new SignJWT({ tokenVersion: input.tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(input.id)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SELLER_SESSION_TTL_SECONDS}s`)
    .sign(getSecretKey());
}

/**
 * Verify signature/expiry/issuer/audience and validate claim shape. Returns the
 * trusted claims, or null for any malformed/expired/incorrectly-signed token.
 * tokenVersion: missing => 0; otherwise must be a finite non-negative integer.
 */
export async function verifySellerToken(
  token: string | undefined | null,
): Promise<SellerSessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (typeof payload.sub !== "string" || payload.sub.length === 0) return null;

    const tv = (payload as { tokenVersion?: unknown }).tokenVersion;
    let tokenVersion: number;
    if (tv === undefined) {
      tokenVersion = 0;
    } else if (typeof tv === "number" && Number.isInteger(tv) && tv >= 0) {
      tokenVersion = tv;
    } else {
      return null;
    }
    return { sub: payload.sub, tokenVersion };
  } catch {
    return null;
  }
}

export const SELLER_SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SELLER_SESSION_TTL_SECONDS,
};
