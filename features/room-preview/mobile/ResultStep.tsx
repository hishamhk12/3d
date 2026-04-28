"use client";

import { useState, useEffect, useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { Download, RotateCcw, Share2, ZoomIn, X } from "lucide-react";
import { AnimatedButton } from "@/components/ui/AnimatedButton";
import { useI18n } from "@/lib/i18n/provider";
import { getProductTypeLabel } from "@/features/room-preview/shared/helpers";
import type { RoomPreviewSession } from "@/lib/room-preview/types";

// Brand-palette confetti
const CONFETTI_COLORS = ["#F1B434", "#00AFD7", "#003C71", "#FFD97D", "#ffffff"];

function seededRandom(seed: number) {
  const x = Math.sin(seed * 999) * 10000;
  return x - Math.floor(x);
}

const CONFETTI_PARTICLES = Array.from({ length: 14 }).map((_, i) => {
  const angle = (i * 360) / 14 + (seededRandom(i + 1) * 20 - 10);
  const distance = 40 + seededRandom(i + 2) * 40;
  const startRotation = seededRandom(i + 4) * 360;

  return {
    id: i,
    x: Math.cos((angle * Math.PI) / 180) * distance,
    y: Math.sin((angle * Math.PI) / 180) * distance,
    size: 4 + seededRandom(i + 3) * 5,
    startRotation,
    endRotation: startRotation + (seededRandom(i + 5) * 180 - 90),
    color: CONFETTI_COLORS[Math.floor(seededRandom(i + 6) * CONFETTI_COLORS.length)],
    duration: 0.8 + seededRandom(i + 7) * 0.4,
  };
});

function getRenderingStageMessage(seconds: number, stages: {
  started: string;
  qualityCheck: string;
  qualityRetry: string;
  finishing: string;
}) {
  if (seconds >= 45) return stages.finishing;
  if (seconds >= 25) return stages.qualityRetry;
  if (seconds >= 10) return stages.qualityCheck;
  return stages.started;
}

interface ResultStepProps {
  session: RoomPreviewSession;
  isSavingProduct: boolean;
  showResult: boolean;
  onCreateRender: () => Promise<void>;
  onModify: () => void;
}

export default function ResultStep({
  session,
  isSavingProduct,
  showResult,
  onCreateRender,
  onModify,
}: ResultStepProps) {
  const { dir, locale, t } = useI18n();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [btnState, setBtnState] = useState<"idle" | "loading" | "success">("idle");
  const [localShowResult, setLocalShowResult] = useState(showResult);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const renderClickLockedRef = useRef(false);

  useEffect(() => {
    if (showResult) {
      const timer = setTimeout(() => setLocalShowResult(true), 1500);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => {
      setBtnState("idle");
      setLocalShowResult(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [showResult]);

  useEffect(() => {
    if (!isSavingProduct || localShowResult) return;
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [isSavingProduct, localShowResult]);

  useEffect(() => {
    if (!isFullscreen) return;

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [isFullscreen]);

  const selectedProduct = session.selectedProduct;
  const localizedProductType = getProductTypeLabel(selectedProduct?.productType ?? null, locale);
  const currentBtnState = isSavingProduct
    ? "loading"
    : showResult && !localShowResult
      ? "success"
      : btnState;
  const renderingStartedAtMs = Date.parse(session.updatedAt);
  const renderingSeconds =
    currentBtnState === "loading" && Number.isFinite(renderingStartedAtMs)
      ? Math.max(0, Math.floor((nowMs - renderingStartedAtMs) / 1000))
      : 0;
  const renderingStageMessage = getRenderingStageMessage(
    renderingSeconds,
    t.roomPreview.mobile.renderingStages,
  );
  const fullscreenLightbox = isFullscreen ? (
    <div
      className="fullscreen-fade-in fixed inset-0 z-[1000] flex items-center justify-center overflow-hidden bg-black/90 p-3"
      onClick={() => setIsFullscreen(false)}
    >
      <button
        type="button"
        className="absolute top-6 right-6 sm:top-8 sm:right-8 z-[1010] text-white/60 hover:text-white bg-white/08 hover:bg-white/14 transition-all backdrop-blur-md rounded-full p-2.5"
        onClick={(e) => { e.stopPropagation(); setIsFullscreen(false); }}
      >
        <X size={28} />
      </button>

      <div
        className="fullscreen-scale-in relative h-[90svh] w-[96vw] max-h-[90svh] max-w-[96vw] overflow-hidden cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        <Image
          src={session.renderResult?.imageUrl ?? "/rs/rs.png"}
          alt="Full screen preview"
          fill
          unoptimized
          className="object-contain object-center"
          sizes="96vw"
          priority
        />
      </div>
    </div>
  ) : null;

  return (
    <div
      className={
        localShowResult
          ? "-mx-8 -mb-8 mt-0 flex w-[calc(100%+4rem)] flex-col items-center overflow-hidden rounded-b-[32px]"
          : "mt-12 flex flex-col items-center"
      }
    >
      {!localShowResult ? (
        <>
          {/* ── CTA Button ── */}
          <div className="relative flex items-center justify-center h-20 w-full mt-4">
            <button
              type="button"
              className={`btn-cta relative flex items-center justify-center overflow-hidden transition-[width,transform,opacity] duration-500 ease-out disabled:opacity-50 ${
                currentBtnState === "loading" ? "rounded-full" : ""
              }`}
              style={{
                height: 68,
                width: currentBtnState === "loading" ? 68 : 220,
                padding: currentBtnState === "loading" ? 0 : undefined,
              }}
              onClick={() => {
                if (renderClickLockedRef.current) return;
                renderClickLockedRef.current = true;
                setBtnState("loading");
                void onCreateRender().finally(() => {
                  renderClickLockedRef.current = false;
                });
              }}
              disabled={isSavingProduct || currentBtnState === "loading" || currentBtnState === "success"}
            >
              {currentBtnState === "idle" && (
                <div className="button-state-in flex items-center gap-2">
                  <span className="text-xl font-bold text-[var(--text-on-gold)]">{t.common.actions.create}</span>
                </div>
              )}

              {currentBtnState === "loading" && (
                <div className="button-state-in flex items-center justify-center gap-1.5">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="loading-dot size-2 rounded-full bg-[var(--text-on-gold)]/60"
                      style={{ animationDelay: `${i * 0.12}s` }}
                    />
                  ))}
                </div>
              )}

              {currentBtnState === "success" && (
                <div className="button-state-in flex items-center gap-2">
                  <svg className="size-6 text-[var(--text-on-gold)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-xl font-bold text-[var(--text-on-gold)]">{locale === "ar" ? "نجاح" : "Done"}</span>
                </div>
              )}
            </button>

            {/* Confetti burst */}
            {currentBtnState === "success" && (
              <div className="pointer-events-none absolute inset-0 z-50">
                {CONFETTI_PARTICLES.map((particle) => (
                  <span
                    key={particle.id}
                    className="success-confetti-piece absolute left-1/2 top-1/2 rounded-sm"
                    style={{
                      width: particle.size,
                      height: particle.size,
                      backgroundColor: particle.color,
                      "--confetti-x": `${particle.x}px`,
                      "--confetti-y": `${particle.y}px`,
                      "--confetti-start-rotation": `${particle.startRotation}deg`,
                      "--confetti-end-rotation": `${particle.endRotation}deg`,
                      animationDuration: `${particle.duration}s`,
                    } as CSSProperties}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Rendering progress card */}
          {currentBtnState === "loading" ? (
            <div className="mt-5 w-full max-w-sm rounded-[24px] border border-[var(--brand-cyan)]/15 bg-[var(--brand-cyan)]/[0.05] px-5 py-4 text-center">
              <p className="text-sm font-bold text-[var(--brand-cyan)]">{t.roomPreview.mobile.renderingTitle}</p>
              <p className="mt-2 text-xs leading-6 text-[var(--text-muted)]">{renderingStageMessage}</p>
              <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]">
                <div className="rendering-wait-bar h-full w-1/3 rounded-full bg-gradient-to-r from-transparent via-[var(--brand-cyan)] to-transparent" />
              </div>
            </div>
          ) : null}
        </>
      ) : (
        /* ── Result reveal ── */
        <div className="w-full animate-in fade-in duration-700">

          {/* Eyebrow */}
          <p className="mb-5 text-center text-[11px] font-bold tracking-[0.22em] uppercase text-[var(--brand-cyan)]">
            {t.roomPreview.shared.resultReady}
          </p>

          {/* Hero image */}
          <div className="relative w-full overflow-hidden bg-black shadow-[0_24px_64px_rgba(0,0,0,0.60)] sm:rounded-[32px]">
            <div
              className="group relative h-[72svh] min-h-[460px] w-full cursor-pointer transition-all active:scale-[0.98] sm:h-[70vh] sm:max-h-[760px] sm:min-h-[560px]"
              onClick={() => setIsFullscreen(true)}
            >
              <div className="absolute top-4 right-4 z-20 bg-black/50 backdrop-blur-md text-white/80 p-2.5 rounded-full opacity-70 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                <ZoomIn size={20} />
              </div>

              <Image
                src={session.renderResult?.imageUrl ?? "/rs/rs.png"}
                alt={t.roomPreview.shared.renderedPreview}
                fill
                unoptimized
                className="object-cover object-center transition-transform duration-700 ease-out group-hover:scale-105"
                priority
                sizes="100vw"
              />

              <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/85 via-black/35 to-transparent pointer-events-none" />

              {/* Floating product spec card — always dark (overlaid on photo) */}
              {selectedProduct ? (
                <div
                  className="absolute inset-x-3 bottom-3 animate-in slide-in-from-bottom-3 fade-in duration-700"
                  style={{ animationDelay: "350ms", animationFillMode: "backwards" }}
                >
                  <div className="rounded-[22px] border border-white/12 bg-black/60 p-3 shadow-[0_8px_32px_rgba(0,0,0,0.50)] backdrop-blur-2xl">
                    <div className={`flex items-center gap-3 ${dir === "rtl" ? "flex-row-reverse" : ""}`}>

                      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-[14px] border-2 border-white/20 shadow-md">
                        <Image
                          src={selectedProduct.imageUrl ?? ""}
                          alt={selectedProduct.name ?? ""}
                          fill
                          unoptimized
                          className="object-cover"
                        />
                      </div>

                      <div className={`min-w-0 flex-1 ${dir === "rtl" ? "text-right" : "text-left"}`}>
                        <p className="truncate text-sm font-semibold leading-tight text-white">
                          {selectedProduct.name}
                        </p>
                        {localizedProductType ? (
                          <p className="mt-0.5 text-xs text-white/55">{localizedProductType}</p>
                        ) : null}
                        {selectedProduct.barcode ? (
                          <p className="mt-1 font-mono text-[10px] text-white/35">{selectedProduct.barcode}</p>
                        ) : null}
                      </div>

                      {/* Ready pill */}
                      <div className="shrink-0 flex items-center gap-1.5 rounded-full border border-[#F1B434]/35 bg-[#F1B434]/15 px-2.5 py-1.5">
                        <span className="block h-1.5 w-1.5 animate-pulse rounded-full bg-[#F1B434]" />
                        <span className="whitespace-nowrap text-[11px] font-semibold text-[#F1B434]">
                          {locale === "ar" ? "جاهز" : "Ready"}
                        </span>
                      </div>

                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {/* Action bar */}
          <div
            className="mt-4 grid grid-cols-3 gap-3 animate-in slide-in-from-bottom-2 fade-in duration-700"
            style={{ animationDelay: "500ms", animationFillMode: "backwards" }}
          >
            <a
              href={session.renderResult?.imageUrl ?? "/rs/rs.png"}
              download="bayt-alebaa-render.jpg"
              className="flex flex-col items-center gap-2 rounded-[20px] border border-[var(--border)] bg-[var(--bg-surface)] py-4 transition hover:bg-[var(--bg-surface-2)] hover:border-[var(--border-strong)] active:scale-95"
            >
              <Download className="size-5 text-[var(--brand-cyan)]" />
              <span className="text-[11px] font-semibold text-[var(--text-secondary)]">
                {locale === "ar" ? "تحميل" : "Download"}
              </span>
            </a>

            <AnimatedButton
              type="button"
              className="flex flex-col items-center gap-2 rounded-[20px] border border-[var(--border)] bg-[var(--bg-surface)] py-4 transition hover:bg-[var(--bg-surface-2)] hover:border-[var(--border-strong)]"
              onClick={() => {
                if (typeof navigator !== "undefined" && navigator.share) {
                  void navigator.share({
                    title: locale === "ar" ? "تصميم غرفتي | بيت الإباء" : "My Room Design | Bayt Alebaa",
                    url: window.location.href,
                  });
                }
              }}
            >
              <Share2 className="size-5 text-[var(--brand-cyan)]" />
              <span className="text-[11px] font-semibold text-[var(--text-secondary)]">
                {locale === "ar" ? "مشاركة" : "Share"}
              </span>
            </AnimatedButton>

            <AnimatedButton
              type="button"
              className="flex flex-col items-center gap-2 rounded-[20px] border border-[var(--border)] bg-[var(--bg-surface)] py-4 transition hover:bg-[var(--bg-surface-2)] hover:border-[var(--border-strong)]"
              onClick={onModify}
            >
              <RotateCcw className="size-5 text-[var(--brand-cyan)]" />
              <span className="text-[11px] font-semibold text-[var(--text-secondary)]">
                {locale === "ar" ? "تعديل" : "Modify"}
              </span>
            </AnimatedButton>
          </div>

        </div>
      )}

      {/* Fullscreen lightbox rendered at document body level for stable mobile viewport sizing */}
      {fullscreenLightbox && typeof document !== "undefined"
        ? createPortal(fullscreenLightbox, document.body)
        : null}
    </div>
  );
}
