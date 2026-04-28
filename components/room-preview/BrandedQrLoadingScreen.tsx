type BrandedQrLoadingScreenProps = {
  description: string;
  dir: "ltr" | "rtl";
  title: string;
};

const B_MARK_PATH =
  "M0,0v80.69h69.16v-28.97c0-3.1-2.51-5.61-5.61-5.61H23.05v11.53h34.58v11.53H11.53V11.53h46.11v11.53H23.05v11.53h40.54c3.08,0,5.57-2.49,5.57-5.57V0H0";

export default function BrandedQrLoadingScreen({
  description,
  dir,
  title,
}: BrandedQrLoadingScreenProps) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#050707] text-white">
      <style>{`
        .qr-brand-mark {
          filter: drop-shadow(0 24px 44px rgba(0, 173, 215, 0.22));
          transform-origin: center;
          animation: qr-brand-breathe 4.8s ease-in-out infinite;
        }

        .qr-brand-flow {
          transform-box: fill-box;
          transform-origin: center;
          animation: qr-brand-flow 2.8s cubic-bezier(0.45, 0, 0.25, 1) infinite;
        }

        .qr-brand-line {
          animation: qr-brand-line 3.4s ease-in-out infinite;
        }

        .qr-brand-line:nth-child(2) {
          animation-delay: 0.42s;
        }

        .qr-brand-line:nth-child(3) {
          animation-delay: 0.84s;
        }

        .qr-brand-progress {
          animation: qr-brand-progress 2s cubic-bezier(0.35, 0, 0.2, 1) forwards;
        }

        @keyframes qr-brand-breathe {
          0%, 100% {
            filter: drop-shadow(0 22px 42px rgba(0, 173, 215, 0.18));
            transform: translateY(0) scale(1);
          }
          50% {
            filter: drop-shadow(0 30px 62px rgba(0, 173, 215, 0.34));
            transform: translateY(-2px) scale(1.015);
          }
        }

        @keyframes qr-brand-flow {
          0% { transform: translateX(-120px) rotate(18deg); opacity: 0; }
          18% { opacity: 1; }
          78% { opacity: 1; }
          100% { transform: translateX(92px) rotate(18deg); opacity: 0; }
        }

        @keyframes qr-brand-line {
          0%, 100% { transform: translateX(-14px); opacity: 0.15; }
          50% { transform: translateX(16px); opacity: 0.75; }
        }

        @keyframes qr-brand-progress {
          from { transform: scaleX(0); }
          to { transform: scaleX(1); }
        }

        @media (prefers-reduced-motion: reduce) {
          .qr-brand-mark,
          .qr-brand-flow,
          .qr-brand-line,
          .qr-brand-progress {
            animation: none !important;
          }

          .qr-brand-progress {
            transform: scaleX(1);
          }
        }
      `}</style>

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_32%,rgba(0,173,215,0.16),transparent_34%),linear-gradient(135deg,rgba(255,255,255,0.08),transparent_34%,rgba(0,173,215,0.08))]" />
      <div className="absolute inset-0 bg-black/45 backdrop-blur-[18px]" />

      <section className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <div className="relative flex h-40 w-40 items-center justify-center sm:h-48 sm:w-48">
          <div className="absolute inset-0 rounded-full bg-cyan-300/10 blur-3xl" />

          <svg
            aria-hidden="true"
            className="qr-brand-mark relative h-28 w-24 sm:h-36 sm:w-32"
            viewBox="0 0 69.16 80.69"
            role="img"
          >
            <defs>
              <clipPath id="qr-brand-b-mark">
                <path d={B_MARK_PATH} />
              </clipPath>
              <linearGradient id="qr-brand-sheen" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="rgba(255,255,255,0)" />
                <stop offset="42%" stopColor="rgba(255,255,255,0.12)" />
                <stop offset="52%" stopColor="rgba(255,255,255,0.9)" />
                <stop offset="62%" stopColor="rgba(255,255,255,0.16)" />
                <stop offset="100%" stopColor="rgba(255,255,255,0)" />
              </linearGradient>
            </defs>

            <path d={B_MARK_PATH} fill="#00add7" />
            <g clipPath="url(#qr-brand-b-mark)">
              <rect
                className="qr-brand-flow"
                x="-92"
                y="-18"
                width="70"
                height="124"
                fill="url(#qr-brand-sheen)"
              />
              <g className="qr-brand-line" opacity="0.55">
                <path d="M9 15h44" stroke="#ffffff" strokeLinecap="round" strokeWidth="1.1" />
                <path d="M10 66h43" stroke="#ffffff" strokeLinecap="round" strokeWidth="1.1" />
              </g>
              <g className="qr-brand-line" opacity="0.42">
                <path d="M18 29h41" stroke="#ffffff" strokeLinecap="round" strokeWidth="0.9" />
                <path d="M24 51h35" stroke="#ffffff" strokeLinecap="round" strokeWidth="0.9" />
              </g>
              <g className="qr-brand-line" opacity="0.34">
                <path d="M5 40h61" stroke="#eaffff" strokeLinecap="round" strokeWidth="0.7" />
              </g>
            </g>
          </svg>
        </div>

        <div className="mt-8 max-w-xl" dir={dir}>
          <p className="text-3xl font-bold tracking-tight text-white sm:text-4xl">{title}</p>
          <p className="mt-4 text-base leading-7 text-white/70 sm:text-lg">{description}</p>
        </div>

        <div className="mt-10 h-px w-64 overflow-hidden rounded-full bg-white/10">
          <div className="qr-brand-progress h-full w-full origin-left rounded-full bg-gradient-to-r from-transparent via-cyan-200 to-transparent" />
        </div>
      </section>
    </main>
  );
}
