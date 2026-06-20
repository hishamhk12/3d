"use client";

import { useId } from "react";
import { ImageIcon, Upload } from "lucide-react";

export type RoomUploadStatusState = "idle" | "uploading" | "success" | "error";

const BRAND_LOGO_VIEW_BOX = "0 0 82.4 103.8";
const BRAND_LOGO_BLUE_PATH =
  "M6.7,10.5v80.7h69.2v-29c0-3.1-2.5-5.6-5.6-5.6H29.7v11.5h34.6v11.5H18.2V22.1h46.1v11.5H29.7v11.5h40.5c3.1,0,5.6-2.5,5.6-5.6v-29H6.7";
const BRAND_LOGO_BLUE_FILL = "#00ADD7";

const LOGO_PIECES = [
  { id: "top", x: 0, y: 0, width: 82.4, height: 33.6 },
  { id: "middle", x: 0, y: 33.6, width: 82.4, height: 23 },
  { id: "left", x: 0, y: 56.6, width: 41.2, height: 23 },
  { id: "right", x: 41.2, y: 56.6, width: 41.2, height: 23 },
  { id: "bottom", x: 0, y: 79.6, width: 82.4, height: 24.2 },
] as const;

const STATUS_LABELS: Record<Exclude<RoomUploadStatusState, "idle">, string> = {
  uploading: "جاري رفع صورة الغرفة...",
  success: "تم رفع الصورة بنجاح",
  error: "تعذّر رفع الصورة",
};

function UploadBrandLogo({ state }: { state: Exclude<RoomUploadStatusState, "idle"> }) {
  const clipId = useId().replace(/:/g, "");
  const assembled = state === "success";

  return (
    <svg
      viewBox={BRAND_LOGO_VIEW_BOX}
      role="img"
      aria-label="شعار بيت الإباء"
      data-room-upload-logo-state={state}
      data-room-upload-logo-assembled={assembled ? "true" : "false"}
      className={[
        "rul-logo block w-[76px] overflow-visible",
        state === "uploading" ? "rul-logo-uploading" : "",
        state === "success" ? "rul-logo-success" : "",
        state === "error" ? "rul-logo-error" : "",
      ].join(" ")}
    >
      <defs>
        {LOGO_PIECES.map((piece) => (
          <clipPath key={piece.id} id={`${clipId}-rul-${piece.id}`}>
            <rect x={piece.x} y={piece.y} width={piece.width} height={piece.height} />
          </clipPath>
        ))}
      </defs>
      <g className="rul-piece-set" data-room-upload-logo-groups={LOGO_PIECES.length}>
        {LOGO_PIECES.map((piece) => (
          <g
            key={piece.id}
            className={`rul-piece rul-piece-${piece.id}`}
            clipPath={`url(#${clipId}-rul-${piece.id})`}
            data-room-upload-logo-piece={piece.id}
          >
            <path d={BRAND_LOGO_BLUE_PATH} fill={BRAND_LOGO_BLUE_FILL} />
          </g>
        ))}
      </g>
    </svg>
  );
}

export function RoomUploadStatus({
  state,
  errorMessage,
  onRetry,
}: {
  state: RoomUploadStatusState;
  errorMessage?: string | null;
  onRetry?: () => void;
}) {
  if (state === "idle") {
    return (
      <>
        <div className="relative flex items-center justify-center">
          <div className="relative">
            <div className="flex h-[64px] w-[56px] items-center justify-center rounded-[12px] border border-[var(--border-strong)] bg-[var(--bg-surface-2)]">
              <ImageIcon className="size-6 text-[var(--text-muted)]" strokeWidth={1.75} />
            </div>
            <div className="absolute -bottom-2.5 -left-2.5 flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-[#003C71] to-[#00AFD7] shadow-[0_6px_18px_rgba(0,175,215,0.35)]">
              <Upload className="size-4 text-white" strokeWidth={2.25} />
            </div>
          </div>
        </div>
        <span className="text-xs font-medium tracking-wide text-[var(--text-muted)]">JPG أو PNG</span>
      </>
    );
  }

  return (
    <div className="flex min-h-[120px] w-full flex-col items-center justify-center gap-3 text-center">
      <span
        className={[
          "relative grid h-24 w-24 place-items-center rounded-full border bg-white/90 shadow-[0_14px_38px_rgba(0,58,125,0.12)]",
          state === "error"
            ? "border-[#DC2626]/30"
            : state === "success"
              ? "border-[#6CC24A]/35"
              : "border-[#00AFD7]/35",
        ].join(" ")}
      >
        <span
          className={[
            "rul-signal absolute inset-[-8px] rounded-full",
            state === "uploading" ? "rul-signal-uploading border border-[#00AFD7]/40" : "",
            state === "success" ? "rul-signal-success border border-[#6CC24A]/40" : "",
            state === "error" ? "rul-signal-error border border-[#DC2626]/35" : "",
          ].join(" ")}
        />
        <UploadBrandLogo state={state} />
      </span>

      {state === "uploading" ? (
        <span className="text-sm font-semibold text-[#003A7D]">{STATUS_LABELS.uploading}</span>
      ) : null}

      {state === "success" ? (
        <span className="text-sm font-semibold text-[#246B1F]">{STATUS_LABELS.success}</span>
      ) : null}

      {state === "error" ? (
        <div className="flex w-full flex-col items-center gap-3">
          <span className="text-sm font-semibold text-[#DC2626]">{STATUS_LABELS.error}</span>
          {errorMessage ? (
            <span className="max-w-[240px] text-xs leading-5 text-[var(--text-muted)]">{errorMessage}</span>
          ) : null}
          <button
            type="button"
            onClick={onRetry}
            className="min-h-10 rounded-[32px] bg-[#192126] px-5 text-sm font-bold text-white shadow-[0_10px_24px_rgba(25,33,38,0.22)] transition hover:bg-[#10171B] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#192126]/45 focus-visible:ring-offset-2"
          >
            إعادة المحاولة
          </button>
        </div>
      ) : null}

      <RoomUploadStatusStyles />
    </div>
  );
}

