/**
 * Next.js instrumentation hook — runs once on server startup before any
 * request is handled.
 *
 * Order matters:
 *   1. Validate env — fail immediately with a clear message if anything is
 *      missing rather than crashing on the first request with a cryptic 500.
 *   2. Init Sentry — only reached if the environment is valid.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
declare global {
  // eslint-disable-next-line no-var
  var __cleanupInterval: ReturnType<typeof setInterval> | undefined;
}

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnv } = await import("./lib/env");
    validateEnv();

    await import("./sentry.server.config");

    // In production, Vercel Cron handles cleanup (vercel.json, every 5 min).
    // In dev there is no cron runner, so schedule it in-process instead.
    // The globalThis guard prevents duplicate intervals on hot-reloads.
    if (process.env.NODE_ENV !== "production" && !globalThis.__cleanupInterval) {
      const {
        expireOldSessions,
        expireIdleWaitingSessions,
        failStuckRenderingSessions,
        completeResultReadySessions,
      } = await import("./lib/room-preview/session-cleanup");

      globalThis.__cleanupInterval = setInterval(async () => {
        try {
          const [stuckFailed, completed, idleExpired, expired] = await Promise.all([
            failStuckRenderingSessions(),
            completeResultReadySessions(),
            expireIdleWaitingSessions(),
            expireOldSessions(),
          ]);
          const total = stuckFailed + completed + idleExpired + expired;
          if (total > 0) {
            console.log(
              `[cleanup] expired=${expired} idleExpired=${idleExpired} stuckFailed=${stuckFailed} completed=${completed}`,
            );
          }
        } catch (err) {
          console.error("[cleanup] scheduled cleanup failed", err);
        }
      }, 5 * 60 * 1000);
    }
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}
