"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  motion,
  useReducedMotion,
  useMotionValue,
  useMotionTemplate,
  animate,
} from "framer-motion";

/* ─── Image paths ────────────────────────────────────────────────────────── */

function encodeAssetPath(p: string) {
  return "/" + p.split("/").map(encodeURIComponent).join("/");
}

const IMAGES = [
  // باركيه — 6 صور
  "صور ارضيات/باركيه/279b-roble-eyre-gris-xl-4v-room (1).jpg",
  "صور ارضيات/باركيه/283b-roble-selena-sable-su-4v-room (1).jpg",
  "صور ارضيات/باركيه/322b-roble-magari-or-4v-room_V2.jpg",
  "صور ارضيات/باركيه/343b-roble-fado-brisa-ev-4v-room.jpg",
  "صور ارضيات/باركيه/353b-roble-sonata-or-4v-room.jpg",
  "صور ارضيات/باركيه/369b-roble-vera-siglo-xl-4v-room-2.jpg",
  // كاربيت — 5 صور
  "صور ارضيات/كاربيت/10.jpg",
  "صور ارضيات/كاربيت/FN9-3-1.jpg",
  "صور ارضيات/كاربيت/FN9-3-fn9-4.png",
  "صور ارضيات/كاربيت/Haze LP 850_1.jpg.webp",
  "صور ارضيات/كاربيت/Interior_Etch 901_Etch Gradient 901_Core 901.jpg.webp",
].map(encodeAssetPath);

/* ─── Dominant-color extractor (canvas, same-origin) ────────────────────── */

function extractColor(src: string): Promise<[number, number, number]> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 24;
        canvas.height = 24;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve([40, 28, 18]);

        // Sample the lower-center region — where flooring is most prominent
        const sx = img.naturalWidth  * 0.20;
        const sy = img.naturalHeight * 0.45;
        const sw = img.naturalWidth  * 0.60;
        const sh = img.naturalHeight * 0.50;
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 24, 24);

        const { data } = ctx.getImageData(0, 0, 24, 24);
        let r = 0, g = 0, b = 0;
        const n = data.length / 4;
        for (let i = 0; i < data.length; i += 4) {
          r += data[i]; g += data[i + 1]; b += data[i + 2];
        }
        resolve([Math.round(r / n), Math.round(g / n), Math.round(b / n)]);
      } catch {
        resolve([40, 28, 18]);
      }
    };
    img.onerror = () => resolve([40, 28, 18]);
    img.src = src;
  });
}

/* ─── Coverflow constants ────────────────────────────────────────────────── */

const VISIBLE_RANGE = 2;
const AUTOPLAY_MS   = 5000;

// Per-offset visual properties (index = |offset|)
const CFG = [
  { rotateY: 0,  scale: 1.00, opacity: 1.00, blur: 0,   brightness: 1.00 },
  { rotateY: 42, scale: 0.80, opacity: 0.72, blur: 1.5, brightness: 0.72 },
  { rotateY: 58, scale: 0.62, opacity: 0.35, blur: 3.0, brightness: 0.50 },
] as const;

/* ─── Component ─────────────────────────────────────────────────────────── */

