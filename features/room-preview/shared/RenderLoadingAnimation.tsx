"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import BrandedGlassStage from "@/components/room-preview/BrandedGlassStage";
import RoomPreviewBackButton from "@/components/room-preview/RoomPreviewBackButton";
import {
  COMPANY_LOGO_SRC,
  LOGO_RATIO_H,
  LOGO_RATIO_W,
} from "@/components/ui/animated-scan-loader";
import type { RoomPreviewSession } from "@/lib/room-preview/types";

const RENDER_MESSAGES = [
  "جاري إنشاء التصميم...",
  "نحلل تفاصيل الغرفة",
  "نختار أفضل التركيبات",
  "نضبط الإضاءة والألوان",
  "لحظات وسيكون جاهزاً",
  "نضع اللمسات الأخيرة",
];

// [targetPercent, delayMs] — clamped at 96% until showResult triggers 100%
const PROGRESS_STAGES: [number, number][] = [
  [35,  3_000],
  [65,  8_000],
  [88, 14_000],
  [96, 22_000],
];

export function RenderLoadingAnimation({
  session,
  showResult,
  variant = "mobile",
  onMobileBack,
  mobileBackLabel = "Back",
}: {
  session: RoomPreviewSession;
  showResult: boolean;
  variant?: "mobile" | "screen";
  onMobileBack?: () => void;
  mobileBackLabel?: string;
}) {
  const [progress, setProgress] = useState(0);
  const [msgIndex, setMsgIndex] = useState(0);
  const [fadeOut, setFadeOut] = useState(false);
  const [showLongRenderMsg, setShowLongRenderMsg] = useState(false);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (showResult) {
      timers.push(setTimeout(() => setProgress(100), 0));
      // Wait for the logo clip transition (1300ms) before fading out
      timers.push(setTimeout(() => setFadeOut(true), 1400));
      return () => timers.forEach(clearTimeout);
    }
    timers.push(setTimeout(() => setFadeOut(false), 0));
    timers.push(...PROGRESS_STAGES.map(([pct, delay]) =>
      setTimeout(() => setProgress(pct), delay),
    ));
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

  useEffect(() => {
    if (variant !== "screen" || showResult) { setShowLongRenderMsg(false); return; }
    const timer = setTimeout(() => setShowLongRenderMsg(true), 90_000);
    return () => { clearTimeout(timer); setShowLongRenderMsg(false); };
  }, [variant, showResult]);

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

  const isScreen = variant === "screen";

  // Sizing tokens — screen is scaled for a 42-inch 16:9 display
  const contentMaxW  = isScreen ? "max-w-[560px]" : "max-w-[310px]";
  const contentGap   = isScreen ? "gap-12" : "gap-8";
  const contentPad   = isScreen ? "px-8" : "px-6";
  const msgTextClass = isScreen
    ? "text-[28px] font-semibold leading-snug"
    : "text-[17px] font-semibold leading-relaxed";
  const progressH    = isScreen ? "h-[6px]" : "h-[3px]";
  const metaTextClass = isScreen ? "text-[15px] font-medium" : "text-[11px] font-medium";

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
        className="fixed inset-0 z-[9999] w-full overflow-hidden"
        style={{
          height: "100dvh",
          transition: "opacity 750ms ease",
          opacity: fadeOut ? 0 : 1,
          pointerEvents: fadeOut ? "none" : "auto",
        }}
      >

        <BrandedGlassStage backgroundImage='url("/croissant.jpg")'>
          {!isScreen && onMobileBack ? (
            <RoomPreviewBackButton
              ariaLabel={mobileBackLabel}
              onClick={onMobileBack}
              size={40}
              className="z-[3]"
              style={{ top: "max(16px, env(safe-area-inset-top))", left: 16 }}
            />
          ) : null}
          <div className="absolute inset-0 z-[1] flex items-center justify-center">
            {/* Content */}
            <div className={`relative z-10 flex w-full ${contentMaxW} flex-col items-center ${contentGap} ${contentPad}`}>

              {/* Real company logo — same asset, ratio and display sizing as the transition loader. */}
              <div className="relative w-[min(640px,58vw)]">
                <Image
                  src={COMPANY_LOGO_SRC}
                  alt="شعار الشركة"
                  width={LOGO_RATIO_W}
                  height={LOGO_RATIO_H}
                  priority
                  unoptimized
                  draggable={false}
                  className="block h-auto w-full select-none opacity-[0.12]"
                />
                <Image
                  src={COMPANY_LOGO_SRC}
                  alt=""
                  width={LOGO_RATIO_W}
                  height={LOGO_RATIO_H}
                  priority
                  unoptimized
                  draggable={false}
                  className="absolute inset-0 block h-auto w-full select-none"
                  style={{
                    clipPath: `inset(0 0 ${100 - progress}% 0)`,
                    transition: "clip-path 1300ms cubic-bezier(0.4,0,0.2,1)",
                  }}
                />
              </div>

          <p
            key={msgIndex}
            className={`render-msg text-center ${msgTextClass} text-white`}
            dir="rtl"
          >
            {RENDER_MESSAGES[msgIndex]}
          </p>

          <div className="w-full">
            <div className={`${progressH} w-full overflow-hidden rounded-full bg-white/15`}>
              <div
                className="h-full rounded-full bg-[#00AFD7]"
                style={{
                  width: `${progress}%`,
                  transition: "width 1300ms cubic-bezier(0.4,0,0.2,1)",
                }}
              />
            </div>
            <div className="mt-2.5 flex items-center justify-between" dir="rtl">
              <span className={`${metaTextClass} text-white/40`}>
                {showResult ? "اكتمل التصميم" : "جاري المعالجة"}
              </span>
              <span className={`font-mono ${metaTextClass} text-white/40`}>{progress}%</span>
            </div>
          </div>

          {isScreen && showLongRenderMsg && !showResult ? (
            <p
              className="text-center text-[15px] font-medium leading-relaxed text-white/50 animate-in fade-in duration-700"
              dir="rtl"
            >
              قد تستغرق المعاينة وقتًا أطول قليلًا، نعمل على تجهيزها الآن...
            </p>
          ) : null}

            </div>
          </div>
        </BrandedGlassStage>
      </div>
    </>
  );

  return createPortal(overlay, document.body);
}
