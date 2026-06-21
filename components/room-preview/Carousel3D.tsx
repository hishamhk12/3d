"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import FadeContent from "@/components/reactbits/FadeContent";

// Destination of the «جربها في غرفتك الآن» CTA. Clicking it plays a ReactBits
// FadeContent transition first, then navigates here.
const TRY_NOW_TARGET = "/room-preview/screen?source=hero_try_button";

type Carousel3DProps = {
  images: string[];
};

/* ------------------------------------------------------------------ *
 * Portrait kiosk design board.
 * Everything is laid out in a fixed 1080 x 1920 (9:16) coordinate
 * space and then uniformly scaled to fit the real viewport, so the
 * visionOS-style composition stays pixel-exact and never overflows.
 * Scope: this component only. No global styles are touched.
 * ------------------------------------------------------------------ */
const BOARD_W = 1080;
const BOARD_H = 1920;

// Full-width, room-image-dominant coverflow. The card uses a taller 4:3 ratio
// (1080×810) so the active image fills the entire screen width AND uses the
// otherwise-empty vertical space. The board scale is 1.0 at 1080×1920, so these
// render 1:1 (verified by measuring the rendered bounding box). Source room
// photos are object-cover, center-cropped — a small side crop is accepted.
const CARD_W = 1080;
const CARD_H = (CARD_W * 3) / 4; // 4:3 — taller, fills the vertical space (810)
const CARD_RADIUS = 32;

const COVER_CENTER_Y = Math.round(BOARD_H * 0.36); // 691 — vertical center kept.
const TRACK_TOP = COVER_CENTER_Y - CARD_H / 2;
const PERSPECTIVE = 1450;

const VISIBLE_RANGE = 2;
const AUTOPLAY_MS = 5000;

// Shorter reflection so the now-taller card's mirror stays clear of the controls.
const REFLECTION_H = Math.round(CARD_H * 0.28);

// Every card keeps the SAME base size (CARD_W × CARD_H) at every position —
// scale is always 1, so a card never shrinks when it moves to the center and
// never grows when it moves to a side. Depth comes only from translateX,
// rotateY, opacity, brightness, blur and z-index.
const CFG = [
  { x: 0, rotateY: 0, scale: 1, opacity: 1, blur: 0, brightness: 1 },
  { x: 205, rotateY: 32, scale: 1, opacity: 1, blur: 0.5, brightness: 1 },
  { x: 370, rotateY: 48, scale: 1, opacity: 0.97, blur: 1.8, brightness: 0.86 },
] as const;

// Approved mobile button language (from the QR gate role screen):
// charcoal pill, white bold text, 32px radius, soft shadow, active press.
const PILL_CHARCOAL = "#192126";
const PILL_SHADOW = "0 12px 30px rgba(25,33,38,0.34)";

