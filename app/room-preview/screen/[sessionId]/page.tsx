import { cookies } from "next/headers";
import os from "os";
import QRCode from "qrcode";
import ScreenSessionClient from "@/components/room-preview/ScreenSessionClient";
import SessionQRCode from "@/components/room-preview/SessionQRCode";
import { LOCALE_COOKIE_NAME, normalizeLocale } from "@/lib/i18n/config";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { ROOM_PREVIEW_ROUTES } from "@/lib/room-preview/constants";
import { SCREEN_TOKEN_COOKIE } from "@/lib/room-preview/cookies";
import { trackSessionEvent } from "@/lib/room-preview/session-diagnostics";
import GlassBackground from "@/components/GlassBackground";

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
  const locale = normalizeLocale(cookieStore.get(LOCALE_COOKIE_NAME)?.value);
  const token = cookieStore.get(SCREEN_TOKEN_COOKIE)?.value ?? null;
  const t = dictionaries[locale];

  let baseUrl = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "") ?? "";

  if (process.env.NODE_ENV === "development" && (!baseUrl || baseUrl.includes("localhost"))) {
    const localIp = getLocalNetworkIp();
    const port = process.env.PORT || "3000";
    baseUrl = `http://${localIp}:${port}`;
  }

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
    <main className="dark relative min-h-screen overflow-hidden bg-[var(--bg-page)] text-[var(--text-primary)]">
      <GlassBackground />
      <div className="mx-auto flex min-h-screen w-full max-w-[1400px] flex-col items-center justify-center gap-12 px-8 lg:flex-row lg:items-start lg:gap-20 lg:pt-32 pb-16">
        <div className="w-full max-w-md shrink-0 lg:sticky lg:top-32">
          {qrDataUrl ? (
            <SessionQRCode dataUrl={qrDataUrl} />
          ) : (
            <div className="w-full rounded-3xl border border-[#F1B434]/25 bg-[#F1B434]/06 backdrop-blur-xl px-8 py-8 text-center shadow-[0_20px_60px_rgba(0,0,0,0.5)]">
              <p className="font-bold text-[#F1B434]">{t.roomPreview.screen.baseUrlMissingTitle}</p>
              <p className="mt-2 text-sm leading-6 text-[#F1B434]/70">
                {t.roomPreview.screen.baseUrlMissingDescription}
              </p>
            </div>
          )}

          {process.env.NODE_ENV === "development" && (
            <div className="mt-4 space-y-2">
              <a
                href={`/api/room-preview/dev-entry?sessionId=${sessionId}&lang=${locale}`}
                className="flex w-full items-center justify-center gap-2.5 rounded-2xl border border-dashed border-yellow-400/35 bg-yellow-400/[0.05] px-4 py-3 text-sm font-semibold text-yellow-400/75 transition-colors hover:bg-yellow-400/10 hover:text-yellow-400 hover:border-yellow-400/50"
              >
                <span className="inline-block h-2 w-2 rounded-full bg-yellow-400 animate-pulse" />
                Dev — الدخول بدون QR
              </a>
              <p className="text-center font-mono text-[10px] text-yellow-400/40 break-all px-1">
                session: {sessionId}
              </p>
            </div>
          )}
        </div>

        <div className="w-full max-w-2xl lg:flex-1">
          <ScreenSessionClient sessionId={sessionId} />
        </div>
      </div>
    </main>
  );
}
