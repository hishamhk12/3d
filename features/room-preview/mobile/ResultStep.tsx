"use client";

import { useState, useEffect, useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { Download, RotateCcw, Share2, ZoomIn, X } from "lucide-react";
import { AnimatedButton } from "@/components/ui/AnimatedButton";
import { useI18n } from "@/lib/i18n/provider";
import { getProductTypeLabel } from "@/features/room-preview/shared/helpers";
import { trackClientSessionEvent } from "@/lib/room-preview/session-diagnostics-client";
import type { RoomPreviewSession } from "@/lib/room-preview/types";

// ── Confetti ───────────────────────────────────────────────────────────────────

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

// ── Render loading screen ──────────────────────────────────────────────────────

const RENDER_MESSAGES = [
  "جاري إنشاء التصميم...",
  "نحلل تفاصيل الغرفة",
  "نختار أفضل التركيبات",
  "نضبط الإضاءة والألوان",
  "لحظات وسيكون جاهزاً",
  "نضع اللمسات الأخيرة",
];

// [targetPercent, delayMs] — stays clamped at 96% until showResult triggers 100%
const PROGRESS_STAGES: [number, number][] = [
  [35,  3_000],
  [65,  8_000],
  [88, 14_000],
  [96, 22_000],
];


function RenderLoadingScreen({
  session,
  showResult,
}: {
  session: RoomPreviewSession;
  showResult: boolean;
}) {
  const [progress, setProgress] = useState(0);
  const [msgIndex, setMsgIndex] = useState(0);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    if (showResult) {
      setProgress(100);
      // Wait for the logo clip transition (1300ms) to finish before fading out
      const timer = setTimeout(() => setFadeOut(true), 1400);
      return () => clearTimeout(timer);
    }
    setFadeOut(false);
    const timers = PROGRESS_STAGES.map(([pct, delay]) =>
      setTimeout(() => setProgress(pct), delay),
    );
    return () => timers.forEach(clearTimeout);
  }, [showResult]);

  useEffect(() => {
    if (showResult) return;
    const id = setInterval(
      () => setMsgIndex((i) => (i + 1) % RENDER_MESSAGES.length),
      3_500,
    );
    return () => clearInterval(id);
  }, [showResult]);

  const roomBg = session.selectedRoom?.imageUrl;

  // Lock scroll while overlay is mounted
  useEffect(() => {
    const prevBody = document.body.style.overflow;
    const prevHtml = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevBody;
      document.documentElement.style.overflow = prevHtml;
    };
  }, []);

  if (typeof document === "undefined") return null;

  const overlay = (
    <>
      <style>{`
        @keyframes render-msg-in {
          from { opacity: 0; transform: translateY(9px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
        .render-msg { animation: render-msg-in 0.48s cubic-bezier(0.22,1,0.36,1) forwards; }
      `}</style>

      <div
        className="fixed inset-0 z-[9999] flex w-full flex-col items-center justify-center overflow-hidden"
        style={{
          height: "100dvh",
          transition: "opacity 750ms ease",
          opacity: fadeOut ? 0 : 1,
          pointerEvents: fadeOut ? "none" : "auto",
        }}
      >
        {/* Background */}
        {roomBg ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={roomBg}
              alt=""
              aria-hidden
              className="absolute inset-0 h-full w-full object-cover"
              style={{ filter: "blur(26px)", transform: "scale(1.08)" }}
            />
            <div className="absolute inset-0 bg-black/72" />
          </>
        ) : (
          <div className="absolute inset-0 bg-[#07101E]" />
        )}

        {/* Radial vignette */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(ellipse 70% 60% at 50% 50%, transparent 40%, rgba(0,0,0,0.55) 100%)" }}
        />

        {/* Content — fixed max-width, no overflow */}
        <div className="relative z-10 flex w-full max-w-[310px] flex-col items-center gap-8 px-6">

          {/* Geometric company mark — clipped by progress */}
          <div className="relative" style={{ width: 96, height: 112 }}>
            {/* Ghost: full shape, very faint, always visible */}
            <svg viewBox="0 0 69.16 80.69" width={96} height={112} className="absolute inset-0">
              <path
                d="M0,0v80.69h69.16v-28.97c0-3.1-2.51-5.61-5.61-5.61H23.05v11.53h34.58v11.53H11.53V11.53h46.11v11.53H23.05v11.53h40.54c3.08,0,5.57-2.49,5.57-5.57V0H0"
                fill="#00ADD7"
                opacity={0.12}
              />
            </svg>
            {/* Revealed shape: clipped top-to-bottom by progress */}
            <svg
              viewBox="0 0 69.16 80.69"
              width={96}
              height={112}
              className="absolute inset-0"
              style={{
                clipPath: `inset(0 0 ${100 - progress}% 0)`,
                transition: "clip-path 1300ms cubic-bezier(0.4,0,0.2,1)",
              }}
            >
              <path
                d="M0,0v80.69h69.16v-28.97c0-3.1-2.51-5.61-5.61-5.61H23.05v11.53h34.58v11.53H11.53V11.53h46.11v11.53H23.05v11.53h40.54c3.08,0,5.57-2.49,5.57-5.57V0H0"
                fill="#00ADD7"
              />
            </svg>
          </div>

          <p
            key={msgIndex}
            className="render-msg text-center text-[17px] font-semibold leading-relaxed text-white"
            dir="rtl"
          >
            {RENDER_MESSAGES[msgIndex]}
          </p>

          <div className="w-full">
            <div className="h-[3px] w-full overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full bg-[#00AFD7]"
                style={{
                  width: `${progress}%`,
                  transition: "width 1300ms cubic-bezier(0.4,0,0.2,1)",
                }}
              />
            </div>
            <div className="mt-2.5 flex items-center justify-between" dir="rtl">
              <span className="text-[11px] font-medium text-white/40">
                {showResult ? "اكتمل التصميم" : "جاري المعالجة"}
              </span>
              <span className="font-mono text-[11px] text-white/40">{progress}%</span>
            </div>
          </div>

        </div>
      </div>
    </>
  );

  return createPortal(overlay, document.body);
}

