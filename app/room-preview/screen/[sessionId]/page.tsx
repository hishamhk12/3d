import { cookies, headers } from "next/headers";
import os from "os";
import QRCode from "qrcode";
import ScreenSessionClient from "@/components/room-preview/ScreenSessionClient";
import { LOCALE_COOKIE_NAME, normalizeLocale } from "@/lib/i18n/config";
import { ROOM_PREVIEW_ROUTES } from "@/lib/room-preview/constants";
import { SCREEN_TOKEN_COOKIE } from "@/lib/room-preview/cookies";
import { originFromHeaders, resolveBaseUrl } from "@/lib/room-preview/request-origin";
import { trackSessionEvent } from "@/lib/room-preview/session-diagnostics";

function getLocalNetworkIp() {
  if (typeof os.networkInterfaces !== "function") return "localhost";
  const interfaces = os.networkInterfaces();
  // Prefer private LAN ranges (192.168.x.x, 10.x.x.x, 172.16–31.x.x).
  // Skip 0.0.0.0, 169.254.x.x (APIPA), and virtual adapter addresses.
  const candidates: string[] = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      const addr = iface.address;
      if (iface.family !== "IPv4" || iface.internal) continue;
      if (addr === "0.0.0.0" || addr.startsWith("169.254.")) continue;
      if (
        addr.startsWith("192.168.") ||
        addr.startsWith("10.") ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(addr)
      ) {
        candidates.unshift(addr); // prefer private ranges
      } else {
        candidates.push(addr);
      }
    }
  }
  return candidates[0] ?? "localhost";
}

type ScreenSessionPageProps = {
  params: Promise<{
    sessionId: string;
  }>;
};

export default async function ScreenSessionPage({ params }: ScreenSessionPageProps) {
  const { sessionId } = await params;
  const cookieStore = await cookies();
  const headerStore = await headers();
  const locale = normalizeLocale(cookieStore.get(LOCALE_COOKIE_NAME)?.value);
  const token = cookieStore.get(SCREEN_TOKEN_COOKIE)?.value ?? null;

  // The QR must target the CURRENT deployment origin so a Preview deployment's
  // QR opens that same Preview (not the baked-in Production domain). Use the
  // incoming request host first; NEXT_PUBLIC_BASE_URL is only a fallback, and in
  // dev a localhost host is swapped for the LAN IP so phones can reach it.
  const baseUrl =
    resolveBaseUrl({
      headerOrigin: originFromHeaders((name) => headerStore.get(name)),
      nodeEnv: process.env.NODE_ENV,
      publicBaseUrl: process.env.NEXT_PUBLIC_BASE_URL,
      localIp: process.env.NODE_ENV === "development" ? getLocalNetworkIp() : undefined,
      port: process.env.PORT || "3000",
    }) ?? "";

  // The QR code points directly to the activate API route with the token as a
  // query param. The server verifies it, sets the HttpOnly cookie, and
  // redirects the mobile browser to the mobile page — no client JS needed.
  // Using ?t= (not #t=) ensures QR scanner apps that strip URL fragments
  // still deliver a working link.
  const activatePath = token
    ? `/api/room-preview/sessions/${sessionId}/activate?t=${encodeURIComponent(token)}&lang=${locale}`
    : `${ROOM_PREVIEW_ROUTES.mobileSession(sessionId)}?lang=${locale}`;
  const mobileUrl = baseUrl ? `${baseUrl}${activatePath}` : null;

  let qrDataUrl: string | null = null;
  if (mobileUrl) {
    try {
      qrDataUrl = await QRCode.toDataURL(mobileUrl, {
        errorCorrectionLevel: "H",
        margin: 1,
        width: 400,
        color: { dark: "#000000", light: "#ffffff" },
      });
      await trackSessionEvent({
        sessionId,
        source: "screen",
        eventType: "qr_displayed",
        level: "info",
        metadata: { locale, hasToken: Boolean(token) },
      });
    } catch (err) {
      console.error("[qrcode] Server-side generation failed:", err);
    }
  }

  return (
    // Static server-rendered background: the session stage's croissant image
    // paints from the first byte of HTML (no hydration wait), with the neutral
    // dark .screen-kiosk-page color as the only interim fallback — never blue.
    <main
      className="screen-kiosk-page dark relative overflow-hidden text-[var(--text-primary)]"
      style={{ background: '#14110d url("/croissant.jpg") center / cover no-repeat' }}
    >
      <ScreenSessionClient sessionId={sessionId} qrDataUrl={qrDataUrl} />
    </main>
  );
}
