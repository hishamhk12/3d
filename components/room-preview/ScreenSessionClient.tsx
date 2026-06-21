"use client";

import { useRef } from "react";
import AnimatedScanLoader from "@/components/ui/animated-scan-loader";
import BrandedGlassStage from "@/components/room-preview/BrandedGlassStage";
import SessionStatePanel from "@/components/room-preview/SessionStatePanel";
import { BeforeAfterSlider } from "@/components/room-preview/BeforeAfterSlider";
import { RenderLoadingAnimation } from "@/features/room-preview/shared/RenderLoadingAnimation";
import { SCREEN_ERROR_RESET_MS } from "@/lib/room-preview/constants";
import { useScreenSession } from "@/features/room-preview/screen/useScreenSession";
import SessionStage from "@/features/room-preview/screen/SessionStage";
import type { TranslationDictionary } from "@/lib/i18n/dictionaries";
import type { RoomPreviewSessionStatus } from "@/lib/room-preview/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Formats seconds as "4:59" for ≥60s or "12" for <60s. */
function formatCountdown(seconds: number): string {
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  return String(seconds);
}

/** Concise session-status label shown inside the session bar. */
function getScreenStatusMessage(status: RoomPreviewSessionStatus, t: TranslationDictionary) {
  if (status === "result_ready")     return t.roomPreview.screen.statuses.ready;
  if (status === "rendering")        return t.roomPreview.screen.statuses.rendering;
  if (status === "ready_to_render")  return t.roomPreview.screen.statuses.preparing;
  if (status === "product_selected") return t.roomPreview.screen.statuses.waitingRender;
  if (status === "failed")           return t.roomPreview.screen.statuses.failed;
  if (status === "room_selected")    return t.roomPreview.screen.statuses.waitingItem;
  if (status === "mobile_connected") return t.roomPreview.screen.statuses.waitingRoom;
  return t.roomPreview.screen.statuses.waitingPhone;
}

/** Centers the small non-stage view states (loading / errors) within the kiosk page. */
function CenteredShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative z-[1] flex min-h-[100svh] w-full items-center justify-center px-6 py-10">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}

// ─── ScreenSessionClient ──────────────────────────────────────────────────────

