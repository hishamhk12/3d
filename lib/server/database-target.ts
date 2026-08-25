import "server-only";

import { createHash } from "node:crypto";

/**
 * A safe identifier for comparing database targets across serverless requests.
 * Credentials and the actual hostname/database name are never written to logs.
 */
export function getDatabaseTargetFingerprint(): string {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return "missing";

  try {
    const url = new URL(connectionString);
    const target = `${url.protocol}//${url.hostname}:${url.port || "default"}${url.pathname}`;
    return createHash("sha256").update(target).digest("hex").slice(0, 12);
  } catch {
    return "invalid";
  }
}
