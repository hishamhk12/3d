import { redirect } from "next/navigation";
import { headers } from "next/headers";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import MobileSessionClient from "@/components/room-preview/MobileSessionClient";
import SplashScreen from "@/components/SplashScreen";
import { getRoomPreviewMockProducts } from "@/data/room-preview/mock-products";
import { sessionHasCompletedGate } from "@/lib/analytics/user-session-service";
import { getLogger } from "@/lib/logger";

const log = getLogger("mobile-page");

type MobileSessionPageProps = {
  params: Promise<{
    sessionId: string;
  }>;
};

export default async function MobileSessionPage({ params }: MobileSessionPageProps) {
  const { sessionId } = await params;

  // ── Gate check ──────────────────────────────────────────────────────────────
  // Users must identify themselves before accessing the experience.
  // Redirect to the gate if they haven't done so yet.
  const gateCompleted = await sessionHasCompletedGate(sessionId);
  if (!gateCompleted) {
    redirect(`/room-preview/gate/${sessionId}`);
  }

  const products = getRoomPreviewMockProducts();

  // Log every SSR render so you can confirm in the terminal whether
  // the phone's request is actually reaching the server.
  if (process.env.NODE_ENV === "development") {
    const reqHeaders = await headers();
    log.info({
      sessionId,
      userAgent: reqHeaders.get("user-agent") ?? "unknown",
      ip: reqHeaders.get("x-forwarded-for") ?? reqHeaders.get("x-real-ip") ?? "unknown",
    }, "Mobile page SSR render");
  }

  return (
    <SplashScreen>
      <main className="relative min-h-screen overflow-hidden bg-[#e8f3fc] text-[#0a1f3d]">
        <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-4 py-10">
          <div className="mb-6 flex w-full justify-center lg:justify-end">
            <LanguageSwitcher />
          </div>

          <MobileSessionClient
            sessionId={sessionId}
            products={products}
          />
        </div>
      </main>
    </SplashScreen>
  );
}