export default function ScreenSessionClient({
  sessionId,
  qrDataUrl = null,
}: {
  sessionId: string;
  qrDataUrl?: string | null;
}) {
  const {
    t,
    locale,
    session,
    viewState,
    error,
    errorCountdown,
    completionCountdown,
    hasRenderResult,
  } = useScreenSession({ sessionId });

  const devEntryHref =
    process.env.NODE_ENV === "development"
      ? `/api/room-preview/dev-entry?sessionId=${sessionId}&lang=${locale}`
      : null;

  // Tracks whether we've witnessed a "rendering" status in this page load.
  // Used to decide whether to play the fade-out transition when result arrives.
  // A fresh page load with status already result_ready skips the animation.
  const hasSeenRenderingRef = useRef(false);

  // ── Non-ready states ──────────────────────────────────────────────────────

  if (viewState === "loading") {
    // Keep the branded logo scan loader visible — continuous with the launcher's
    // BrandedQrLoadingScreen — until the real session payload is ready. This
    // replaces the previous intermediate "جار تحميل الجلسة..." card so the flow
    // reads as one uninterrupted branded loading screen. (Renders inside the
    // page's existing screen-kiosk-page <main>, so no nested <main>.)
    return (
      <BrandedGlassStage backgroundImage='url("/room-preview/private.jpg")'>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <AnimatedScanLoader />
        </div>
      </BrandedGlassStage>
    );
  }

  // Shared countdown footer used by all three error view states.
  const errorCountdownFooter = errorCountdown !== null ? (
    <div className="mt-6 px-1">
      <p className="text-center text-sm text-white/60">
        {locale === "ar"
          ? `العودة للبداية خلال ${formatCountdown(errorCountdown)} ثانية`
          : `Returning to start in ${formatCountdown(errorCountdown)}s`}
      </p>
      <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-teal-400 transition-all duration-1000 ease-linear animate-pulse"
          style={{ width: `${Math.max(0, (errorCountdown / Math.round(SCREEN_ERROR_RESET_MS / 1000)) * 100)}%` }}
        />
      </div>
    </div>
  ) : null;

  if (viewState === "not_found") {
    return (
      <CenteredShell>
        <SessionStatePanel
          title={t.roomPreview.screen.notFoundTitle}
          description={error ?? t.roomPreview.screen.notFoundDescription}
        />
        {errorCountdownFooter}
      </CenteredShell>
    );
  }

  if (viewState === "expired") {
    return (
      <CenteredShell>
        <SessionStatePanel
          title={t.roomPreview.screen.expiredTitle}
          description={error ?? t.roomPreview.screen.expiredDescription}
        />
        {errorCountdownFooter}
      </CenteredShell>
    );
  }

  if (viewState === "failed") {
    return (
      <CenteredShell>
        <SessionStatePanel
          title={t.roomPreview.screen.failedTitle}
          description={error ?? t.roomPreview.screen.failedDescription}
        />
        {errorCountdownFooter}
      </CenteredShell>
    );
  }

  if (!session) {
    return (
      <CenteredShell>
        <SessionStatePanel
          title={t.roomPreview.screen.failedTitle}
          description={t.roomPreview.shared.noSessionData}
        />
      </CenteredShell>
    );
  }

  // ── Completion message: full-screen thank-you state after result display ────
  if (viewState === "completion_message") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-br from-stone-900 via-[#1a1714] to-stone-950 animate-in fade-in duration-700">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_40%,rgba(251,243,233,0.04),transparent)]" />
        <div className="relative w-full max-w-xl rounded-3xl border border-stone-700/30 bg-stone-900/70 px-12 py-14 text-center shadow-[0_40px_80px_rgba(0,0,0,0.6)] backdrop-blur-2xl mx-6">
          <div className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-full border border-emerald-700/30 bg-emerald-900/40">
            <svg className="h-10 w-10 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-stone-100" dir="rtl">
            تم إنشاء التصميم بنجاح
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-stone-400" dir="rtl">
            شكراً لتجربتك. يمكنك مراجعة النتيجة مع فريقنا أو بدء تجربة جديدة من الصفحة الرئيسية.
          </p>
          {completionCountdown !== null && (
            <div className="mt-10 flex flex-col items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-full border border-stone-600/50 bg-stone-800/60 text-2xl font-bold tabular-nums text-stone-300">
                {completionCountdown}
              </div>
              <p className="text-sm text-stone-500" dir="rtl">
                سيتم الرجوع إلى الصفحة الرئيسية خلال {completionCountdown} ثوانٍ
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Track rendering state for the fade-out transition (ref mutation, not a hook)
  if (session.status === "rendering" || session.status === "ready_to_render") {
    hasSeenRenderingRef.current = true;
  }

  // ── Rendering: full-screen loading animation ──────────────────────────────

  if (session.status === "rendering" || session.status === "ready_to_render") {
    return (
      <RenderLoadingAnimation
        variant="screen"
        session={session}
        showResult={false}
      />
    );
  }

  // ── Ready: full-screen result overlay ─────────────────────────────────────

  if (hasRenderResult) {
    return (
      <>
        {/* key forces a full remount when a new render result arrives */}
        <div key={session.renderResult!.imageUrl!} className="fixed inset-0 z-50 overflow-hidden bg-black animate-in fade-in duration-700">
          <div className="absolute inset-0 z-0 bg-gradient-to-br from-[#1d1d1f] to-black" />
          <div className="absolute inset-0 z-10 flex items-center justify-center">
            <BeforeAfterSlider
              beforeImageUrl={session.selectedRoom?.imageUrl}
              afterImageUrl={session.renderResult!.imageUrl!}
              beforeLabel={locale === "ar" ? "قبل" : "Before"}
              afterLabel={locale === "ar" ? "بعد" : "After"}
              alt={t.roomPreview.shared.renderedPreview}
              className="h-full w-full"
              sizes="100vw"
              fit="contain"
              priority
              unoptimized
            />
          </div>
        </div>
        {/* Animation overlay (z-9999) fades out on top of the slider (z-50),
            revealing it smoothly. Only shown if we witnessed the rendering
            status during this page load — avoids a flash on fresh loads. */}
        {hasSeenRenderingRef.current && (
          <RenderLoadingAnimation
            variant="screen"
            session={session}
            showResult={true}
          />
        )}
      </>
    );
  }

  // ── Ready: visionOS session stage (Figma node 10:936 composition) ─────────

  return (
    <SessionStage
      session={session}
      qrDataUrl={qrDataUrl}
      statusLabel={getScreenStatusMessage(session.status, t)}
      devEntryHref={devEntryHref}
    />
  );
}
