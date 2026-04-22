import { cookies } from "next/headers";
import os from "os";
import QRCode from "qrcode";
import ScreenSessionClient from "@/components/room-preview/ScreenSessionClient";
import SessionQRCode from "@/components/room-preview/SessionQRCode";
import { LOCALE_COOKIE_NAME, normalizeLocale } from "@/lib/i18n/config";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { ROOM_PREVIEW_ROUTES } from "@/lib/room-preview/constants";
import { SCREEN_TOKEN_COOKIE } from "@/lib/room-preview/cookies";
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
    ? `/api/room-preview/sessions/${sessionId}/activate?t=${encodeURIComponent(token)}`
    : ROOM_PREVIEW_ROUTES.mobileSession(sessionId);
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
    } catch (err) {
      console.error("[qrcode] Server-side generation failed:", err);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden text-[#1d1d1f]">
      <GlassBackground />
      <div className="mx-auto flex min-h-screen w-full max-w-[1200px] flex-col items-center justify-center gap-10 px-6 lg:flex-row lg:items-start lg:pt-24 pb-12">
        <div className="w-full max-w-sm shrink-0 lg:sticky lg:top-24">
          {qrDataUrl ? (
            <SessionQRCode dataUrl={qrDataUrl} alt={t.roomPreview.qr.alt} />
          ) : (
            <div className="w-full rounded-[28px] border border-amber-300/40 bg-amber-400/20 backdrop-blur-md px-6 py-6 text-center shadow-lg">
              <p className="font-bold text-[#7a3a00]">Missing NEXT_PUBLIC_BASE_URL</p>
              <p className="mt-2 text-sm leading-6 text-[#7a3a00]/80">
                Set NEXT_PUBLIC_BASE_URL in .env.local so the QR code can be generated.
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
