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
      <div className="mt-6 rounded-[24px] border border-[rgba(255,255,255,0.6)] bg-white/40 backdrop-blur-md px-5 py-4 text-center">
        <p className="text-xs font-semibold tracking-[0.18em] text-[#003C71] uppercase" style={{ textShadow: "0 1px 1px rgba(255,255,255,0.7)" }}>
          {t.roomPreview.screen.sessionStatus}
        </p>
        <p className="mt-3 text-lg font-semibold text-[#1d1d1f]">{t.roomPreview.screen.loadingTitle}</p>
        <div className="mt-4 flex items-center justify-center gap-3 text-sm text-[#4a4a52]">
          <LoaderCircle className="size-4 animate-spin" style={{ color: "#003C71" }} />
          {t.roomPreview.screen.loadingDescription}
        </div>
      </div>
    );
  }

  // Shared countdown footer used by all three error view states.
  const errorCountdownFooter = errorCountdown !== null ? (
    <div className="mt-4 px-1">
      <p className="text-center text-xs text-[#4a4a52]">
        {locale === "ar"
          ? `العودة للبداية خلال ${formatCountdown(errorCountdown)} ثانية`
          : `Returning to start in ${formatCountdown(errorCountdown)}s`}
      </p>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-black/10">
        <div
          className="h-full rounded-full bg-[#003C71]/50 transition-all duration-1000 ease-linear"
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
