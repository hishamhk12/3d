import { cookies, headers } from "next/headers";
import Link from "next/link";
import os from "os";
import { House } from "lucide-react";
import QRCode from "qrcode";
import ScreenSessionClient from "@/components/room-preview/ScreenSessionClient";
import ScreenViewportDebugOverlay from "@/components/room-preview/ScreenViewportDebugOverlay";
import SessionQRCode from "@/components/room-preview/SessionQRCode";
import { LOCALE_COOKIE_NAME, normalizeLocale } from "@/lib/i18n/config";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { ROOM_PREVIEW_ROUTES } from "@/lib/room-preview/constants";
import { SCREEN_TOKEN_COOKIE } from "@/lib/room-preview/cookies";
import { originFromHeaders, resolveBaseUrl } from "@/lib/room-preview/request-origin";
import { trackSessionEvent } from "@/lib/room-preview/session-diagnostics";
import GlassBackground from "@/components/GlassBackground";

function getLocalNetworkIp() {
  if (typeof os.networkInterfaces !== "function") return "localhost";
  const interfaces = os.networkInterfaces();
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
        candidates.unshift(addr);
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
  const t = dictionaries[locale];

  const baseUrl =
    resolveBaseUrl({
      headerOrigin: originFromHeaders((name) => headerStore.get(name)),
      nodeEnv: process.env.NODE_ENV,
      publicBaseUrl: process.env.NEXT_PUBLIC_BASE_URL,
      localIp: process.env.NODE_ENV === "development" ? getLocalNetworkIp() : undefined,
      port: process.env.PORT || "3000",
    }) ?? "";

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
    <main className="screen-kiosk-page dark relative bg-[var(--bg-page)] text-[var(--text-primary)]">
      <div className="screen-kiosk-orientation-frame">
        <GlassBackground />
        <div className="screen-kiosk-shell">
          <div className="screen-kiosk-qr">
            {qrDataUrl ? (
              <SessionQRCode dataUrl={qrDataUrl} />
            ) : (
              <div className="w-full rounded-3xl border border-[#F1B434]/25 bg-[#F1B434]/06 px-8 py-8 text-center shadow-[0_20px_60px_rgba(0,0,0,0.5)] backdrop-blur-xl">
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
                  className="flex w-full items-center justify-center gap-2.5 rounded-2xl border border-dashed border-yellow-400/35 bg-yellow-400/[0.05] px-4 py-3 text-sm font-semibold text-yellow-400/75 transition-colors hover:border-yellow-400/50 hover:bg-yellow-400/10 hover:text-yellow-400"
                >
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-yellow-400" />
                  Dev - الدخول بدون QR
                </a>
                <p className="break-all px-1 text-center font-mono text-[10px] text-yellow-400/40">
                  session: {sessionId}
                </p>
              </div>
            )}
          </div>

          <div className="screen-kiosk-content">
            <ScreenSessionClient sessionId={sessionId} />
          </div>
        </div>

        <Link
          href="/"
          className="screen-kiosk-home-link fixed bottom-6 left-4 z-[100] flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-surface)]/90 px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)] shadow-md backdrop-blur-md transition-all hover:bg-[var(--bg-surface-2)] hover:text-[var(--text-primary)] active:scale-95"
          dir="rtl"
        >
          <House size={15} strokeWidth={2} />
          <span>الرئيسية</span>
        </Link>
      </div>
      <ScreenViewportDebugOverlay />
    </main>
  );
}