export function Carousel3D({ images }: Carousel3DProps) {
  const router = useRouter();
  const [active, setActive] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [scale, setScale] = useState(1);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const prefersReduced = useReducedMotion();
  const hasImages = images.length > 0;

  // Warm the destination route so navigation after the fade is instant.
  useEffect(() => {
    router.prefetch(TRY_NOW_TARGET);
  }, [router]);

  // CTA click → start the FadeContent transition (suppress the native <Link>
  // navigation); FadeContent's onComplete performs the actual navigation.
  const startTryNowTransition = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      setIsTransitioning(true);
    },
    [],
  );

  // Uniformly scale the fixed 1080x1920 board to fit the portrait viewport.
  useEffect(() => {
    const compute = () => {
      const s = Math.min(
        window.innerWidth / BOARD_W,
        window.innerHeight / BOARD_H,
      );
      setScale(s > 0 ? s : 1);
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);

  useEffect(() => {
    setActive(0);
  }, [images]);

  const advance = useCallback(() => {
    if (!hasImages) return;
    setActive((i) => (i + 1) % images.length);
  }, [hasImages, images.length]);

  const goPrev = useCallback(() => {
    if (!hasImages) return;
    setActive((i) => (i - 1 + images.length) % images.length);
  }, [hasImages, images.length]);

  useEffect(() => {
    if (!hasImages || isPaused) return;
    const id = setInterval(advance, AUTOPLAY_MS);
    return () => clearInterval(id);
  }, [advance, hasImages, isPaused]);

  // Preload room images so coverflow transitions are instant.
  useEffect(() => {
    if (!hasImages) return;
    images.forEach((src) => {
      const img = new window.Image();
      img.src = src;
    });
  }, [hasImages, images]);

  const resolveOffset = (i: number) => {
    let off = i - active;
    const half = Math.floor(images.length / 2);
    if (off > half) off -= images.length;
    if (off < -half) off += images.length;
    return off;
  };

  const getAnimate = (offset: number) => {
    const abs = Math.abs(offset);
    const sign = Math.sign(offset) || 1;
    const cfg = CFG[abs];

    return {
      x: sign * cfg.x,
      rotateY: sign * -cfg.rotateY,
      scale: cfg.scale,
      opacity: cfg.opacity,
      filter:
        abs > 0
          ? `blur(${cfg.blur}px) brightness(${cfg.brightness})`
          : "blur(0px) brightness(1)",
    };
  };

  return (
    <section
      aria-label="معرض الأرضيات"
      dir="rtl"
      style={{
        position: "relative",
        width: "100%",
        height: "100dvh",
        minHeight: "100dvh",
        overflow: "hidden",
        background: "#0a1020",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <style>{`
        @keyframes c3dChevron {
          0%,100% { transform:translateX(-50%) translateY(0);    opacity:.55; }
          50%      { transform:translateX(-50%) translateY(7px);  opacity:.9; }
        }
        @media (prefers-reduced-motion:reduce) { .c3d-chevron { animation:none !important; } }
        .c3d-pill { transition: transform .18s ease, background .18s ease, box-shadow .18s ease; }
        .c3d-pill:active { transform: scale(0.97); }
        .c3d-pill:focus-visible { outline: none; box-shadow: 0 0 0 4px rgba(255,255,255,0.55), ${PILL_SHADOW}; }
        .c3d-cta:active { transform: translateX(-50%) scale(0.98); }
        .c3d-cta:focus-visible { outline: none; box-shadow: 0 0 0 4px rgba(255,255,255,0.6), ${PILL_SHADOW}; }
      `}</style>

      {/* ---- Full-bleed fixed "private" background ---- */}
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, zIndex: 0 }}>
        <Image
          src="/room-preview/private.jpg"
          alt=""
          fill
          priority
          unoptimized
          sizes="100vw"
          style={{ objectFit: "cover", objectPosition: "center" }}
        />
      </div>
      {/* Minimal readability overlay */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, rgba(10,16,28,0.34) 0%, rgba(10,16,28,0.20) 34%, rgba(10,16,28,0.30) 64%, rgba(10,16,28,0.58) 100%)",
          zIndex: 1,
        }}
      />

      {/* ---- Fixed 1080x1920 design board, uniformly scaled to fit ---- */}
      <div
        style={{
          position: "relative",
          width: BOARD_W,
          height: BOARD_H,
          flexShrink: 0,
          transform: `scale(${scale})`,
          transformOrigin: "center center",
          zIndex: 2,
        }}
      >
        {!hasImages ? (
          <p
            style={{
              position: "absolute",
              top: COVER_CENTER_Y,
              left: 0,
              right: 0,
              transform: "translateY(-50%)",
              textAlign: "center",
              color: "rgba(255,255,255,0.85)",
              fontFamily: "var(--font-tajawal), sans-serif",
              fontSize: 32,
            }}
          >
            لا توجد صور غرف للعرض حالياً
          </p>
        ) : null}

        {/* ---- Coverflow band ---- */}
        <div
          role="region"
          aria-roledescription="carousel"
          style={{
            position: "absolute",
            top: TRACK_TOP,
            left: 0,
            width: "100%",
            height: CARD_H,
            perspective: `${PERSPECTIVE}px`,
            perspectiveOrigin: "50% 50%",
            zIndex: 10,
          }}
        >
          {/* soft floor shadow under the active card */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: "50%",
              top: CARD_H - 26,
              width: CARD_W * 0.86,
              height: 100,
              transform: "translateX(-50%)",
              background:
                "radial-gradient(ellipse at center, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.26) 45%, transparent 72%)",
              filter: "blur(28px)",
              zIndex: 0,
            }}
          />

          {hasImages
            ? images.map((src, i) => {
                const offset = resolveOffset(i);
                if (Math.abs(offset) > VISIBLE_RANGE) return null;
                const isActive = offset === 0;

                return (
                  <motion.div
                    key={src}
                    animate={getAnimate(offset)}
                    transition={
                      prefersReduced
                        ? { duration: 0 }
                        : { duration: 0.85, ease: [0.25, 0.46, 0.45, 0.94] }
                    }
                    onClick={() => !isActive && setActive(i)}
                    aria-label={
                      isActive
                        ? `الصورة ${i + 1} نشطة`
                        : `انتقل إلى الصورة ${i + 1}`
                    }
                    aria-current={isActive ? "true" : undefined}
                    style={{
                      position: "absolute",
                      width: CARD_W,
                      height: CARD_H,
                      left: `calc(50% - ${CARD_W / 2}px)`,
                      top: 0,
                      cursor: isActive ? "default" : "pointer",
                      zIndex: 10 - Math.abs(offset),
                      transformStyle: "preserve-3d",
                      willChange: "transform, opacity, filter",
                    }}
                  >
                    {/* card face (rounded, clipped) */}
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        borderRadius: CARD_RADIUS,
                        overflow: "hidden",
                        boxShadow: isActive
                          ? "0 44px 100px rgba(0,0,0,0.62), 0 0 0 1px rgba(255,255,255,0.12)"
                          : "0 28px 64px rgba(0,0,0,0.5)",
                      }}
                    >
                      <Image
                        src={src}
                        alt={`أرضية ${i + 1}`}
                        fill
                        unoptimized
                        sizes="1080px"
                        style={{
                          objectFit: "cover",
                          objectPosition: "center",
                          pointerEvents: "none",
                          userSelect: "none",
                        }}
                        draggable={false}
                        priority={isActive}
                      />
                      {isActive ? (
                        <div
                          aria-hidden="true"
                          style={{
                            position: "absolute",
                            inset: 0,
                            borderRadius: CARD_RADIUS,
                            border: "1px solid rgba(255,255,255,0.18)",
                            background:
                              "linear-gradient(to bottom, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.03) 22%, transparent 45%)",
                            pointerEvents: "none",
                          }}
                        />
                      ) : null}
                    </div>

                    {/* mirrored reflection */}
                    <div
                      aria-hidden="true"
                      style={{
                        position: "absolute",
                        left: 0,
                        top: CARD_H + 8,
                        width: CARD_W,
                        height: REFLECTION_H,
                        borderRadius: CARD_RADIUS,
                        overflow: "hidden",
                        transform: "scaleY(-1)",
                        opacity: isActive ? 0.32 : 0.16,
                        filter: "blur(4px)",
                        WebkitMaskImage:
                          "linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 78%)",
                        maskImage:
                          "linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 78%)",
                        pointerEvents: "none",
                      }}
                    >
                      <Image
                        src={src}
                        alt=""
                        fill
                        unoptimized
                        sizes="1080px"
                        style={{ objectFit: "cover", objectPosition: "top" }}
                        draggable={false}
                      />
                    </div>
                  </motion.div>
                );
              })
            : null}
        </div>

        {/* ---- Large transport controls (approved mobile pill family) ----
            Row is RTL: the first child renders rightmost, so source order is
            [التالي, إيقاف/تشغيل, السابق] to produce the required visual
            left→right order: السابق → play/pause → التالي. Each button is
            the row is RTL, so within each button the first child renders
            rightmost — children are ordered to give:
              • التالي (right):  label then ► right arrow  → advance
              • السابق (left):   ◄ left arrow then label  → goPrev
            Handlers stay bound to their own visible label. */}
        {hasImages ? (
          <div
            dir="rtl"
            style={{
              position: "absolute",
              top: Math.round(BOARD_H * 0.72),
              left: 0,
              right: 0,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gap: 22,
              zIndex: 12,
            }}
          >
            <PillControl label="التالي" onClick={advance}>
              <ChevronIcon point="right" />
              <span>التالي</span>
            </PillControl>
            <PillControl
              label={isPaused ? "تشغيل العرض التلقائي" : "إيقاف العرض التلقائي"}
              onClick={() => setIsPaused((p) => !p)}
            >
              {isPaused ? <PlayIcon /> : <PauseIcon />}
              <span>{isPaused ? "تشغيل" : "إيقاف"}</span>
            </PillControl>
            <PillControl label="السابق" onClick={goPrev}>
              <span>السابق</span>
              <ChevronIcon point="left" />
            </PillControl>
          </div>
        ) : null}

        {/* ---- Main CTA (large mobile-style pill) ---- */}
        <Link
          href={TRY_NOW_TARGET}
          onClick={startTryNowTransition}
          aria-disabled={isTransitioning}
          aria-label="ابدأ التجربة"
          className="c3d-cta c3d-chevron"
          style={{
            position: "absolute",
            top: Math.round(BOARD_H * 0.86),
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 12,
            width: 700,
            height: 104,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            borderRadius: 52,
            background: PILL_CHARCOAL,
            color: "#fff",
            textDecoration: "none",
            boxShadow: PILL_SHADOW,
            fontFamily: "var(--font-tajawal), sans-serif",
            fontWeight: 700,
            fontSize: 38,
            letterSpacing: "0.01em",
            transition: "transform .18s ease, box-shadow .18s ease",
          }}
        >
          <span style={{ whiteSpace: "nowrap" }}>جربها في غرفتك الآن</span>
          <svg
            width="34"
            height="34"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ opacity: 0.85 }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </Link>
      </div>

      {/* ---- ReactBits FadeContent transition overlay ----
          Mounted on CTA click. It fades a full-screen veil (matching the
          destination's background) in over the carousel, then navigates on
          completion — so the move into the QR/logo screen reads as one smooth
          cross-fade. */}
      {isTransitioning ? (
        <FadeContent
          duration={600}
          initialOpacity={0}
          threshold={0}
          onComplete={() => router.push(TRY_NOW_TARGET)}
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 50,
            pointerEvents: "none",
          }}
        >
          <div style={{ position: "absolute", inset: 0 }}>
            <Image
              src="/room-preview/private.jpg"
              alt=""
              fill
              priority
              unoptimized
              sizes="100vw"
              style={{ objectFit: "cover", objectPosition: "center" }}
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "linear-gradient(180deg, rgba(6,12,22,0.28) 0%, rgba(6,12,22,0.14) 40%, rgba(6,12,22,0.30) 100%)",
              }}
            />
          </div>
        </FadeContent>
      ) : null}
    </section>
  );
}

function PillControl({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="c3d-pill"
      style={{
        height: 84,
        minWidth: 200,
        padding: "0 34px",
        borderRadius: 32,
        border: "none",
        background: PILL_CHARCOAL,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        cursor: "pointer",
        boxShadow: PILL_SHADOW,
        fontFamily: "var(--font-tajawal), sans-serif",
        fontWeight: 700,
        fontSize: 30,
      }}
    >
      {children}
    </button>
  );
}

function ChevronIcon({ point }: { point: "left" | "right" }) {
  // "left" = ◄ (toward السابق on the left), "right" = ► (toward التالي on the right).
  const points = point === "right" ? "9 6 15 12 9 18" : "15 6 9 12 15 18";
  return (
    <svg
      width="34"
      height="34"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points={points} />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}
