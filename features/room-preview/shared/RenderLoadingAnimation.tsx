"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
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
}: {
  session: RoomPreviewSession;
  showResult: boolean;
  variant?: "mobile" | "screen";
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
  const logoW        = isScreen ? 160 : 96;
  const logoH        = isScreen ? 186 : 112;
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
        className={`${isScreen ? "screen-render-overlay" : ""} fixed inset-0 z-[9999] flex w-full flex-col items-center justify-center overflow-hidden bg-black`}
        style={{
          height: isScreen ? "100svh" : "100dvh",
          transition: "opacity 750ms ease",
          opacity: fadeOut ? 0 : 1,
          pointerEvents: fadeOut ? "none" : "auto",
        }}
      >

        {/* Content */}
        <div className={`relative z-10 flex w-full ${contentMaxW} flex-col items-center ${contentGap} ${contentPad}`}>

          {/* Geometric company mark — clipped top-to-bottom by progress */}
          <div className="relative" style={{ width: logoW, height: logoH }}>
            {/* Ghost shape — always visible, very faint */}
            <svg viewBox="0 0 69.16 80.69" width={logoW} height={logoH} className="absolute inset-0">
              <path
                d="M0,0v80.69h69.16v-28.97c0-3.1-2.51-5.61-5.61-5.61H23.05v11.53h34.58v11.53H11.53V11.53h46.11v11.53H23.05v11.53h40.54c3.08,0,5.57-2.49,5.57-5.57V0H0"
                fill="#00ADD7"
                opacity={0.12}
              />
            </svg>
            {/* Revealed shape: clipped by progress */}
            <svg
              viewBox="0 0 69.16 80.69"
              width={logoW}
              height={logoH}
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
    </>
  );

  return createPortal(overlay, document.body);
}
