import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { House } from "lucide-react";
import MobileSessionClient from "@/components/room-preview/MobileSessionClient";
import { getRoomPreviewMockProducts } from "@/data/room-preview/mock-products";
import { sessionHasCompletedGate } from "@/lib/analytics/user-session-service";
import { getLogger } from "@/lib/logger";
import { trackSessionEvent } from "@/lib/room-preview/session-diagnostics";

const log = getLogger("mobile-page");

type MobileSessionPageProps = {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ devEntry?: string; lang?: string; t?: string }>;
};

export default async function MobileSessionPage({ params, searchParams }: MobileSessionPageProps) {
  const { sessionId } = await params;
  const { devEntry, lang, t } = await searchParams;
  const langQuery = lang === "ar" || lang === "en" ? `?lang=${lang}` : "";

  if (t) {
    const params = new URLSearchParams({ t });
    if (lang === "ar" || lang === "en") params.set("lang", lang);
    redirect(`/api/room-preview/sessions/${sessionId}/activate?${params}`);
  }

  const skipGateForDevEntry =
    process.env.NODE_ENV === "development" && devEntry === "1";

  const cookieStore = await cookies();
  const gateJustCompleted = cookieStore.get(`gate_ok_${sessionId}`)?.value === "1";

  const gateCompleted =
    skipGateForDevEntry ||
    gateJustCompleted ||
    (await sessionHasCompletedGate(sessionId));

  if (!gateCompleted) {
    redirect(`/room-preview/gate/${sessionId}${langQuery}`);
  }

  const products = getRoomPreviewMockProducts();

  if (process.env.NODE_ENV === "development") {
    const reqHeaders = await headers();
    log.info({
      sessionId,
      userAgent: reqHeaders.get("user-agent") ?? "unknown",
      ip: reqHeaders.get("x-forwarded-for") ?? reqHeaders.get("x-real-ip") ?? "unknown",
    }, "Mobile page SSR render");
  }

  void trackSessionEvent({
    sessionId,
    source: "mobile",
    eventType: "mobile_page_loaded",
    level: "info",
    metadata: { locale: lang ?? null },
  });

  return (
    <main className="relative min-h-screen overflow-hidden bg-[var(--bg-page)] text-[var(--text-primary)]">
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-4 py-10">
        <MobileSessionClient sessionId={sessionId} products={products} />
      </div>

      {/* Back to home — fixed bottom-left, below fullscreen overlays */}
      <a
        href="/"
        className="fixed bottom-6 left-4 z-[100] flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-surface)]/90 px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)] shadow-md backdrop-blur-md transition-all hover:bg-[var(--bg-surface-2)] hover:text-[var(--text-primary)] active:scale-95"
        dir="rtl"
      >
        <House size={15} strokeWidth={2} />
        <span>الرئيسية</span>
      </a>
    </main>
  );
}
