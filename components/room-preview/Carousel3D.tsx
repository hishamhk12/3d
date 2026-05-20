"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  animate,
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
} from "framer-motion";

type Carousel3DProps = {
  images: string[];
};

function extractColor(src: string): Promise<[number, number, number]> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 24;
        canvas.height = 24;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve([40, 28, 18]);

        const sx = img.naturalWidth * 0.2;
        const sy = img.naturalHeight * 0.45;
        const sw = img.naturalWidth * 0.6;
        const sh = img.naturalHeight * 0.5;
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 24, 24);

        const { data } = ctx.getImageData(0, 0, 24, 24);
        let r = 0;
        let g = 0;
        let b = 0;
        const n = data.length / 4;
        for (let i = 0; i < data.length; i += 4) {
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
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

const VISIBLE_RANGE = 2;
const AUTOPLAY_MS = 5000;

const CFG = [
  { rotateY: 0, scale: 1, opacity: 1, blur: 0, brightness: 1 },
  { rotateY: 42, scale: 0.8, opacity: 0.72, blur: 1.5, brightness: 0.72 },
  { rotateY: 58, scale: 0.62, opacity: 0.35, blur: 3, brightness: 0.5 },
] as const;

export function Carousel3D({ images }: Carousel3DProps) {
  const [active, setActive] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [cardW, setCardW] = useState(820);
  const prefersReduced = useReducedMotion();
  const hasImages = images.length > 0;

  const ambR = useMotionValue(40);
  const ambG = useMotionValue(28);
  const ambB = useMotionValue(18);

  const ambientBg = useMotionTemplate`radial-gradient(
    ellipse 140% 75% at 50% 105%,
    rgba(${ambR},${ambG},${ambB},0.55) 0%,
    rgba(${ambR},${ambG},${ambB},0.18) 40%,
    transparent 68%
  )`;

  useEffect(() => {
    const compute = () => {
      setCardW(Math.min(820, Math.max(300, window.innerWidth * 0.62)));
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);

  const cardH = Math.round(cardW * (2 / 3));
  const xStep1 = Math.round(cardW * 0.62);
  const xStep2 = Math.round(cardW * 1.08);

  useEffect(() => {
    setActive(0);
  }, [images]);

  useEffect(() => {
    const activeImage = images[active];
    if (!activeImage) return;

    extractColor(activeImage).then(([r, g, b]) => {
      const dur = { duration: 1.4, ease: "easeOut" } as const;
      animate(ambR, r, dur);
      animate(ambG, g, dur);
      animate(ambB, b, dur);
    });
  }, [active, ambB, ambG, ambR, images]);

  const advance = useCallback(() => {
    if (!hasImages) return;
    setActive((i) => (i + 1) % images.length);
  }, [hasImages, images.length]);

  useEffect(() => {
    if (!hasImages || isPaused) return;
    const id = setInterval(advance, AUTOPLAY_MS);
    return () => clearInterval(id);
  }, [advance, hasImages, isPaused]);

  useEffect(() => {
    if (!hasImages) return;

    images.forEach((src) => {
      const img = new window.Image();
      img.src = src;
    });

    extractColor(images[0]).then(([r, g, b]) => {
      ambR.set(r);
      ambG.set(g);
      ambB.set(b);
    });
  }, [ambB, ambG, ambR, hasImages, images]);

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
    const xArr = [0, xStep1, xStep2];

    return {
      x: sign * (xArr[abs] ?? 0),
      rotateY: sign * -cfg.rotateY,
      scale: cfg.scale,
      opacity: cfg.opacity,
      filter: abs > 0
        ? `blur(${cfg.blur}px) brightness(${cfg.brightness})`
        : "blur(0px) brightness(1)",
    };
  };

  return (
    <section
      aria-label="معرض الأرضيات"
      style={{
        position: "relative",
        width: "100%",
        height: "100dvh",
        minHeight: "100vh",
        overflow: "hidden",
        background: "#0d1b35",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
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

      <motion.div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background: ambientBg,
          zIndex: 1,
          pointerEvents: "none",
        }}
      />

      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: "15%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "80vw",
          height: "60vh",
          borderRadius: "50%",
          background: "radial-gradient(ellipse at center, rgba(180,200,240,0.07) 0%, transparent 70%)",
          filter: "blur(40px)",
          pointerEvents: "none",
          zIndex: 2,
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          bottom: "10%",
          left: "10%",
          width: "45vw",
          height: "35vh",
          borderRadius: "50%",
          background: "radial-gradient(ellipse at center, rgba(150,180,230,0.05) 0%, transparent 70%)",
          filter: "blur(50px)",
          pointerEvents: "none",
          zIndex: 2,
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: "5%",
          right: "8%",
          width: "35vw",
          height: "30vh",
          borderRadius: "50%",
          background: "radial-gradient(ellipse at center, rgba(160,190,235,0.04) 0%, transparent 70%)",
          filter: "blur(45px)",
          pointerEvents: "none",
          zIndex: 2,
        }}
      />

      <div
        role="region"
        aria-roledescription="carousel"
        style={{
          position: "relative",
          width: "100%",
          height: cardH,
          perspective: "1400px",
          perspectiveOrigin: "50% 50%",
          flexShrink: 0,
          zIndex: 10,
        }}
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
      >
        {hasImages ? images.map((src, i) => {
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
              aria-label={isActive ? `الصورة ${i + 1} نشطة` : `انتقل إلى الصورة ${i + 1}`}
              aria-current={isActive ? "true" : undefined}
              style={{
                position: "absolute",
                width: cardW,
                height: cardH,
                left: `calc(50% - ${cardW / 2}px)`,
                top: 0,
                borderRadius: 24,
                overflow: "hidden",
                cursor: isActive ? "default" : "pointer",
                zIndex: VISIBLE_RANGE - Math.abs(offset) + 1,
                boxShadow: isActive
                  ? "0 50px 120px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.10)"
                  : "0 24px 60px rgba(0,0,0,0.65)",
                willChange: "transform, opacity",
              }}
            >
              <Image
                src={src}
                alt={`أرضية ${i + 1}`}
                fill
                unoptimized
                sizes="(max-width: 768px) 90vw, 820px"
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
                    borderRadius: 24,
                    border: "1px solid rgba(255,255,255,0.14)",
                    background: "linear-gradient(to bottom, rgba(255,255,255,0.05) 0%, transparent 35%)",
                    pointerEvents: "none",
                  }}
                />
              ) : null}
            </motion.div>
          );
        }) : null}
      </div>

      {!hasImages ? (
        <p
          dir="rtl"
          style={{
            position: "relative",
            zIndex: 20,
            color: "rgba(255,255,255,0.78)",
            fontFamily: "var(--font-tajawal), sans-serif",
            fontSize: "1rem",
          }}
        >
          لا توجد صور غرف للعرض حالياً
        </p>
      ) : null}

      <div
        role="tablist"
        aria-label="اختر صورة"
        style={{
          display: "flex",
          gap: "8px",
          marginTop: "clamp(1.5rem,3vh,2.5rem)",
          zIndex: 20,
          position: "relative",
        }}
      >
        {images.map((_, i) => (
          <button
            key={i}
            role="tab"
            aria-selected={i === active}
            aria-label={`الصورة ${i + 1}`}
            onClick={() => setActive(i)}
            style={{
              width: i === active ? "22px" : "7px",
              height: "7px",
              borderRadius: "3.5px",
              background: i === active ? "#fff" : "rgba(255,255,255,0.28)",
              border: "none",
              cursor: "pointer",
              padding: 0,
              transition: "width 0.35s ease, background 0.35s ease",
            }}
          />
        ))}
      </div>

      <Link
        href="/room-preview/screen?source=hero_try_button"
        aria-label="ابدأ التجربة"
        className="c3d-chevron"
        style={{
          position: "absolute",
          bottom: "clamp(1.25rem,2.5vh,2rem)",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 20,
          color: "rgba(255,255,255,0.55)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "0.35rem",
          textDecoration: "none",
          animation: "c3dChevron 2.8s ease-in-out infinite",
        }}
      >
        <span
          dir="rtl"
          style={{
            fontFamily: "var(--font-tajawal), sans-serif",
            fontWeight: 400,
            fontSize: "clamp(0.9rem,1.6vw,1.15rem)",
            letterSpacing: "0.04em",
            whiteSpace: "nowrap",
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