export function Carousel3D() {
  const [active,   setActive]   = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [cardW,    setCardW]    = useState(820);   // responsive, see effect below
  const prefersReduced = useReducedMotion();

  /* Ambient background: animated R, G, B channels */
  const ambR = useMotionValue(40);
  const ambG = useMotionValue(28);
  const ambB = useMotionValue(18);

  /* Compose animated gradient string for the ambient glow */
  const ambientBg = useMotionTemplate`radial-gradient(
    ellipse 140% 75% at 50% 105%,
    rgba(${ambR},${ambG},${ambB},0.55) 0%,
    rgba(${ambR},${ambG},${ambB},0.18) 40%,
    transparent 68%
  )`;

  /* ── Responsive card width: 62 vw, clamped 300 – 820 px ─────────────── */
  useEffect(() => {
    const compute = () =>
      setCardW(Math.min(820, Math.max(300, window.innerWidth * 0.62)));
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);

  const cardH  = Math.round(cardW * (2 / 3));
  const xStep1 = Math.round(cardW * 0.62);   // spread for |offset| = 1
  const xStep2 = Math.round(cardW * 1.08);   // spread for |offset| = 2

  /* ── Extract dominant color whenever active slide changes ────────────── */
  useEffect(() => {
    extractColor(IMAGES[active]).then(([r, g, b]) => {
      const dur = { duration: 1.4, ease: "easeOut" } as const;
      animate(ambR, r, dur);
      animate(ambG, g, dur);
      animate(ambB, b, dur);
    });
  }, [active, ambR, ambG, ambB]);

  /* ── Autoplay ────────────────────────────────────────────────────────── */
  const advance = useCallback(
    () => setActive((i) => (i + 1) % IMAGES.length),
    [],
  );
  useEffect(() => {
    if (isPaused) return;
    const id = setInterval(advance, AUTOPLAY_MS);
    return () => clearInterval(id);
  }, [advance, isPaused]);

  /* ── Preload images ──────────────────────────────────────────────────── */
  useEffect(() => {
    IMAGES.forEach((src) => {
      const img = new window.Image();
      img.src = src;
    });
    // Extract color for the very first image
    extractColor(IMAGES[0]).then(([r, g, b]) => {
      ambR.set(r); ambG.set(g); ambB.set(b);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Circular offset (shortest path) ────────────────────────────────── */
  const resolveOffset = (i: number) => {
    let off  = i - active;
    const half = Math.floor(IMAGES.length / 2);
    if (off >  half) off -= IMAGES.length;
    if (off < -half) off += IMAGES.length;
    return off;
  };

  /* ── Per-card Framer Motion animate target ───────────────────────────── */
  const getAnimate = (offset: number) => {
    const abs  = Math.abs(offset);
    const sign = Math.sign(offset) || 1;
    const cfg  = CFG[abs];
    const xArr = [0, xStep1, xStep2];
    return {
      x:       sign * (xArr[abs] ?? 0),
      rotateY: sign * -cfg.rotateY,
      scale:   cfg.scale,
      opacity: cfg.opacity,
      filter:  abs > 0
        ? `blur(${cfg.blur}px) brightness(${cfg.brightness})`
        : "blur(0px) brightness(1)",
    };
  };

  /* ── Render ──────────────────────────────────────────────────────────── */
  return (
    <section
      aria-label="معرض الأرضيات"
      style={{
        position:       "relative",
        width:          "100%",
        height:         "100dvh",
        minHeight:      "100vh",
        overflow:       "hidden",
        background:     "#0d1b35",
        display:        "flex",
        flexDirection:  "column",
        alignItems:     "center",
        justifyContent: "center",
      }}
    >
      <style>{`
        @keyframes c3dChevron {
          0%,100% { transform:translateX(-50%) translateY(0);    opacity:.35; }
          50%      { transform:translateX(-50%) translateY(10px); opacity:.70; }
        }
        @media (prefers-reduced-motion:reduce) { .c3d-chevron { animation:none !important; } }
      `}</style>

      {/* ── Ambient color glow ─────────────────────────────────────────── */}
      <motion.div
        aria-hidden="true"
        style={{
          position:       "absolute",
          inset:          0,
          background:     ambientBg,
          zIndex:         1,
          pointerEvents:  "none",
        }}
      />

      {/* ── Fog / mist layers ──────────────────────────────────────────── */}
      {/* وسط الشاشة — ضباب رئيسي */}
      <div
        aria-hidden="true"
        style={{
          position:      "absolute",
          top:           "15%",
          left:          "50%",
          transform:     "translateX(-50%)",
          width:         "80vw",
          height:        "60vh",
          borderRadius:  "50%",
          background:    "radial-gradient(ellipse at center, rgba(180,200,240,0.07) 0%, transparent 70%)",
          filter:        "blur(40px)",
          pointerEvents: "none",
          zIndex:        2,
        }}
      />
      {/* أسفل يسار — طبقة ثانية */}
      <div
        aria-hidden="true"
        style={{
          position:      "absolute",
          bottom:        "10%",
          left:          "10%",
          width:         "45vw",
          height:        "35vh",
          borderRadius:  "50%",
          background:    "radial-gradient(ellipse at center, rgba(150,180,230,0.05) 0%, transparent 70%)",
          filter:        "blur(50px)",
          pointerEvents: "none",
          zIndex:        2,
        }}
      />
      {/* أعلى يمين — طبقة ثالثة */}
      <div
        aria-hidden="true"
        style={{
          position:      "absolute",
          top:           "5%",
          right:         "8%",
          width:         "35vw",
          height:        "30vh",
          borderRadius:  "50%",
          background:    "radial-gradient(ellipse at center, rgba(160,190,235,0.04) 0%, transparent 70%)",
          filter:        "blur(45px)",
          pointerEvents: "none",
          zIndex:        2,
        }}
      />

      {/* ── 3D Carousel track ──────────────────────────────────────────── */}
      <div
        role="region"
        aria-roledescription="carousel"
        style={{
          position:          "relative",
          width:             "100%",
          height:            cardH,
          perspective:       "1400px",
          perspectiveOrigin: "50% 50%",
          flexShrink:        0,
          zIndex:            10,
        }}
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
      >
        {IMAGES.map((src, i) => {
          const offset   = resolveOffset(i);
          if (Math.abs(offset) > VISIBLE_RANGE) return null;
          const isActive = offset === 0;

          return (
            <motion.div
              key={i}
              animate={getAnimate(offset)}
              transition={
                prefersReduced
                  ? { duration: 0 }
                  : { duration: 0.85, ease: [0.25, 0.46, 0.45, 0.94] }
              }
              onClick={() => !isActive && setActive(i)}
              aria-label={isActive ? `الصورة ${i + 1} — نشطة` : `انتقل إلى الصورة ${i + 1}`}
              aria-current={isActive ? "true" : undefined}
              style={{
                position:     "absolute",
                width:        cardW,
                height:       cardH,
                left:         `calc(50% - ${cardW / 2}px)`,
                top:          0,
                borderRadius: 24,
                overflow:     "hidden",
                cursor:       isActive ? "default" : "pointer",
                zIndex:       VISIBLE_RANGE - Math.abs(offset) + 1,
                boxShadow:    isActive
                  ? "0 50px 120px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.10)"
                  : "0 24px 60px rgba(0,0,0,0.65)",
                willChange:   "transform, opacity",
              }}
            >
              <img
                src={src}
                alt={`أرضية ${i + 1}`}
                style={{
                  width:         "100%",
                  height:        "100%",
                  objectFit:     "cover",
                  objectPosition:"center",
                  display:       "block",
                  pointerEvents: "none",
                  userSelect:    "none",
                }}
                draggable={false}
              />

              {/* Inner glow ring on active card */}
              {isActive && (
                <div
                  aria-hidden="true"
                  style={{
                    position:     "absolute",
                    inset:        0,
                    borderRadius: 24,
                    border:       "1px solid rgba(255,255,255,0.14)",
                    background:   "linear-gradient(to bottom, rgba(255,255,255,0.05) 0%, transparent 35%)",
                    pointerEvents:"none",
                  }}
                />
              )}
            </motion.div>
          );
        })}
      </div>

      {/* ── Dot indicators ─────────────────────────────────────────────── */}
      <div
        role="tablist"
        aria-label="اختر صورة"
        style={{
          display:    "flex",
          gap:        "8px",
          marginTop:  "clamp(1.5rem,3vh,2.5rem)",
          zIndex:     20,
          position:   "relative",
        }}
      >
        {IMAGES.map((_, i) => (
          <button
            key={i}
            role="tab"
            aria-selected={i === active}
            aria-label={`الصورة ${i + 1}`}
            onClick={() => setActive(i)}
            style={{
              width:      i === active ? "22px" : "7px",
              height:     "7px",
              borderRadius:"3.5px",
              background: i === active ? "#fff" : "rgba(255,255,255,0.28)",
              border:     "none",
              cursor:     "pointer",
              padding:    0,
              transition: "width 0.35s ease, background 0.35s ease",
            }}
          />
        ))}
      </div>

      {/* ── CTA + Down chevron ─────────────────────────────────────────── */}
      <Link
        href="/room-preview/screen?source=hero_try_button"
        aria-label="ابدأ التجربة"
        className="c3d-chevron"
        style={{
          position:       "absolute",
          bottom:         "clamp(1.25rem,2.5vh,2rem)",
          left:           "50%",
          transform:      "translateX(-50%)",
          zIndex:         20,
          color:          "rgba(255,255,255,0.55)",
          display:        "flex",
          flexDirection:  "column",
          alignItems:     "center",
          gap:            "0.35rem",
          textDecoration: "none",
          animation:      "c3dChevron 2.8s ease-in-out infinite",
        }}
      >
        <span
          dir="rtl"
          style={{
            fontFamily:    "var(--font-tajawal), sans-serif",
            fontWeight:    400,
            fontSize:      "clamp(0.9rem,1.6vw,1.15rem)",
            letterSpacing: "0.04em",
            whiteSpace:    "nowrap",
          }}
        >
          جربها في غرفتك الآن
        </span>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="1.25"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="1.25"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          style={{ marginTop: "-12px", opacity: 0.35 }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </Link>
    </section>
  );
}
