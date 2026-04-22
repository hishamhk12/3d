export const ROOM_PREVIEW_ROUTES = {
  landing: "/room-preview",
  mobileLauncher: "/room-preview/start",
  screenLauncher: "/room-preview/screen",
  screenSession: (sessionId: string) => `/room-preview/screen/${sessionId}`,
  mobileSession: (sessionId: string) => `/room-preview/mobile/${sessionId}`,
  sessionsApi: "/api/room-preview/sessions",
  sessionApi: (sessionId: string) => `/api/room-preview/sessions/${sessionId}`,
  sessionEventsApi: (sessionId: string) => `/api/room-preview/sessions/${sessionId}/events`,
  connectSessionApi: (sessionId: string) => `/api/room-preview/sessions/${sessionId}/connect`,
  roomApi: (sessionId: string) => `/api/room-preview/sessions/${sessionId}/room`,
  productApi: (sessionId: string) => `/api/room-preview/sessions/${sessionId}/product`,
  renderApi: (sessionId: string) => `/api/room-preview/sessions/${sessionId}/render`,
  screenTokenApi: (sessionId: string) => `/api/room-preview/sessions/${sessionId}/screen-token`,
  cleanupApi: "/api/room-preview/cleanup",
} as const;

// ─── Showroom screen auto-reset timings ──────────────────────────────────────

/** How long the result is displayed before the screen resets for the next
 *  customer (ms). Default: 60 seconds. */
export const SCREEN_RESULT_RESET_MS = 60_000;

/** How long the screen waits for a mobile to connect before giving up and
 *  starting a fresh session (ms). Default: 5 minutes. */
export const SCREEN_IDLE_RESET_MS = 5 * 60_000;

/** How long the failed-render state is shown before resetting (ms).
 *  Default: 15 seconds. */
export const SCREEN_FAILED_RESET_MS = 15_000;

/** How long an error view state (not_found / expired / failed load) is shown
 *  before redirecting back to the launcher (ms). Default: 10 seconds. */
export const SCREEN_ERROR_RESET_MS = 10_000;

/** All timeout / interval values in one place (ms). */
export const ROOM_PREVIEW_TIMEOUTS = {
  REQUEST_MS: 8_000,
  SSE_KEEPALIVE_MS: 15_000,
  // First upload request in dev triggers webpack on-demand compilation of all
  // heavy deps (ioredis, prisma, sharp, aws-sdk) which can take 30–50 s.
  // Keep min/max generous enough that cold-start never produces a spurious error.
  UPLOAD_MIN_MS: 90_000,
  UPLOAD_MAX_MS: 120_000,
  UPLOAD_PER_MB_MS: 3_000,
  // Recovery window: how long to keep polling after the client fetch times out.
  // Must cover the worst-case gap between client abort and server completion.
  UPLOAD_RECOVERY_WINDOW_MS: 60_000,
  UPLOAD_RECOVERY_POLL_MS: 1_500,
  RENDER_TRIGGER_MS: 15_000,
  RENDER_POLL_MS: 2_500,
  RENDER_POLL_TIMEOUT_MS: 310_000,
} as const;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) {
    console.warn(`[config] Invalid SESSION_EXPIRY_MINUTES="${raw}", using ${fallback}`);
    return fallback;
  }
  return n;
}

/** How many minutes until a session is considered expired (default: 60). */
export const SESSION_EXPIRY_MINUTES = parsePositiveInt(
  process.env.SESSION_EXPIRY_MINUTES,
  60,
);
