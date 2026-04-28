"use client";

import Image from "next/image";
import { LoaderCircle } from "lucide-react";
import SessionStatePanel from "@/components/room-preview/SessionStatePanel";
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

  // ── Non-ready states ──────────────────────────────────────────────────────

  if (viewState === "loading") {
    return (
      <div className="mt-6 w-full rounded-3xl border border-white/10 bg-white/10 backdrop-blur-xl p-8 text-center shadow-[0_20px_60px_rgba(0,0,0,0.4)] animate-in fade-in duration-700">
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
      <div className="mt-6">
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
      <div className="mt-6">
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
      <div className="mt-6">
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
      <div className="mt-6">
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

  // ── Ready: full-screen result overlay ─────────────────────────────────────

  if (hasRenderResult) {
    return (
      <div className="fixed inset-0 z-50 overflow-hidden bg-black animate-in fade-in duration-700">
        <div className="absolute inset-0 z-0 bg-gradient-to-br from-[#1d1d1f] to-black" />
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <Image
            src={session.renderResult!.imageUrl!}
            alt={t.roomPreview.shared.renderedPreview}
            fill
            sizes="100vw"
            className="object-contain"
            priority
          />
        </div>
      </div>
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
      onRetry={retry}
    />
  );
}
