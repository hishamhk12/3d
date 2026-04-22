import "server-only";

import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

// In Next.js dev mode, webpack hot-reloads can re-execute this module multiple
// times within the same Node.js process, creating a new pino transport pipeline
// on each reload. Each pipeline adds unpipe/error/close/finish listeners to the
// underlying WriteStream, quickly exceeding Node's default cap of 10 and
// triggering MaxListenersExceededWarning. Caching on globalThis ensures a single
// pino instance survives across hot-reloads.
declare global {
  // eslint-disable-next-line no-var
  var __pinoRootLogger: pino.Logger | undefined;
}

/**
 * Root Pino logger.
 *
 * - Development: human-readable output via pino-pretty
 * - Production:  newline-delimited JSON, ready for log aggregators
 *
 * Set LOG_LEVEL env var to override the default ("debug" in dev, "info" in prod).
 */
export const logger = globalThis.__pinoRootLogger ?? (globalThis.__pinoRootLogger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
  // Automatically serialize Error objects placed under the `err` key.
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
  },
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss.l",
            ignore: "pid,hostname",
            messageFormat: "{module} › {msg}",
          },
        },
      }
    : {
        // Production: attach env so log aggregators can filter by environment.
        base: { env: process.env.NODE_ENV ?? "production" },
      }),
}));

/**
 * Return a child logger scoped to a named module.
 *
 * Usage:
 *   const log = getLogger("render-service")
 *   log.info({ sessionId }, "Render started")
 *   log.error({ err, sessionId }, "Render pipeline failed")
 */
export function getLogger(module: string): pino.Logger {
  return logger.child({ module });
}