// ── Main component ─────────────────────────────────────────────────────────────

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
  const [btnState, setBtnState] = useState<"idle" | "loading">("idle");
  const [localShowResult, setLocalShowResult] = useState(showResult);
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
    if (!localShowResult && !isFullscreen) return;
    const prevBody = document.body.style.overflow;
    const prevHtml = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevBody;
      document.documentElement.style.overflow = prevHtml;
    };
  }, [localShowResult, isFullscreen]);

  const selectedProduct = session.selectedProduct;
  const localizedProductType = getProductTypeLabel(selectedProduct?.productType ?? null, locale);

  const showLoadingScreen = (isSavingProduct || showResult) && !localShowResult;
  const showIdleButton = !localShowResult && !isSavingProduct && !showResult;

  const fullscreenLightbox = isFullscreen ? (
    <div
      className="fullscreen-fade-in fixed inset-0 z-[10000] flex items-center justify-center overflow-hidden bg-black/90 p-3"
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

  // ── Result fullscreen overlay (portal — outside any stacking context) ─────────
  const resultOverlay = localShowResult && typeof document !== "undefined"
    ? createPortal(
        <div
          className="fixed inset-0 z-[9998] flex flex-col animate-in fade-in duration-700"
          style={{ height: "100dvh" }}
        >
          {/* Image — fills all space above action bar */}
          <div
            className="group relative min-h-0 flex-1 cursor-pointer overflow-hidden bg-black"
            onClick={() => setIsFullscreen(true)}
          >
            <div className="absolute top-4 right-4 z-20 rounded-full bg-black/50 p-2.5 text-white/80 opacity-70 backdrop-blur-md transition-opacity">
              <ZoomIn size={20} />
            </div>

            <Image
              src={session.renderResult?.imageUrl ?? "/rs/rs.png"}
              alt={t.roomPreview.shared.renderedPreview}
              fill
              unoptimized
              className="object-cover object-center"
              priority
              sizes="100vw"
            />

            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />

            {/* Floating product card */}
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

          {/* Action bar — pinned at bottom */}
          <div
            className="grid grid-cols-3 gap-3 border-t border-white/10 bg-black/85 px-4 py-4 backdrop-blur-xl animate-in slide-in-from-bottom-2 fade-in duration-700"
            style={{ animationDelay: "500ms", animationFillMode: "backwards" }}
          >
            <a
              href={session.renderResult?.imageUrl ?? "/rs/rs.png"}
              download="bayt-alebaa-render.jpg"
              className="flex flex-col items-center gap-2 rounded-[20px] border border-white/12 bg-white/08 py-4 transition active:scale-95 hover:bg-white/14"
            >
              <Download className="size-5 text-[#00AFD7]" />
              <span className="text-[11px] font-semibold text-white/70">
                {locale === "ar" ? "تحميل" : "Download"}
              </span>
            </a>

            <AnimatedButton
              type="button"
              className="flex flex-col items-center gap-2 rounded-[20px] border border-white/12 bg-white/08 py-4 transition hover:bg-white/14"
              onClick={() => {
                if (typeof navigator !== "undefined" && navigator.share) {
                  void navigator.share({
                    title: locale === "ar" ? "تصميم غرفتي | بيت الإباء" : "My Room Design | Bayt Alebaa",
                    url: window.location.href,
                  });
                }
              }}
            >
              <Share2 className="size-5 text-[#00AFD7]" />
              <span className="text-[11px] font-semibold text-white/70">
                {locale === "ar" ? "مشاركة" : "Share"}
              </span>
            </AnimatedButton>

            <AnimatedButton
              type="button"
              className="flex flex-col items-center gap-2 rounded-[20px] border border-white/12 bg-white/08 py-4 transition hover:bg-white/14"
              onClick={onModify}
            >
              <RotateCcw className="size-5 text-[#00AFD7]" />
              <span className="text-[11px] font-semibold text-white/70">
                {locale === "ar" ? "تعديل" : "Modify"}
              </span>
            </AnimatedButton>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <div className="mt-12 flex flex-col items-center">
      {/* Loading overlay */}
      {showLoadingScreen && (
        <RenderLoadingScreen session={session} showResult={showResult} />
      )}

      {/* CTA button (idle only) */}
      {showIdleButton && (
        <div className="relative flex items-center justify-center h-20 w-full mt-4">
          <button
            type="button"
            className={`btn-cta relative flex items-center justify-center overflow-hidden transition-[width,transform,opacity] duration-500 ease-out disabled:opacity-50 ${
              btnState === "loading" ? "rounded-full" : ""
            }`}
            style={{
              height: 68,
              width: btnState === "loading" ? 68 : 220,
              padding: btnState === "loading" ? 0 : undefined,
            }}
            onClick={() => {
              console.log("[render] clicked", {
                locked: renderClickLockedRef.current,
                btnState,
                isSavingProduct,
                sessionId: session.id,
                sessionStatus: session.status,
              });
              trackClientSessionEvent(session.id, {
                source: "mobile",
                eventType: "render_start_clicked",
                level: "info",
                metadata: {
                  locked: renderClickLockedRef.current,
                  currentBtnState: btnState,
                  isSavingProduct,
                  currentStatus: session.status,
                  hasRoomImage: Boolean(session.selectedRoom?.imageUrl),
                  hasProduct: Boolean(session.selectedProduct?.id && session.selectedProduct?.imageUrl),
                  productId: session.selectedProduct?.id ?? null,
                },
              });
              if (renderClickLockedRef.current) return;
              renderClickLockedRef.current = true;
              setBtnState("loading");
              void onCreateRender().finally(() => {
                renderClickLockedRef.current = false;
              });
            }}
            disabled={btnState === "loading"}
          >
            {btnState === "idle" && (
              <div className="button-state-in flex items-center gap-2">
                <span className="text-xl font-bold text-[var(--text-on-gold)]">{t.common.actions.create}</span>
              </div>
            )}
            {btnState === "loading" && (
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
          </button>
        </div>
      )}

      {/* Result overlay portal */}
      {resultOverlay}

      {/* Lightbox portal */}
      {fullscreenLightbox && typeof document !== "undefined"
        ? createPortal(fullscreenLightbox, document.body)
        : null}
    </div>
  );
}
