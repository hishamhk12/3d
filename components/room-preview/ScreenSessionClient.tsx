"use client";

import { useRef } from "react";
import { LoaderCircle } from "lucide-react";
import SessionStatePanel from "@/components/room-preview/SessionStatePanel";
import { BeforeAfterSlider } from "@/components/room-preview/BeforeAfterSlider";
import { RenderLoadingAnimation } from "@/features/room-preview/shared/RenderLoadingAnimation";
import { ROOM_PREVIEW_ROUTES, SCREEN_ERROR_RESET_MS } from "@/lib/room-preview/constants";
import { useScreenSession } from "@/features/room-preview/screen/useScreenSession";
import StatusPanel from "@/features/room-preview/screen/StatusPanel";

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Formats seconds as "4:59" for ≥60s or "12" for <60s. */
function formatCountdown(seconds: number): string {
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  return String(seconds);
}

// ─── ScreenSessionClient ──────────────────────────────────────────────────────

export default function ScreenSessionClient({ sessionId }: { sessionId: string }) {
  const {
    t,
    locale,
    session,
    viewState,
    error,
    pollError,
    resetCountdown,
    idleCountdown,
    errorCountdown,
    hasSelectedProduct,
    hasSelectedRoom,
    hasRenderResult,
    retry,
  } = useScreenSession({ sessionId });

  // Tracks whether we've witnessed a "rendering" status in this page load.
  // Used to decide whether to play the fade-out transition when result arrives.
  // A fresh page load with status already result_ready skips the animation.
  const hasSeenRenderingRef = useRef(false);

  // ── Non-ready states ──────────────────────────────────────────────────────

  if (viewState === "loading") {
    return (
      <div className="w-full rounded-3xl border border-white/10 bg-white/10 p-6 text-center shadow-[0_20px_60px_rgba(0,0,0,0.4)] backdrop-blur-xl animate-in fade-in duration-700 sm:p-8">
        <p className="text-sm tracking-widest text-white/60 uppercase">
          {t.roomPreview.screen.sessionStatus}
        </p>
        <p className="mt-4 text-3xl font-bold text-white tracking-tight">{t.roomPreview.screen.loadingTitle}</p>
        <div className="mt-6 flex items-center justify-center gap-3 text-base text-white/80">
          <LoaderCircle className="size-6 animate-spin text-cyan-400" />
          {t.roomPreview.screen.loadingDescription}
        </div>
      </div>
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
      <div className="w-full">
        <SessionStatePanel
          title={t.roomPreview.screen.notFoundTitle}
          description={error ?? t.roomPreview.screen.notFoundDescription}
          actions={[{ href: ROOM_PREVIEW_ROUTES.screenLauncher, label: t.roomPreview.shared.startNewSession }]}
        />
        {errorCountdownFooter}
      </div>
    );
  }

  if (viewState === "expired") {
    return (
      <div className="w-full">
        <SessionStatePanel
          title={t.roomPreview.screen.expiredTitle}
          description={error ?? t.roomPreview.screen.expiredDescription}
          actions={[{ href: ROOM_PREVIEW_ROUTES.screenLauncher, label: t.roomPreview.shared.startNewSession }]}
        />
        {errorCountdownFooter}
      </div>
    );
  }

  if (viewState === "failed") {
    return (
      <div className="w-full">
        <SessionStatePanel
          title={t.roomPreview.screen.failedTitle}
          description={error ?? t.roomPreview.screen.failedDescription}
          actions={[
            { label: t.common.actions.retry, onClick: retry },
            { href: ROOM_PREVIEW_ROUTES.screenLauncher, label: t.roomPreview.shared.startNewSession, variant: "secondary" },
          ]}
        />
        {errorCountdownFooter}
      </div>
    );
  }

  if (!session) {
    return (
      <div className="w-full">
        <SessionStatePanel
          title={t.roomPreview.screen.failedTitle}
          description={t.roomPreview.shared.noSessionData}
          actions={[
            { label: t.common.actions.retry, onClick: retry },
            { href: ROOM_PREVIEW_ROUTES.screenLauncher, label: t.roomPreview.shared.startNewSession, variant: "secondary" },
          ]}
        />
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

  // ── Ready: status panel ───────────────────────────────────────────────────

  return (
    <StatusPanel
      session={session}
      hasSelectedProduct={hasSelectedProduct}
      hasSelectedRoom={hasSelectedRoom}
      pollError={pollError}
      resetCountdown={resetCountdown}
      idleCountdown={idleCountdown}
    />
  );
}
