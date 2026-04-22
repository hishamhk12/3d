"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { Download, LoaderCircle, RotateCcw, Share2, ZoomIn, X, Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { AnimatedButton } from "@/components/ui/AnimatedButton";
import { useI18n } from "@/lib/i18n/provider";
import { getProductTypeLabel } from "@/features/room-preview/shared/helpers";
import type { RoomPreviewSession } from "@/lib/room-preview/types";

// ─── Props ────────────────────────────────────────────────────────────────────

interface ResultStepProps {
  session: RoomPreviewSession;
  /** Doubles as the render-in-progress loading flag (same state var as product saving). */
  isSavingProduct: boolean;
  isScanning: boolean;
  showResult: boolean;
  onCreateRender: () => void;
  onModify: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ResultStep({
  session,
  isSavingProduct,
  isScanning,
  showResult,
  onCreateRender,
  onModify,
}: ResultStepProps) {
  const { dir, locale, t } = useI18n();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [btnState, setBtnState] = useState<"idle" | "loading" | "success">("idle");
  const [localShowResult, setLocalShowResult] = useState(showResult);

  useEffect(() => {
    if (isSavingProduct) {
      setBtnState("loading");
    } else if (showResult && btnState === "loading") {
      setBtnState("success");
      const timer = setTimeout(() => {
        setLocalShowResult(true);
      }, 1500); // give confetti time to show
      return () => clearTimeout(timer);
    } else if (showResult) {
      setLocalShowResult(true);
    } else if (!isSavingProduct && !showResult) {
      setBtnState("idle");
      setLocalShowResult(false);
    }
  }, [isSavingProduct, showResult, btnState]);

  const confettiColors = ["#4f46e5", "#818cf8", "#c084fc", "#6366f1", "#a855f7"];
  const selectedProduct  = session.selectedProduct;
  const localizedProductType = getProductTypeLabel(selectedProduct?.productType ?? null, locale);

  return (
    <div className="mt-12 flex flex-col items-center">
      <style>{`
        .create-pulse-btn {
          position: relative;
          background: linear-gradient(180deg, #ffffff 0%, #f0f0f5 100%);
          color: #1d1d1f;
          border-radius: 9999px;
          border: 1px solid rgba(255, 255, 255, 0.8);
          box-shadow: 
            0 20px 40px -10px rgba(0, 0, 0, 0.4), 
            0 0 40px 5px rgba(255, 140, 50, 0.5), 
            inset 0 1px 1px rgba(255, 255, 255, 1); 
          transition: all 0.3s cubic-bezier(0.25, 1, 0.5, 1);
          z-index: 1;
        }

        .create-pulse-btn:hover {
          transform: translateY(-2px) scale(1.02);
          box-shadow: 
            0 25px 50px -12px rgba(0, 0, 0, 0.5),
            0 0 50px 10px rgba(255, 150, 60, 0.6),
            inset 0 1px 1px rgba(255, 255, 255, 1);
        }

        .create-pulse-btn:active {
          transform: translateY(2px) scale(0.98);
          box-shadow: 
            0 10px 20px -5px rgba(0, 0, 0, 0.3),
            0 0 20px 2px rgba(255, 140, 50, 0.4),
            inset 0 1px 1px rgba(255, 255, 255, 1);
        }

        .create-pulse-btn::after {
          content: "";
          position: absolute;
          inset: -4px;
          border-radius: 9999px;
          border: 2px solid rgba(255, 140, 50, 0.8);
          opacity: 0;
          transform: scale(0.95);
          pointer-events: none;
        }

        .create-pulse-btn:active::after {
          animation: actomePulse 0.5s ease-out;
        }

        @keyframes actomePulse {
          0% { transform: scale(0.95); opacity: 0.8; border-width: 4px; }
          100% { transform: scale(1.2); opacity: 0; border-width: 0px; }
        }
      `}</style>

      {!localShowResult ? (
        <div className="relative flex items-center justify-center h-20 w-full mt-4">
          <motion.button
            type="button"
            layout
            className="create-pulse-btn relative flex items-center justify-center overflow-hidden transition disabled:opacity-60"
            style={{ height: 68 }}
            animate={{
              width: btnState === "loading" ? 68 : 220,
            }}
            transition={{ type: "spring", bounce: 0, duration: 0.5 }}
            onClick={() => void onCreateRender()}
            disabled={isSavingProduct || isScanning || btnState === "success"}
          >
            <AnimatePresence mode="wait" initial={false}>
              {btnState === "idle" && (
                <motion.div
                  key="idle"
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -15, transition: { duration: 0.2 } }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                  className="flex items-center gap-2"
                >
                  <span className="text-xl font-bold">{t.common.actions.create}</span>
                </motion.div>
              )}

              {btnState === "loading" && (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.2 } }}
                  className="flex items-center justify-center gap-1.5"
                >
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      className="size-2 rounded-full bg-[#1d1d1f]/70"
                      animate={{ y: ["0%", "-40%", "0%"] }}
                      transition={{
                        duration: 0.6,
                        repeat: Infinity,
                        ease: "easeInOut",
                        delay: i * 0.12,
                      }}
                    />
                  ))}
                </motion.div>
              )}

              {btnState === "success" && (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, y: 15, transition: { duration: 0.2 } }}
                  transition={{ duration: 0.4, type: "spring", bounce: 0 }}
                  className="flex items-center gap-2"
                >
                  <Check className="size-6 text-emerald-500" strokeWidth={3} />
                  <span className="text-xl font-bold">{locale === "ar" ? "نجاح" : "Success"}</span>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.button>

          {/* Confetti Burst */}
          <AnimatePresence>
            {btnState === "success" && (
              <div className="absolute inset-0 pointer-events-none z-50">
                {Array.from({ length: 14 }).map((_, i) => {
                  const angle = (i * 360) / 14 + (Math.random() * 20 - 10);
                  const distance = 40 + Math.random() * 40;
                  const x = Math.cos((angle * Math.PI) / 180) * distance;
                  const y = Math.sin((angle * Math.PI) / 180) * distance;
                  const size = 4 + Math.random() * 5;
                  const startRotation = Math.random() * 360;
                  const endRotation = startRotation + (Math.random() * 180 - 90);
                  const color = confettiColors[Math.floor(Math.random() * confettiColors.length)];

                  return (
                    <motion.div
                      key={i}
                      className="absolute left-1/2 top-1/2 rounded-sm"
                      style={{
                        width: size,
                        height: size,
                        backgroundColor: color,
                        x: "-50%",
                        y: "-50%",
                      }}
                      initial={{ opacity: 1, x: "-50%", y: "-50%", rotate: startRotation }}
                      animate={{
                        opacity: 0,
                        x: `calc(-50% + ${x}px)`,
                        y: `calc(-50% + ${y}px)`,
                        rotate: endRotation,
                      }}
                      transition={{
                        duration: 0.8 + Math.random() * 0.4,
                        ease: [0.25, 1, 0.5, 1],
                      }}
                    />
                  );
                })}
              </div>
            )}
          </AnimatePresence>
        </div>
      ) : (
        /* ── Premium result hero ── */
        <div className="mt-6 w-full animate-in fade-in duration-700">

          {/* Eyebrow */}
          <p
            className="mb-5 text-center text-[11px] font-bold tracking-[0.22em] uppercase text-[#003C71]"
            style={{ textShadow: "0 1px 2px rgba(255,255,255,0.8)" }}
          >
            {t.roomPreview.shared.resultReady}
          </p>

          {/* Hero image + overlaid glass card */}
          <div className="relative w-full overflow-hidden rounded-[32px] shadow-[0_24px_64px_rgba(0,60,113,0.18),0_8px_24px_rgba(0,0,0,0.12)]">
            <div 
              className="relative aspect-[4/5] sm:aspect-square md:aspect-[4/3] w-full group cursor-pointer transition-all active:scale-[0.98]" 
              onClick={() => setIsFullscreen(true)}
            >
              <div className="absolute top-4 right-4 z-20 bg-black/40 backdrop-blur-md text-white/90 p-2.5 rounded-full opacity-60 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                <ZoomIn size={20} />
              </div>

              <Image
                src={session.renderResult?.imageUrl ?? "/rs/rs.png"}
                alt={t.roomPreview.shared.renderedPreview}
                fill
                unoptimized
                className="object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                priority
              />

              {/* Gradient veil — fades bottom so card text stays legible */}
              <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 via-black/30 to-transparent pointer-events-none" />

              {/* Floating product spec card */}
              {selectedProduct ? (
                <div
                  className="absolute inset-x-3 bottom-3 animate-in slide-in-from-bottom-3 fade-in duration-700"
                  style={{ animationDelay: "350ms", animationFillMode: "backwards" }}
                >
                  <div className="rounded-[22px] border border-white/20 bg-white/10 p-3 shadow-[0_8px_32px_rgba(0,0,0,0.25)] backdrop-blur-2xl">
                    <div className={`flex items-center gap-3 ${dir === "rtl" ? "flex-row-reverse" : ""}`}>

                      {/* Texture swatch */}
                      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-[14px] border-2 border-white/30 shadow-md">
                        <Image
                          src={selectedProduct.imageUrl ?? ""}
                          alt={selectedProduct.name ?? ""}
                          fill
                          unoptimized
                          className="object-cover"
                        />
                      </div>

                      {/* Product copy */}
                      <div className={`min-w-0 flex-1 ${dir === "rtl" ? "text-right" : "text-left"}`}>
                        <p className="truncate text-sm font-semibold leading-tight text-white">
                          {selectedProduct.name}
                        </p>
                        {localizedProductType ? (
                          <p className="mt-0.5 text-xs text-white/60">{localizedProductType}</p>
                        ) : null}
                        {selectedProduct.barcode ? (
                          <p className="mt-1 font-mono text-[10px] text-white/40">{selectedProduct.barcode}</p>
                        ) : null}
                      </div>

                      {/* Ready pill */}
                      <div className="shrink-0 flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-500/25 px-2.5 py-1.5">
                        <span className="block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                        <span className="whitespace-nowrap text-[11px] font-semibold text-emerald-300">
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
            {/* Download */}
            <a
              href={session.renderResult?.imageUrl ?? "/rs/rs.png"}
              download="bayt-alebaa-render.jpg"
              className="flex flex-col items-center gap-2 rounded-[20px] border border-white/60 bg-white/50 py-4 shadow-sm backdrop-blur-sm transition hover:bg-white/70 active:scale-95"
            >
              <Download className="size-5 text-[#003C71]" />
              <span className="text-[11px] font-semibold text-[#1d1d1f]">
                {locale === "ar" ? "تحميل" : "Download"}
              </span>
            </a>

            {/* Share */}
            <AnimatedButton
              type="button"
              className="flex flex-col items-center gap-2 rounded-[20px] border border-white/60 bg-white/50 py-4 shadow-sm backdrop-blur-sm transition hover:bg-white/70"
              onClick={() => {
                if (typeof navigator !== "undefined" && navigator.share) {
                  void navigator.share({
                    title: locale === "ar" ? "تصميم غرفتي | بيت الإباء" : "My Room Design | Bayt Alebaa",
                    url: window.location.href,
                  });
                }
              }}
            >
              <Share2 className="size-5 text-[#003C71]" />
              <span className="text-[11px] font-semibold text-[#1d1d1f]">
                {locale === "ar" ? "مشاركة" : "Share"}
              </span>
            </AnimatedButton>

            {/* Modify selection */}
            <AnimatedButton
              type="button"
              className="flex flex-col items-center gap-2 rounded-[20px] border border-white/60 bg-white/50 py-4 shadow-sm backdrop-blur-sm transition hover:bg-white/70"
              onClick={onModify}
            >
              <RotateCcw className="size-5 text-[#003C71]" />
              <span className="text-[11px] font-semibold text-[#1d1d1f]">
                {locale === "ar" ? "تعديل" : "Modify"}
              </span>
            </AnimatedButton>
          </div>

        </div>
      )}

      {/* Fullscreen Lightbox Modal */}
      <AnimatePresence>
        {isFullscreen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-lg"
            onClick={() => setIsFullscreen(false)}
          >
            <button
              className="absolute top-6 right-6 sm:top-8 sm:right-8 z-[110] text-white/70 hover:text-white bg-white/10 hover:bg-white/20 transition-all backdrop-blur-md rounded-full p-2.5"
              onClick={(e) => {
                e.stopPropagation();
                setIsFullscreen(false);
              }}
            >
              <X size={28} />
            </button>

            <motion.div
               initial={{ scale: 0.95, opacity: 0 }}
               animate={{ scale: 1, opacity: 1 }}
               exit={{ scale: 0.95, opacity: 0 }}
               transition={{ type: "spring", damping: 30, stiffness: 300 }}
               className="relative w-[95%] h-[90%] flex items-center justify-center cursor-default"
               onClick={(e) => e.stopPropagation()} // Prevent closing when clicking the image container itself
            >
              <Image
                src={session.renderResult?.imageUrl ?? "/rs/rs.png"}
                alt="Full screen preview"
                fill
                unoptimized
                className="object-contain"
                sizes="100vw"
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
