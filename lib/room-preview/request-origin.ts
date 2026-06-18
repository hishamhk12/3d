// Resolve the origin to embed in the room-preview QR / mobile URL.
//
// The QR is generated in a Server Component, so it must point at the SAME
// deployment the desktop is currently on (Production → Production, Preview →
// that exact Preview), without baking a domain at build time. We derive the
// origin from the incoming request headers (Vercel sets x-forwarded-host /
// x-forwarded-proto), and only fall back to NEXT_PUBLIC_BASE_URL when no host
// header is available. In development a localhost host is swapped for the LAN IP
// so a phone on the same network can reach the dev machine.

type HeaderGetter = (name: string) => string | null | undefined;

/** Build `proto://host` from the incoming request headers, or null if no host.
 *  x-forwarded-host/proto win over host; comma-separated lists take the first. */
export function originFromHeaders(get: HeaderGetter): string | null {
  const rawHost = get("x-forwarded-host") ?? get("host");
  if (!rawHost) return null;
  const host = rawHost.split(",")[0]?.trim();
  if (!host) return null;

  const isLocal = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)(:|$)/.test(host);
  const rawProto = get("x-forwarded-proto");
  const proto = rawProto?.split(",")[0]?.trim() || (isLocal ? "http" : "https");
  return `${proto}://${host}`;
}

export interface ResolveBaseUrlOptions {
  /** Origin derived from the incoming request (originFromHeaders), if any. */
  headerOrigin: string | null;
  nodeEnv: string | undefined;
  /** Build-time fallback only (never the primary source). */
  publicBaseUrl: string | undefined;
  /** LAN IP + port used ONLY in development when the host is localhost. */
  localIp?: string;
  port?: string;
}

/**
 * Final base-URL resolution order:
 *   1. The incoming request origin (current deployment — Production or Preview).
 *   2. NEXT_PUBLIC_BASE_URL (fallback when there is no request host).
 *   3. Development only: if the result is empty/localhost, use the LAN IP so a
 *      phone on the same network can reach the dev server.
 * Returns null when nothing usable is available.
 */
export function resolveBaseUrl(opts: ResolveBaseUrlOptions): string | null {
  let base = opts.headerOrigin ?? (opts.publicBaseUrl?.replace(/\/$/, "") || "");

  if (
    opts.nodeEnv === "development" &&
    opts.localIp &&
    (!base || base.includes("localhost") || base.includes("127.0.0.1"))
  ) {
    base = `http://${opts.localIp}:${opts.port || "3000"}`;
  }

  return base || null;
}
