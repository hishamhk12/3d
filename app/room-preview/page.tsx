import { cookies } from "next/headers";
import Link from "next/link";
import { AnimatedLink } from "@/components/ui/AnimatedLink";
import { LOCALE_COOKIE_NAME, normalizeLocale } from "@/lib/i18n/config";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { ROOM_PREVIEW_ROUTES } from "@/lib/room-preview/constants";
import GlassBackground from "@/components/GlassBackground";
import { CompanyLogo } from "@/components/CompanyLogo";

export default async function RoomPreviewLandingPage() {
  const cookieStore = await cookies();
  const locale = normalizeLocale(cookieStore.get(LOCALE_COOKIE_NAME)?.value);
  const t = dictionaries[locale];

  return (
    <main className="relative min-h-screen overflow-hidden text-[#1d1d1f]">
      <GlassBackground />
      
      {/* Animated Comet (behind the frosted glass) */}
      <div 
        className="absolute z-0 rounded-full opacity-90 pointer-events-none"
        style={{
          top: "50%",
          left: "50%",
          width: "100vw",
          height: "100vw",
          maxWidth: "1000px",
          maxHeight: "1000px",
          background: "radial-gradient(ellipse at 30% 50%, rgba(0, 175, 215, 0.8) 0%, rgba(0, 175, 215, 0.4) 40%, transparent 70%)",
          filter: "blur(40px)",
          animation: "auraSpin 60s infinite ease-in-out",
          willChange: "transform"
        }}
      />

      <style>{`
        @keyframes auraSpin {
          0% { transform: translate(-50%, -50%) rotate(0deg) scale(1); }
          10% { transform: translate(-10%, -20%) rotate(36deg) scale(1.15); }
          20% { transform: translate(-80%, -10%) rotate(72deg) scale(0.9); }
          30% { transform: translate(-90%, -80%) rotate(108deg) scale(1.2); }
          40% { transform: translate(-20%, -90%) rotate(144deg) scale(0.85); }
          50% { transform: translate(-40%, -40%) rotate(180deg) scale(1.1); }
          60% { transform: translate(-80%, -60%) rotate(216deg) scale(0.95); }
          70% { transform: translate(-10%, -70%) rotate(252deg) scale(1.2); }
          80% { transform: translate(-30%, -10%) rotate(288deg) scale(0.8); }
          90% { transform: translate(-70%, -90%) rotate(324deg) scale(1.15); }
          100% { transform: translate(-50%, -50%) rotate(360deg) scale(1); }
        }

        .actome-button {
          position: relative;
          color: #1d1d1f;
          border-radius: 9999px;
          box-shadow: 
            0 20px 40px -10px rgba(0, 0, 0, 0.4), 
            0 0 40px 5px rgba(255, 140, 50, 0.5), 
            inset 0 1px 1px rgba(255, 255, 255, 1); 
          transition: all 0.3s cubic-bezier(0.25, 1, 0.5, 1);
          z-index: 1;
        }

        .actome-button::before {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: 9999px;
          background: linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(240,240,245,1) 100%);
          z-index: -1;
        }

        .actome-button:hover {
          box-shadow: 
            0 25px 50px -12px rgba(0, 0, 0, 0.5),
            0 0 50px 10px rgba(255, 150, 60, 0.6),
            inset 0 1px 1px rgba(255, 255, 255, 1);
        }

        .actome-button:active {
          box-shadow: 
            0 10px 20px -5px rgba(0, 0, 0, 0.3),
            0 0 20px 2px rgba(255, 140, 50, 0.4),
            inset 0 1px 1px rgba(255, 255, 255, 1);
        }

        .actome-button::after {
          content: "";
          position: absolute;
          inset: -4px;
          border-radius: 9999px;
          border: 2px solid rgba(255, 140, 50, 0.8);
          opacity: 0;
          transform: scale(0.95);
          pointer-events: none;
        }

        .actome-button:active::after {
          animation: actomePulse 0.5s ease-out;
        }

        @keyframes actomePulse {
          0% { transform: scale(0.95); opacity: 0.8; border-width: 4px; }
          100% { transform: scale(1.2); opacity: 0; border-width: 0px; }
        }
      `}</style>

      {/* Premium Frosted Glass Overlay */}
      <div className="absolute inset-0 z-0 bg-black/30 backdrop-blur-[60px] pointer-events-none" />

      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center gap-10 px-4">
        <AnimatedLink href="/" className="relative block h-24 w-48 transition-transform hover:scale-105 active:scale-95">
          <CompanyLogo className="h-full w-full object-contain text-white" />
        </AnimatedLink>

        <AnimatedLink
          href={ROOM_PREVIEW_ROUTES.screenLauncher}
          className="actome-button flex items-center justify-center text-center px-16 py-5 text-2xl font-bold"
          glowColor="rgba(255, 140, 50, 0.4)"
        >
          {t.roomPreview.landing.startButton}
        </AnimatedLink>
      </div>
    </main>
  );
}
