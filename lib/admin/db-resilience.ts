import "server-only";

import { getLogger } from "@/lib/logger";

const log = getLogger("admin-data");

// Prisma error codes that are *always* a connectivity / pool problem (never a
// query bug): unreachable DB, timed out, server closed the connection, or the
// connection pool was exhausted.
const ALWAYS_TRANSIENT_PRISMA_CODES = new Set(["P1001", "P1002", "P1008", "P1017", "P2024"]);

// Substrings that indicate a transient DB connectivity / pool-exhaustion error,
// including the Supabase Session-Pooler cap (EMAXCONNSESSION / XX000) surfaced
// by Prisma P2010 "Raw query failed", and node-postgres pool errors. These are
// matched in addition to the codes above so a genuine query bug (e.g. a SQL
// syntax error, also P2010) is NOT swallowed — only real connectivity faults.
const TRANSIENT_MESSAGE_PATTERNS = [
  "max clients reached",
  "emaxconnsession",
  "too many connections",
  "remaining connection slots",
  "connection terminated",
  "connection pool",
  "timed out fetching a new connection",
  "timeout exceeded when trying to connect",
  "server has closed the connection",
  "econnrefused",
  "econnreset",
  "etimedout",
  "53300", // SQLSTATE too_many_connections
  "57p03", // SQLSTATE cannot_connect_now
  "xx000", // SQLSTATE internal_error (Supabase pooler raises this for EMAXCONNSESSION)
];

function collectMessage(err: unknown): string {
  let text = "";
  let cur: unknown = err;
  for (let depth = 0; cur && typeof cur === "object" && depth < 6; depth++) {
    const e = cur as { message?: unknown; code?: unknown; cause?: unknown };
    if (typeof e.message === "string") text += ` ${e.message}`;
    if (typeof e.code === "string") text += ` ${e.code}`;
    cur = e.cause;
  }
  return text.toLowerCase();
}

/**
 * True only for transient DB connectivity / connection-pool-exhaustion errors
 * (e.g. the Supabase Session-Pooler `EMAXCONNSESSION` cap). Genuine query/logic
 * errors return false so they are never silently swallowed.
 */
export function isTransientDbError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && ALWAYS_TRANSIENT_PRISMA_CODES.has(code)) return true;
  const message = collectMessage(err);
  return TRANSIENT_MESSAGE_PATTERNS.some((pattern) => message.includes(pattern));
}

/** Logs an admin dashboard query failure safely (no secret values, no full SQL). */
export function logAdminDataError(scope: string, err: unknown): void {
  log.error(
    {
      scope,
      error:
        err instanceof Error
          ? { name: err.name, code: (err as { code?: string }).code, message: err.message }
          : String(err),
    },
    "admin_dashboard_query_failed",
  );
}
