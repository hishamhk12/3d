import "server-only";

// ─── Spec types ───────────────────────────────────────────────────────────────

type EnvSpec = {
  /** Environment variable name */
  key: string;
  /** One-line description shown in the error message */
  hint: string;
  /**
   * When true the variable is only enforced when NODE_ENV === "production".
   * Dev fallbacks exist in code for these; they must be set before going live.
   */
  productionOnly?: boolean;
};

// ─── Required variables ───────────────────────────────────────────────────────

const REQUIRED: EnvSpec[] = [
  {
    key: "DATABASE_URL",
    hint: 'PostgreSQL connection string, e.g. "postgresql://user:pass@host:5432/db"',
  },
  {
    key: "SESSION_TOKEN_SECRET",
    hint: "HMAC secret for session token signing — generate with: openssl rand -hex 32",
    productionOnly: true,
  },
  {
    key: "CLEANUP_SECRET",
    hint: "Secret for the /api/room-preview/cleanup cron endpoint — generate with: openssl rand -hex 32",
    productionOnly: true,
  },
  {
    key: "NEXT_PUBLIC_BASE_URL",
    hint: 'Public URL of the deployed app, e.g. "https://ibdaa360.com" — required to generate QR codes',
    productionOnly: true,
  },
  {
    key: "ADMIN_JWT_SECRET",
    hint: "HMAC secret for admin session cookies — generate with: openssl rand -hex 32",
    productionOnly: true,
  },
  {
    key: "SELLER_SESSION_SECRET",
    hint: "Signing secret for the seller_session JWT (separate from admin/customer secrets) — generate with: openssl rand -hex 32",
    productionOnly: true,
  },
  {
    key: "CHATBOT_FASTAPI_URL",
    hint: 'Base URL of the chatbot FastAPI service for the seller-chat proxy, e.g. "http://localhost:8001" (server-only, private network — never NEXT_PUBLIC_)',
    productionOnly: true,
  },
  {
    key: "EXTERNAL_SELLER_JWT_SECRET",
    hint: "Signs the short-lived external-seller token sent to FastAPI /internal/chat. MUST match the FastAPI service value and stay SEPARATE from SELLER_SESSION_SECRET and INTERNAL_JWT_SECRET — generate with: openssl rand -hex 32",
    productionOnly: true,
  },
  {
    key: "INTERNAL_JWT_SECRET",
    hint: "Signs the short-lived internal ADMIN token for admin→FastAPI calls (import/status/metrics). MUST match the FastAPI service value and stay SEPARATE from EXTERNAL_SELLER_JWT_SECRET and SELLER_SESSION_SECRET — generate with: openssl rand -hex 32",
    productionOnly: true,
  },
  {
    key: "GEMINI_API_KEY",
    hint: "Google Gemini API key — required by the render pipeline",
    productionOnly: true,
  },
  {
    key: "REDIS_URL",
    hint: "Redis connection URL — required for distributed rate limiting, render locks, and SSE pub/sub across serverless instances. Without it, rate limits and real-time events only work on a single process. Use Upstash or Redis Cloud.",
    productionOnly: true,
  },
];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Validate that all required environment variables are present.
 *
 * Call once during server startup (instrumentation.ts → register()).
 * Throws with a clear, actionable message listing every missing variable so
 * the deployment fails immediately rather than serving broken pages.
 *
 * Variables marked `productionOnly` are only enforced when
 * NODE_ENV === "production" — dev fallbacks exist in code for these.
 */
export function validateEnv(): void {
  const isProd = process.env.NODE_ENV === "production";
  const missing: string[] = [];

  for (const { key, hint, productionOnly } of REQUIRED) {
    if (productionOnly && !isProd) continue;
    if (!process.env[key]) {
      missing.push(`  ${key}\n    → ${hint}`);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `[startup] Server cannot start — missing required environment variable(s):\n\n` +
        missing.join("\n\n") +
        `\n\nSee .env.example for full documentation on each variable.`,
    );
  }

  // The three JWT secrets are SEPARATE trust boundaries and must never share a
  // value. Enforced in production (where all three are set); a dev with only
  // some set is not blocked.
  if (isProd) {
    const secrets: Array<[string, string | undefined]> = [
      ["INTERNAL_JWT_SECRET", process.env.INTERNAL_JWT_SECRET?.trim()],
      ["EXTERNAL_SELLER_JWT_SECRET", process.env.EXTERNAL_SELLER_JWT_SECRET?.trim()],
      ["SELLER_SESSION_SECRET", process.env.SELLER_SESSION_SECRET?.trim()],
    ];
    for (let i = 0; i < secrets.length; i++) {
      for (let j = i + 1; j < secrets.length; j++) {
        const [aName, aVal] = secrets[i];
        const [bName, bVal] = secrets[j];
        if (aVal && bVal && aVal === bVal) {
          throw new Error(
            `[startup] ${aName} and ${bName} must be distinct secrets (separate trust boundaries).`,
          );
        }
      }
    }
  }
}
