import "server-only";

// Seller password hashing (bcrypt via the pure-JS `bcryptjs` — no native build
// on Windows). Plaintext passwords are never stored, logged, or returned.
//
// bcrypt only consumes the first 72 BYTES of input. Arabic/Unicode characters
// are multi-byte in UTF-8, so length must be validated by UTF-8 byte length, not
// character count. Over-limit input is REJECTED, never silently truncated.
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

/** Minimum password length (characters). */
export const MIN_PASSWORD_LENGTH = 8;

/** bcrypt hard input limit, in UTF-8 bytes. */
export const MAX_PASSWORD_BYTES = 72;

// Fixed, server-only dummy bcrypt hash (cost 12) used to keep login timing flat
// when the seller is absent or has no password. It is a real hash of a random
// string, never matches any password, and is defined once. Not a secret.
export const DUMMY_PASSWORD_HASH =
  "$2b$12$kXKaL4inOBB36BPgJcC7nuRRB7Df6wq8pAs.pSOMhMSXJat/eV3uK";

/** UTF-8 byte length of a password (the value bcrypt actually limits). */
export function passwordByteLength(plain: string): number {
  return Buffer.byteLength(plain, "utf8");
}

/** True when the password fits within bcrypt's 72-byte input limit. */
export function isPasswordWithinByteLimit(plain: string): boolean {
  return passwordByteLength(plain) <= MAX_PASSWORD_BYTES;
}

export async function hashPassword(plain: string): Promise<string> {
  if (!isPasswordWithinByteLimit(plain)) {
    // Never hash an over-limit password — bcrypt would silently truncate it.
    throw new Error("Password exceeds the 72-byte bcrypt input limit.");
  }
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  // Reject over-limit input rather than letting bcrypt truncate it to 72 bytes
  // (which could let a long password match a shorter stored one).
  if (!isPasswordWithinByteLimit(plain)) return false;
  return bcrypt.compare(plain, hash);
}
