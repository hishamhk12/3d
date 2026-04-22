"use client";

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
  colorClass = "bg-[#003C71]",
}: {
  remaining: number;
  total: number;
  colorClass?: string;
}) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (remaining / total) * 100)) : 0;
  return (
    <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-black/10">
      <div
        className={`h-full rounded-full transition-all duration-1000 ease-linear ${colorClass}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function getScreenStatusMessage(status: RoomPreviewSessionStatus, t: TranslationDictionary) {
  if (status === "result_ready")                                   return t.roomPreview.screen.statuses.ready;
  if (status === "rendering")                                      return t.roomPreview.screen.statuses.rendering;
  if (status === "ready_to_render" || status === "product_selected") return t.roomPreview.screen.statuses.preparing;
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

  const selectedProduct  = session.selectedProduct;
  const renderResult     = session.renderResult;
  const hasRenderResult  = Boolean(renderResult?.imageUrl && session.status === "result_ready");
  const statusMessage    = getScreenStatusMessage(session.status, t);
  const helperMessage    = getSessionHelperMessage(session, hasSelectedProduct, hasSelectedRoom, t);

  const localizedProductType = getProductTypeLabel(selectedProduct?.productType ?? null, locale);
  const localizedBarcode = selectedProduct?.barcode
    ? formatMessage(t.roomPreview.mobile.product.barcode, { barcode: selectedProduct.barcode })
    : null;
  const localizedCompletedAt = renderResult?.generatedAt
    ? formatMessage(t.roomPreview.screen.completedAt, {
        datetime: new Date(renderResult.generatedAt).toLocaleString(locale),
      })
    : null;

  return (
    <div className={`mt-0 w-full rounded-[32px] border border-[rgba(255,255,255,0.8)] bg-white/75 backdrop-blur-md px-6 py-8 md:px-8 ${sectionAlignClass} shadow-xl`}>
      <p className="text-sm font-semibold tracking-[0.18em] text-[#003C71] uppercase" style={{ textShadow: "0 1px 1px rgba(255,255,255,0.7)" }}>
        {t.roomPreview.screen.sessionStatus}
      </p>
      <p className="mt-4 text-2xl font-semibold text-[#1d1d1f] tracking-tight">{statusMessage}</p>

      {helperMessage ? (
        <p className="mt-2 text-sm text-[#003C71]">{helperMessage}</p>
      ) : null}

      {session.status === "rendering" ? (
        <div className="mt-5 rounded-[24px] border border-[rgba(255,255,255,0.6)] bg-[rgba(0,60,113,0.15)] px-4 py-4 text-sm text-[#003C71]">
          <div className="flex items-center gap-3">
            <LoaderCircle className="size-4 animate-spin" style={{ color: "#003C71" }} />
            {t.roomPreview.screen.renderingNow}
          </div>
        </div>
      ) : null}

      {session.status === "failed" ? (
        <div className="mt-5 rounded-[24px] border border-rose-400/30 bg-[rgba(155,50,89,0.08)] px-4 py-4 text-sm text-[#7a1a3a]">
          <p>{t.roomPreview.screen.pipelineFailed}</p>
          {resetCountdown !== null ? (
            <>
              <p className="mt-2 text-xs text-[#7a1a3a]/70">
                {locale === "ar"
                  ? `العودة للبداية خلال ${formatCountdown(resetCountdown)} ثانية`
                  : `Returning to start in ${formatCountdown(resetCountdown)}s`}
              </p>
              <ResetProgressBar
                remaining={resetCountdown}
                total={Math.round(SCREEN_FAILED_RESET_MS / 1000)}
                colorClass="bg-[#7a1a3a]/50"
              />
            </>
          ) : null}
        </div>
      ) : null}

      {idleCountdown !== null && !session.mobileConnected ? (
        <div className="mt-3">
          <p className="text-xs text-[#003C71]/50 text-center">
            {locale === "ar"
              ? `إعادة التشغيل تلقائياً خلال ${formatCountdown(idleCountdown)}`
              : `Auto-reset in ${formatCountdown(idleCountdown)}`}
          </p>
          <ResetProgressBar
            remaining={idleCountdown}
            total={Math.round(SCREEN_IDLE_RESET_MS / 1000)}
            colorClass="bg-[#003C71]/30"
          />
        </div>
      ) : null}

      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:gap-8">
        {(session.selectedRoom?.imageUrl || hasSelectedProduct) ? (
          <>
            {session.selectedRoom?.imageUrl ? (
              <div className="w-full rounded-[24px] border border-[rgba(255,255,255,0.8)] bg-white/85 backdrop-blur-md p-5 shadow-sm transition-all hover:bg-white/95">
                <p className="text-base font-semibold text-[#1d1d1f]">
                  {t.roomPreview.shared.selectedRoomThumbnail}
                </p>
                <div className="relative mt-5 aspect-[4/3] w-full overflow-hidden rounded-[20px] border border-[rgba(0,60,113,0.15)] bg-white/40 shadow-inner">
                  <Image
                    src={session.selectedRoom.imageUrl}
                    alt={t.roomPreview.shared.selectedRoomThumbnail}
                    fill
                    sizes="(max-width: 640px) 100vw, 50vw"
                    className="object-cover"
                  />
                </div>
              </div>
            ) : <div />}

            {hasSelectedProduct ? (
              <div className="w-full rounded-[24px] border border-[rgba(255,255,255,0.8)] bg-white/85 backdrop-blur-md p-5 shadow-sm transition-all hover:bg-white/95">
                <p className="text-base font-semibold text-[#1d1d1f]">{t.roomPreview.shared.selectedItem}</p>
                <p className="mt-2 text-xl font-bold text-[#003C71]">{selectedProduct?.name}</p>
                {localizedProductType ? (
                  <p className="mt-1 text-sm font-medium text-[#4a4a52]">{localizedProductType}</p>
                ) : null}
                {localizedBarcode ? (
                  <p className="mt-1 text-xs text-[#7a9ab5]">{localizedBarcode}</p>
                ) : null}
                <div className="relative mt-4 aspect-[4/3] w-full overflow-hidden rounded-[20px] border border-[rgba(0,60,113,0.15)] bg-white/40 shadow-inner">
                  <Image
                    src={selectedProduct?.imageUrl ?? ""}
                    alt={selectedProduct?.name ?? t.roomPreview.shared.selectedProductThumbnail}
                    fill
                    sizes="(max-width: 640px) 100vw, 50vw"
                    className="object-cover"
                  />
                </div>
              </div>
            ) : <div />}
          </>
        ) : null}

        {hasRenderResult ? (
          <div className="col-span-1 sm:col-span-2 mt-2 w-full rounded-[28px] border border-emerald-500/30 bg-[rgba(108,194,74,0.12)] p-6 shadow-sm">
            <p className="text-base font-bold text-[#1d1d1f]">{t.roomPreview.shared.renderedPreview}</p>
            {localizedCompletedAt ? (
              <p className="mt-1.5 text-sm font-medium text-[#1a6e2a]">{localizedCompletedAt}</p>
            ) : null}
            <div className="relative mt-5 aspect-[16/9] w-full overflow-hidden rounded-[24px] border border-emerald-600/20 bg-black/5 shadow-inner">
              <Image
                src={renderResult?.imageUrl ?? ""}
                alt={t.roomPreview.shared.renderedPreview}
                fill
                sizes="(max-width: 640px) 100vw, 100vw"
                className="object-cover"
              />
            </div>
            {resetCountdown !== null ? (
              <div className="mt-5 mx-auto max-w-sm">
                <p className="text-sm font-semibold text-[#1a6e2a] text-center">
                  {locale === "ar"
                    ? `جلسة جديدة خلال ${formatCountdown(resetCountdown)} ثانية`
                    : `New session starting in ${formatCountdown(resetCountdown)}s`}
                </p>
                <ResetProgressBar
                  remaining={resetCountdown}
                  total={Math.round(SCREEN_RESULT_RESET_MS / 1000)}
                  colorClass="bg-[#1a6e2a]"
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {pollError ? (
        <div className="mt-4 rounded-[20px] border border-orange-400/30 bg-[rgba(250,70,22,0.08)] px-4 py-3 text-sm text-[#7a2800]">
          <p>{t.roomPreview.screen.pollFailedTitle}</p>
          <p className="mt-1 text-[#5a3000]">{pollError}</p>
          <button
            type="button"
            onClick={onRetry}
            className="tour-button mt-3 inline-flex rounded-full px-4 py-2 text-xs font-semibold"
          >
            {t.common.actions.retry}
          </button>
        </div>
      ) : null}
    </div>
  );
}