export function RoomUploadStatusStyles() {
  return (
    <style>{`
      .rul-logo,
      .rul-piece-set,
      .rul-piece {
        transform-box: fill-box;
        transform-origin: center;
      }
      .rul-piece {
        transition: transform 420ms ease, opacity 240ms ease;
      }
      .rul-logo-uploading .rul-piece-top { animation: rulAttemptTop 1.4s ease-in-out infinite; }
      .rul-logo-uploading .rul-piece-middle { animation: rulAttemptMiddle 1.4s ease-in-out infinite; }
      .rul-logo-uploading .rul-piece-left { animation: rulAttemptLeft 1.4s ease-in-out infinite; }
      .rul-logo-uploading .rul-piece-right { animation: rulAttemptRight 1.4s ease-in-out infinite; }
      .rul-logo-uploading .rul-piece-bottom { animation: rulAttemptBottom 1.4s ease-in-out infinite; }
      .rul-logo-success .rul-piece,
      .rul-logo-success .rul-piece-set {
        transform: translate(0, 0) rotate(0) scale(1) !important;
        opacity: 1 !important;
      }
      .rul-logo-success .rul-piece-set {
        animation: rulSuccessPulse 900ms ease-out 1;
      }
      .rul-logo-error .rul-piece-set {
        animation: rulShortShake 420ms ease-out 1;
      }
      .rul-logo-error .rul-piece-top { transform: translate(-7px, -6px) rotate(-10deg); }
      .rul-logo-error .rul-piece-middle { transform: translate(7px, 2px) rotate(6deg); }
      .rul-logo-error .rul-piece-left { transform: translate(-9px, 7px) rotate(-8deg); }
      .rul-logo-error .rul-piece-right { transform: translate(10px, 5px) rotate(8deg); }
      .rul-logo-error .rul-piece-bottom { transform: translateY(9px) rotate(1deg); }
      .rul-signal-uploading { animation: rulAssemblySignal 1.2s ease-in-out infinite; border-style: dashed; }
      .rul-signal-success { animation: rulCheckSignal 1.2s ease-out both; }
      .rul-signal-error { animation: rulErrorSignal 0.9s ease-in-out infinite; }
      @keyframes rulAttemptTop {
        0%, 100% { transform: translate(-5px, -5px) rotate(-6deg); }
        55% { transform: translate(0, 0) rotate(0); }
        75% { transform: translate(2px, -3px) rotate(3deg); }
      }
      @keyframes rulAttemptMiddle {
        0%, 100% { transform: translate(5px, 2px) rotate(5deg); }
        55% { transform: translate(0, 0) rotate(0); }
        75% { transform: translate(-3px, 2px) rotate(-2deg); }
      }
      @keyframes rulAttemptLeft {
        0%, 100% { transform: translate(-8px, 5px) rotate(-8deg); }
        55% { transform: translate(0, 0) rotate(0); }
        75% { transform: translate(-2px, 4px) rotate(-3deg); }
      }
      @keyframes rulAttemptRight {
        0%, 100% { transform: translate(8px, 5px) rotate(8deg); }
        55% { transform: translate(0, 0) rotate(0); }
        75% { transform: translate(3px, 4px) rotate(3deg); }
      }
      @keyframes rulAttemptBottom {
        0%, 100% { transform: translateY(7px); }
        55% { transform: translate(0, 0); }
        75% { transform: translateY(4px); }
      }
      @keyframes rulSuccessPulse {
        0% { transform: scale(.94); }
        55% { transform: scale(1.06); }
        100% { transform: scale(1); }
      }
      @keyframes rulShortShake {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-2px); }
        50% { transform: translateX(2px); }
        75% { transform: translateX(-1px); }
      }
      @keyframes rulAssemblySignal {
        0%, 100% { transform: rotate(0); opacity: .45; }
        50% { transform: rotate(12deg); opacity: .75; }
      }
      @keyframes rulCheckSignal {
        0% { transform: scale(.65); opacity: 0; }
        100% { transform: scale(1.18); opacity: .42; }
      }
      @keyframes rulErrorSignal {
        0%, 100% { transform: scale(.98); opacity: .5; }
        50% { transform: scale(1.16); opacity: .8; }
      }
      @media (prefers-reduced-motion: reduce) {
        .rul-logo *,
        .rul-logo *::before,
        .rul-logo *::after,
        .rul-signal {
          animation-duration: 0.001ms !important;
          animation-iteration-count: 1 !important;
          transition-duration: 0.001ms !important;
        }
      }
    `}</style>
  );
}
