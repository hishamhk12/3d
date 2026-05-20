"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { LoaderCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import {
  SCREEN_RESULT_RESET_MS,
  SCREEN_FAILED_RESET_MS,
  SCREEN_IDLE_RESET_MS,
} from "@/lib/room-preview/constants";
import { getProductTypeLabel } from "@/features/room-preview/shared/helpers";
import type { TranslationDictionary } from "@/lib/i18n/dictionaries";
import type { RoomPreviewSession, RoomPreviewSessionStatus } from "@/lib/room-preview/types";

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Formats seconds as "4:59" for ≥60s or "12" for <60s. */
function formatCountdown(seconds: number): string {
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  return String(seconds);
}

/**
 * Shrinking progress bar that visualises time remaining before an auto-reset.
 * The bar starts full and drains to empty as `remaining` approaches 0.
 */
function ResetProgressBar({
  remaining,
  total,
}: {
  remaining: number;
  total: number;
}) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (remaining / total) * 100)) : 0;
  return (
    <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10">
      <div
        className={`h-full rounded-full transition-all duration-1000 ease-linear animate-pulse bg-gradient-to-r from-cyan-400 to-teal-400`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function getScreenStatusMessage(status: RoomPreviewSessionStatus, t: TranslationDictionary) {
  if (status === "result_ready")                                   return t.roomPreview.screen.statuses.ready;
  if (status === "rendering")                                      return t.roomPreview.screen.statuses.rendering;
  if (status === "ready_to_render")                                  return t.roomPreview.screen.statuses.preparing;
  if (status === "product_selected")                                 return t.roomPreview.screen.statuses.waitingRender;
  if (status === "failed")                                         return t.roomPreview.screen.statuses.failed;
  if (status === "room_selected")                                  return t.roomPreview.screen.statuses.waitingItem;
  if (status === "mobile_connected")                               return t.roomPreview.screen.statuses.waitingRoom;
  return t.roomPreview.screen.statuses.waitingPhone;
}

function getSessionHelperMessage(
  session: RoomPreviewSession,
  hasSelectedProduct: boolean,
  hasSelectedRoom: boolean,
  t: TranslationDictionary,
) {
  if (!session.mobileConnected) return null;
  if (session.status === "result_ready") return t.roomPreview.screen.helper.renderComplete;
  if (session.status === "rendering")    return t.roomPreview.screen.helper.renderRunning;
  if (session.status === "ready_to_render" || session.status === "product_selected") return t.roomPreview.screen.helper.queued;
  if (hasSelectedProduct) return t.roomPreview.screen.helper.productSubmitted;
  if (hasSelectedRoom)    return `${t.roomPreview.screen.helper.roomSelected} ✅`;
  return `${t.roomPreview.screen.helper.phoneConnected} ✅`;
}

// ─── Props ────────────────────────────────────────────────────────────────────

function getRenderingStageMessage(seconds: number, t: TranslationDictionary) {
  if (seconds >= 45) return t.roomPreview.screen.renderingStages.finishing;
  if (seconds >= 25) return t.roomPreview.screen.renderingStages.qualityRetry;
  if (seconds >= 10) return t.roomPreview.screen.renderingStages.qualityCheck;
  return t.roomPreview.screen.renderingStages.started;
}

interface StatusPanelProps {
  session: RoomPreviewSession;
  hasSelectedProduct: boolean;
  hasSelectedRoom: boolean;
  pollError: string | null;
  resetCountdown: number | null;
  idleCountdown: number | null;
  onRetry: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function StatusPanel({
  session,
  hasSelectedProduct,
  hasSelectedRoom,
  pollError,
  resetCountdown,
  idleCountdown,
  onRetry,
}: StatusPanelProps) {
  const { dir, formatMessage, locale, t } = useI18n();
  const sectionAlignClass = dir === "rtl" ? "text-right" : "text-left";
  const [nowMs, setNowMs] = useState(() => Date.now());

  const selectedProduct  = session.selectedProduct;
  const renderResult     = session.renderResult;
  const hasRenderResult  = Boolean(renderResult?.imageUrl && session.status === "result_ready");
  const statusMessage    = getScreenStatusMessage(session.status, t);
  const helperMessage    = getSessionHelperMessage(session, hasSelectedProduct, hasSelectedRoom, t);
  const renderingStartedAtMs = Date.parse(session.updatedAt);
  const renderingSeconds =
    session.status === "rendering" && Number.isFinite(renderingStartedAtMs)
      ? Math.max(0, Math.floor((nowMs - renderingStartedAtMs) / 1000))
      : 0;
  const renderingStageMessage = getRenderingStageMessage(renderingSeconds, t);

  useEffect(() => {
    if (session.status !== "rendering") {
      return;
    }

    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(interval);
  }, [session.status]);

  const localizedProductType = getProductTypeLabel(selectedProduct?.productType ?? null, locale);
  const localizedCompletedAt = renderResult?.generatedAt
    ? formatMessage(t.roomPreview.screen.completedAt, {
        datetime: new Date(renderResult.generatedAt).toLocaleString(locale),
      })
    : null;

  const statusColors: Record<string, string> = {
    waiting_mobile: "border-blue-400/25",
    mobile_connected: "border-cyan-400/30",
    room_selected: "border-cyan-400/30",
    product_selected: "border-cyan-400/30",
    ready_to_render: "border-cyan-400/30",
    rendering: "border-cyan-300/35",
    result_ready: "border-emerald-400/30",
    failed: "border-rose-400/35",
    expired: "border-gray-400/25",
  };
  const statusBorderClass = statusColors[session.status] || statusColors.waiting_mobile;

  return (
    <div className={`mt-0 w-full max-w-[44rem] overflow-hidden rounded-[2rem] border border-cyan-200/15 bg-[#071729]/90 p-5 text-white shadow-[0_30px_80px_rgba(0,0,0,0.50),0_0_42px_rgba(0,175,215,0.10)] backdrop-blur-xl animate-in fade-in duration-700 sm:p-6 md:p-7 ${sectionAlignClass} ${statusBorderClass}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-100/50">
        {t.roomPreview.screen.sessionStatus}
      </p>
      <p className="mt-2 text-2xl font-bold tracking-tight text-white md:text-3xl">{statusMessage}</p>

      {helperMessage ? (
        <p className="mt-1 text-sm leading-6 text-white/58">{helperMessage}</p>
      ) : null}

      {session.status === "rendering" ? (
        <div className="mt-6 rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-5 py-4 text-base text-cyan-100">
          <div className="flex items-center gap-3">
            <LoaderCircle className="size-5 animate-spin text-cyan-300" />
            <span className="animate-pulse">{t.roomPreview.screen.renderingNow}</span>
          </div>
          <p className="mt-3 text-sm leading-6 text-white/68">{renderingStageMessage}</p>
          <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div className="rendering-wait-bar h-full w-1/3 rounded-full bg-gradient-to-r from-transparent via-cyan-200 to-transparent" />
          </div>
        </div>
      ) : null}

      {session.status === "failed" ? (
        <div className="mt-6 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-5 py-4 text-base text-rose-200">
          <p>{t.roomPreview.screen.pipelineFailed}</p>
          {resetCountdown !== null ? (
            <>
              <p className="mt-3 text-sm text-rose-200/70">
                {locale === "ar"
                  ? `العودة للبداية خلال ${formatCountdown(resetCountdown)} ثانية`
                  : `Returning to start in ${formatCountdown(resetCountdown)}s`}
              </p>
              <ResetProgressBar
                remaining={resetCountdown}
                total={Math.round(SCREEN_FAILED_RESET_MS / 1000)}
              />
            </>
          ) : null}
        </div>
      ) : null}

      {idleCountdown !== null && !session.mobileConnected ? (
        <div className="mt-5">
          <p className="text-sm text-[var(--text-muted)] text-center">
            {locale === "ar"
              ? `إعادة التشغيل تلقائياً خلال ${formatCountdown(idleCountdown)}`
              : `Auto-reset in ${formatCountdown(idleCountdown)}`}
          </p>
          <ResetProgressBar
            remaining={idleCountdown}
            total={Math.round(SCREEN_IDLE_RESET_MS / 1000)}
          />
        </div>
      ) : null}

      <section className="mt-6">
        <div
          className="flex items-center gap-4 border-b border-white/10 pb-5"
          dir={dir}
        >
          <div className="relative size-16 shrink-0 overflow-hidden rounded-2xl border border-white/15 bg-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.10)] sm:size-20">
            {selectedProduct?.imageUrl ? (
              <Image
                src={selectedProduct.imageUrl}
                alt={selectedProduct.name ?? t.roomPreview.shared.selectedProductThumbnail}
                fill
                sizes="80px"
                className="object-cover"
              />
            ) : (
              <div className="h-full w-full bg-[linear-gradient(135deg,rgba(0,175,215,0.18),rgba(255,255,255,0.06))]" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-100/45">
              {t.roomPreview.shared.selectedItem}
            </p>
            <h2 className="mt-1 line-clamp-2 break-words text-xl font-bold leading-tight text-white sm:text-2xl">
              {selectedProduct?.name ?? t.roomPreview.screen.statuses.waitingItem}
            </h2>
            <p className="mt-1 truncate text-sm text-cyan-100/62">
              {localizedProductType ?? t.roomPreview.mobile.product.selectedHint}
            </p>
          </div>
        </div>

        <div className="relative mt-5 aspect-[4/3] min-h-[18rem] w-full overflow-hidden rounded-[1.5rem] border border-white/12 bg-[#0d2339] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] sm:min-h-[22rem] lg:min-h-[24rem]">
          {session.selectedRoom?.imageUrl ? (
            <Image
              src={session.selectedRoom.imageUrl}
              alt={t.roomPreview.shared.selectedRoomThumbnail}
              fill
              sizes="(max-width: 1024px) 90vw, 44rem"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,rgba(0,175,215,0.18),rgba(7,23,41,0.92)_55%)] px-8 text-center">
              <p className="text-base font-medium text-white/55">
                {t.roomPreview.screen.statuses.waitingRoom}
              </p>
            </div>
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#071729]/70 to-transparent" />
        </div>

        {hasRenderResult ? (
          <div className="mt-6 w-full rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-8 shadow-lg">
            <p className="text-lg font-bold text-[var(--text-primary)]">{t.roomPreview.shared.renderedPreview}</p>
            {localizedCompletedAt ? (
              <p className="mt-2 text-base text-emerald-300/80">{localizedCompletedAt}</p>
            ) : null}
            <div className="relative mt-6 aspect-[16/9] w-full overflow-hidden rounded-xl border border-emerald-500/25 shadow-inner">
              <Image
                src={renderResult?.imageUrl ?? ""}
                alt={t.roomPreview.shared.renderedPreview}
                fill
                sizes="(max-width: 640px) 100vw, 100vw"
                className="object-cover"
              />
            </div>
            {resetCountdown !== null ? (
              <div className="mt-8 mx-auto max-w-sm">
                <p className="text-base text-emerald-300 text-center mb-3">
                  {locale === "ar"
                    ? `جلسة جديدة خلال ${formatCountdown(resetCountdown)} ثانية`
                    : `New session starting in ${formatCountdown(resetCountdown)}s`}
                </p>
                <ResetProgressBar
                  remaining={resetCountdown}
                  total={Math.round(SCREEN_RESULT_RESET_MS / 1000)}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {pollError ? (
        <div className="mt-6 rounded-2xl border border-orange-500/30 bg-orange-500/10 px-5 py-4 text-base text-orange-200">
          <p className="font-semibold">{t.roomPreview.screen.pollFailedTitle}</p>
          <p className="mt-2 text-orange-200/80">{pollError}</p>
          <button
            type="button"
            onClick={onRetry}
            className="btn-secondary mt-4 inline-flex px-6 py-2.5 text-sm"
          >
            {t.common.actions.retry}
          </button>
        </div>
      ) : null}
    </div>
  );
}
