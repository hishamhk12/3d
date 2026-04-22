import os from "os";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const isProd = process.env.NODE_ENV === "production";

/**
 * Collect every non-loopback IPv4 address on the machine.
 *
 * `allowedDevOrigins` and `serverActions.allowedOrigins` both accept exact
 * hostnames/IPs — NOT CIDR ranges. We enumerate the real addresses so the
 * config stays valid regardless of which DHCP lease the machine received.
 */
function getLanIpAddresses(): string[] {
  const addrs: string[] = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === "IPv4" && !iface.internal) {
        addrs.push(iface.address);
      }
    }
  }
  return addrs;
}

const lanIps = isProd ? [] : getLanIpAddresses();

/**
 * If R2_PUBLIC_URL is set to a custom domain (e.g. https://cdn.example.com),
 * extract its hostname so Next.js image optimization can fetch from it.
 * Standard R2 (**.r2.dev) and S3 patterns are always included below.
 */
const customStoragePattern = (() => {
  const raw = process.env.R2_PUBLIC_URL;
  if (!raw) return null;
  try {
    const { protocol, hostname } = new URL(raw);
    return {
      protocol: protocol.replace(":", "") as "https" | "http",
      hostname,
    };
  } catch {
    return null;
  }
})();
// Next.js 16 compares the full Origin header (host + port) against
// allowedDevOrigins entries. Include both bare IPs and IP:port variants
// so the check passes whether or not the port appears in the header.
const port = process.env.PORT ?? "3000";
const lanOrigins = isProd
  ? []
  : lanIps.flatMap((ip) => [ip, `${ip}:${port}`]);

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Cloudflare R2 public buckets (*.r2.dev)
      { protocol: "https", hostname: "**.r2.dev" },
      // AWS S3 — path-style and virtual-hosted-style URLs
      { protocol: "https", hostname: "**.s3.amazonaws.com" },
      { protocol: "https", hostname: "s3.**.amazonaws.com" },
      // Custom storage domain set via R2_PUBLIC_URL (e.g. cdn.ibdaa360.com)
      ...(customStoragePattern ? [customStoragePattern] : []),
    ],
  },

  // Allow LAN devices (phones, tablets) to load Next.js dev resources.
  // `allowedDevOrigins` unblocks /_next/webpack-hmr cross-origin requests so
  // the JS bundle fully hydrates on a physical phone — without it the page
  // hangs permanently on the splash screen.
  ...(!isProd && lanOrigins.length > 0 && {
    allowedDevOrigins: lanOrigins,
  }),

  // Allow Server Actions submitted from LAN devices.
  // Next.js 15+ validates the Origin header on every Server Action POST; LAN
  // origins are rejected by default, causing silent action failures on mobile.
  ...(!isProd && lanOrigins.length > 0 && {
    experimental: {
      serverActions: {
        allowedOrigins: lanOrigins,
      },
    },
  }),

  async headers() {
    return [
      {
        // Security headers — applied on every response.
        //
        // HSTS is production-only: sending it over plain HTTP (local dev)
        // causes browsers to permanently refuse future HTTP connections.
        //
        // The remaining four are safe in all environments:
        //   X-Frame-Options      — prevents the app from being embedded in
        //                          iframes on other origins (clickjacking).
        //   X-Content-Type-Options — stops browsers guessing MIME types from
        //                          content; prevents script injection via
        //                          crafted uploads served with wrong type.
        //   Referrer-Policy      — sends only the origin (not the full URL)
        //                          in the Referer header so session IDs and
        //                          paths are not leaked to third-party APIs
        //                          (e.g. Gemini, Sentry).
        //   Permissions-Policy   — explicitly revokes camera and microphone
        //                          access; the TV kiosk never needs them and
        //                          this blocks any injected script from
        //                          silently requesting them.
        source: "/(.*)",
        headers: [
          ...(isProd
            ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
            : []),
          { key: "X-Frame-Options",          value: "DENY" },
          { key: "X-Content-Type-Options",   value: "nosniff" },
          { key: "Referrer-Policy",          value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy",       value: "camera=(), microphone=()" },
        ],
      },
      {
        // HTML pages and public assets: allow the browser to cache a copy but
        // require revalidation with the server before each use (conditional GET).
        // This is correct for server-rendered pages — the server can reply 304
        // Not Modified instantly when nothing has changed, saving a full
        // re-download on every navigation.
        //
        // Excludes /_next/** so Next.js can apply its own immutable headers
        // (public, max-age=31536000, immutable) to content-hashed JS/CSS
        // chunks — overriding those would force the TV to re-download the
        // entire app bundle on every page load.
        source: "/((?!_next/).*)",
        headers: [{ key: "Cache-Control", value: "no-cache" }],
      },
      {
        // API routes carry live session / render data and must never be served
        // from any cache layer.  This rule also overrides the no-cache set
        // above (last matching rule wins) and adds CORS headers for mobile
        // clients on the same LAN.
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "Access-Control-Allow-Methods", value: "GET,POST,OPTIONS" },
          {
            key: "Access-Control-Allow-Headers",
            value: "Content-Type, x-session-token, x-cleanup-secret",
          },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // Sentry organisation and project slugs — set these in your CI/CD environment.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Only print Sentry build output in CI to keep local builds quiet.
  silent: !process.env.CI,

  // Upload a larger set of source maps for prettier stack traces (increases build time).
  widenClientFileUpload: true,

  // Removes the Sentry logger from the client bundle (~3.5 kB).
  disableLogger: true,

  // Automatically instrument Vercel Cron Monitors.
  automaticVercelMonitors: true,
});
