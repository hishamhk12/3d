import "server-only";

import { createHash, randomBytes } from "node:crypto";

const TOKEN_PREFIX = "rps_";

export function generateScreenToken(): string {
  return TOKEN_PREFIX + randomBytes(24).toString("hex");
}

export function hashScreenToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isValidScreenTokenFormat(token: string): boolean {
  return token.startsWith(TOKEN_PREFIX) && token.length > TOKEN_PREFIX.length;
}
