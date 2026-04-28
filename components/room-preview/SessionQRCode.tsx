"use client";

import Image from "next/image";
import PhoneScanGuide from "@/components/room-preview/PhoneScanGuide";
import { useI18n } from "@/lib/i18n/provider";

type SessionQRCodeProps = {
  dataUrl: string;
};

/**
 * Renders a pre-generated QR code image.
 *
 * The data URL is produced server-side (in the parent Server Component) so
 * the QR code is embedded directly in the initial HTML — no client-side
 * async generation, no blank-box flash on load.
 */
export default function SessionQRCode({ dataUrl }: SessionQRCodeProps) {
  const { dir, t } = useI18n();

  return (
    <div className="qr-scan-guide-shell relative isolate flex w-full max-w-sm flex-col items-center">
      <style>{`
        .qr-scan-guide-shell {
          --qr-guide-accent: var(--accent, #00AFD7);
          padding-bottom: clamp(11rem, 36vw, 13.5rem);
        }

        .qr-scan-card {
          position: relative;
          isolation: isolate;
        }

        .qr-scan-card::after {
          content: "";
          position: absolute;
          inset: -2px;
          z-index: 2;
          pointer-events: none;
          border-radius: 1.65rem;
          border: 1px solid rgba(0, 175, 215, 0);
          box-shadow: 0 0 0 rgba(0, 175, 215, 0);
          opacity: 0;
          animation: qr-guide-card-glow 4.6s ease-in-out infinite;
        }

        .qr-phone-guide {
          position: absolute;
          right: clamp(0.75rem, 12vw, 3.25rem);
          bottom: 0.5rem;
          z-index: 3;
          width: clamp(5.75rem, 20vw, 7rem);
          aspect-ratio: 0.52;
          pointer-events: none;
          opacity: 0;
          transform: translate3d(0, 80px, 0) rotate(-1deg);
          transform-origin: 56% 95%;
          animation: qr-guide-phone-enter 4.6s cubic-bezier(0.16, 1, 0.3, 1) infinite;
        }

        .qr-phone-guide__beam {
          position: absolute;
          left: -78%;
          top: 36%;
          width: 86%;
          height: 1px;
          transform: rotate(-18deg);
          transform-origin: right center;
          background: linear-gradient(90deg, transparent, rgba(0, 175, 215, 0.42), transparent);
          opacity: 0.34;
          filter: drop-shadow(0 0 8px rgba(0, 175, 215, 0.24));
          animation: qr-guide-beam 4.6s ease-in-out infinite;
        }

        .qr-phone-guide__frame {
          position: relative;
          width: 100%;
          height: 100%;
          overflow: hidden;
          border-radius: 1.7rem;
          border: 1px solid rgba(255, 255, 255, 0.2);
          background:
            linear-gradient(155deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.04) 34%, rgba(0, 175, 215, 0.08)),
            rgba(8, 16, 22, 0.7);
          box-shadow:
            0 10px 28px rgba(0, 0, 0, 0.28),
            inset 0 1px 0 rgba(255, 255, 255, 0.18);
          backdrop-filter: blur(18px) saturate(150%);
          -webkit-backdrop-filter: blur(18px) saturate(150%);
        }

        .qr-phone-guide__frame::after {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(120deg, rgba(255, 255, 255, 0.16), transparent 36%);
          opacity: 0.42;
        }

        .qr-phone-guide__notch {
          position: absolute;
          top: 0.7rem;
          left: 50%;
          z-index: 2;
          width: 2.2rem;
          height: 0.36rem;
          transform: translateX(-50%);
          border-radius: 999px;
          background: rgba(4, 8, 12, 0.82);
          border: 1px solid rgba(255, 255, 255, 0.08);
        }

        .qr-phone-guide__notch span {
          position: absolute;
          right: -0.5rem;
          top: 50%;
          width: 0.25rem;
          height: 0.25rem;
          transform: translateY(-50%);
          border-radius: 999px;
          background: rgba(0, 175, 215, 0.55);
          box-shadow: 0 0 8px rgba(0, 175, 215, 0.32);
        }

        .qr-phone-guide__glass {
          position: absolute;
          inset: 1.35rem 0.55rem 0.7rem;
          z-index: 1;
          display: grid;
          place-items: center;
          border-radius: 1.05rem;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background:
            radial-gradient(circle at 50% 22%, rgba(0, 175, 215, 0.13), transparent 54%),
            rgba(255, 255, 255, 0.045);
        }

        .qr-phone-guide__scan-area {
          position: relative;
          width: 68%;
          aspect-ratio: 1;
          border-radius: 0.55rem;
          background: rgba(255, 255, 255, 0.035);
          overflow: hidden;
        }

        .qr-phone-guide__scan-area::before {
          content: "";
          position: absolute;
          inset: 20%;
          border-radius: 0.24rem;
          background:
            linear-gradient(90deg, rgba(255, 255, 255, 0.18) 22%, transparent 22% 40%, rgba(255, 255, 255, 0.16) 40% 58%, transparent 58%),
            linear-gradient(rgba(255, 255, 255, 0.12) 24%, transparent 24% 54%, rgba(255, 255, 255, 0.12) 54%);
          opacity: 0.24;
        }

        .qr-phone-guide__corner {
          position: absolute;
          width: 0.85rem;
          height: 0.85rem;
          color: color-mix(in srgb, var(--qr-guide-accent) 82%, white);
          opacity: 0.82;
        }

        .qr-phone-guide__corner--tl {
          top: 0;
          left: 0;
          border-top: 2px solid;
          border-left: 2px solid;
          border-top-left-radius: 0.45rem;
        }

        .qr-phone-guide__corner--tr {
          top: 0;
          right: 0;
          border-top: 2px solid;
          border-right: 2px solid;
          border-top-right-radius: 0.45rem;
        }

        .qr-phone-guide__corner--bl {
          bottom: 0;
          left: 0;
          border-bottom: 2px solid;
          border-left: 2px solid;
          border-bottom-left-radius: 0.45rem;
        }

        .qr-phone-guide__corner--br {
          right: 0;
          bottom: 0;
          border-right: 2px solid;
          border-bottom: 2px solid;
          border-bottom-right-radius: 0.45rem;
        }

        .qr-phone-guide__line {
          position: absolute;
          left: 0.35rem;
          right: 0.35rem;
          top: 18%;
          height: 2px;
          border-radius: 999px;
          background: linear-gradient(90deg, transparent, var(--qr-guide-accent), transparent);
          box-shadow: 0 0 12px rgba(0, 175, 215, 0.54);
          opacity: 0;
          animation: qr-guide-scan-line 4.6s ease-in-out infinite;
        }

        @keyframes qr-guide-phone-enter {
          0% {
            opacity: 0;
            transform: translate3d(0, 80px, 0) rotate(-1deg);
          }
          16%, 76% {
            opacity: 0.72;
            transform: translate3d(0, 0, 0) rotate(-2.4deg);
          }
          46% {
            opacity: 0.76;
            transform: translate3d(0, -3px, 0) rotate(-1.2deg);
          }
          100% {
            opacity: 0;
            transform: translate3d(0, 12px, 0) rotate(-2deg);
          }
        }

        @keyframes qr-guide-scan-line {
          0%, 14% {
            top: 18%;
            opacity: 0;
          }
          24% {
            opacity: 0.92;
          }
          62% {
            top: 82%;
            opacity: 0.84;
          }
          78%, 100% {
            top: 82%;
            opacity: 0;
          }
        }

        @keyframes qr-guide-card-glow {
          0%, 18%, 100% {
            border-color: rgba(0, 175, 215, 0);
            box-shadow: 0 0 0 rgba(0, 175, 215, 0);
            opacity: 0;
          }
          42% {
            border-color: rgba(0, 175, 215, 0.2);
            box-shadow: 0 0 28px rgba(0, 175, 215, 0.16);
            opacity: 1;
          }
          68% {
            border-color: rgba(0, 175, 215, 0.08);
            box-shadow: 0 0 16px rgba(0, 175, 215, 0.08);
            opacity: 0.55;
          }
        }

        @keyframes qr-guide-beam {
          0%, 18%, 100% {
            opacity: 0;
          }
          36%, 64% {
            opacity: 0.34;
          }
        }

        @media (min-width: 1024px) {
          .qr-scan-guide-shell {
            padding-bottom: 0;
          }

          .qr-phone-guide {
            right: clamp(-7.2rem, -8vw, -4.75rem);
            bottom: -3.15rem;
            width: clamp(6.35rem, 8.5vw, 8rem);
          }
        }

        @media (max-width: 640px) {
          .qr-scan-guide-shell {
            padding-bottom: 8.5rem;
          }

          .qr-phone-guide {
            right: 0.65rem;
            bottom: -2.5rem;
            width: 5.45rem;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .qr-scan-card::after,
          .qr-phone-guide,
          .qr-phone-guide__beam,
          .qr-phone-guide__line {
            animation: none !important;
          }

          .qr-phone-guide {
            opacity: 0.58;
            transform: translate3d(0, 0, 0) rotate(-1.5deg);
          }

          .qr-phone-guide__beam,
          .qr-phone-guide__line {
            opacity: 0.32;
          }
        }
      `}</style>

      <div className="qr-scan-card flex w-full flex-col items-center rounded-3xl border border-[var(--border)] bg-[var(--bg-surface)] p-8 shadow-[var(--shadow-xl)] backdrop-blur-xl animate-in fade-in zoom-in-95 duration-500">
        <div className="relative z-[1] flex aspect-square w-full items-center justify-center rounded-2xl bg-white p-4 shadow-lg">
          <Image
            src={dataUrl}
            alt={t.roomPreview.qr.alt}
            width={400}
            height={400}
            unoptimized
            className="aspect-square w-full rounded-xl"
          />
        </div>
        <div className="relative z-[1] mt-6 text-center" dir={dir}>
          <p className="text-lg font-bold text-[var(--text-primary)]">{t.roomPreview.qr.scanTitle}</p>
          <p className="mt-2 text-sm text-[var(--text-muted)]">{t.roomPreview.qr.scanDescription}</p>
        </div>
      </div>

      <PhoneScanGuide />
    </div>
  );
}
