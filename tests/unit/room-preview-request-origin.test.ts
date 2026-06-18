import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { originFromHeaders, resolveBaseUrl } from "@/lib/room-preview/request-origin";

const PROD_HOST = "3d-ivory-rho.vercel.app";
const PREVIEW_HOST = "3d-git-chatbot-preview-someteam.vercel.app";

// Helper: a header getter backed by a plain map (case-insensitive keys).
function headerGetter(map: Record<string, string>) {
  const lower = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  return (name: string) => lower[name.toLowerCase()] ?? null;
}

// The full URL the QR encodes = base + activate path.
function mobileUrl(base: string | null, sessionId = "sess1", token = "tok"): string | null {
  if (!base) return null;
  return `${base}/api/room-preview/sessions/${sessionId}/activate?t=${encodeURIComponent(token)}&lang=ar`;
}

describe("originFromHeaders", () => {
  it("uses x-forwarded-host + x-forwarded-proto (Vercel)", () => {
    const get = headerGetter({ "x-forwarded-host": PREVIEW_HOST, "x-forwarded-proto": "https" });
    expect(originFromHeaders(get)).toBe(`https://${PREVIEW_HOST}`);
  });

  it("prefers x-forwarded-host over host", () => {
    const get = headerGetter({ "x-forwarded-host": PREVIEW_HOST, host: PROD_HOST, "x-forwarded-proto": "https" });
    expect(originFromHeaders(get)).toBe(`https://${PREVIEW_HOST}`);
  });

  it("defaults to https for a remote host without an explicit proto", () => {
    expect(originFromHeaders(headerGetter({ host: PROD_HOST }))).toBe(`https://${PROD_HOST}`);
  });

  it("uses http for a localhost host", () => {
    expect(originFromHeaders(headerGetter({ host: "localhost:3000" }))).toBe("http://localhost:3000");
  });

  it("takes the first value of a comma-separated forwarded list", () => {
    const get = headerGetter({ "x-forwarded-host": `${PREVIEW_HOST}, internal`, "x-forwarded-proto": "https, http" });
    expect(originFromHeaders(get)).toBe(`https://${PREVIEW_HOST}`);
  });

  it("returns null when no host header is present", () => {
    expect(originFromHeaders(headerGetter({}))).toBeNull();
  });
});

describe("resolveBaseUrl — current deployment origin wins", () => {
  it("PREVIEW host produces a PREVIEW mobile URL (ignores NEXT_PUBLIC_BASE_URL=production)", () => {
    const base = resolveBaseUrl({
      headerOrigin: `https://${PREVIEW_HOST}`,
      nodeEnv: "production",
      publicBaseUrl: `https://${PROD_HOST}`, // baked production env must NOT win
    });
    expect(base).toBe(`https://${PREVIEW_HOST}`);
    const url = mobileUrl(base);
    expect(url).toContain(PREVIEW_HOST);
    expect(url).not.toContain(PROD_HOST);
  });

  it("PRODUCTION host produces a PRODUCTION mobile URL", () => {
    const base = resolveBaseUrl({
      headerOrigin: `https://${PROD_HOST}`,
      nodeEnv: "production",
      publicBaseUrl: `https://${PROD_HOST}`,
    });
    expect(base).toBe(`https://${PROD_HOST}`);
    expect(mobileUrl(base)).toContain(PROD_HOST);
  });

  it("falls back to NEXT_PUBLIC_BASE_URL only when there is no request host", () => {
    const base = resolveBaseUrl({
      headerOrigin: null,
      nodeEnv: "production",
      publicBaseUrl: `https://${PROD_HOST}/`,
    });
    expect(base).toBe(`https://${PROD_HOST}`); // trailing slash trimmed
  });

  it("development: a localhost request host is swapped for the LAN IP", () => {
    const base = resolveBaseUrl({
      headerOrigin: "http://localhost:3000",
      nodeEnv: "development",
      publicBaseUrl: undefined,
      localIp: "192.168.1.50",
      port: "3000",
    });
    expect(base).toBe("http://192.168.1.50:3000");
  });

  it("development: a LAN-IP request host is kept as-is", () => {
    const base = resolveBaseUrl({
      headerOrigin: "http://192.168.1.50:3000",
      nodeEnv: "development",
      publicBaseUrl: undefined,
      localIp: "192.168.1.50",
    });
    expect(base).toBe("http://192.168.1.50:3000");
  });

  it("returns null when nothing usable is available", () => {
    expect(resolveBaseUrl({ headerOrigin: null, nodeEnv: "production", publicBaseUrl: "" })).toBeNull();
  });
});

describe("no hard-coded production domain in the QR/mobile URL path", () => {
  const files = [
    "lib/room-preview/request-origin.ts",
    "app/room-preview/screen/[sessionId]/page.tsx",
    "app/api/room-preview/sessions/[sessionId]/activate/route.ts",
  ];
  for (const rel of files) {
    it(`${rel} contains no hard-coded ${PROD_HOST}`, () => {
      const src = readFileSync(path.join(process.cwd(), rel), "utf8");
      expect(src).not.toContain(PROD_HOST);
    });
  }
});
