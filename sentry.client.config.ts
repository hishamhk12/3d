import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Capture 100 % of transactions in development, 10 % in production.
  // Tune this before going to high traffic.
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // Replay 10 % of sessions, 100 % of sessions with an error.
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],

  // Don't send errors in development unless NEXT_PUBLIC_SENTRY_DSN is explicitly set.
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
});
