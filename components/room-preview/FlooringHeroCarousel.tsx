"use client";

import { useEffect, useRef, useState } from "react";

function encodeAssetPath(rawPath: string): string {
  return "/" + rawPath.split("/").map(encodeURIComponent).join("/");
}

const IMAGES = [
  "صور ارضيات/باركيه/279b-roble-eyre-gris-xl-4v-room (1).jpg",
  "صور ارضيات/باركيه/283b-roble-selena-sable-su-4v-room (1).jpg",
  "صور ارضيات/باركيه/322b-roble-magari-or-4v-room_V2.jpg",
  "صور ارضيات/باركيه/343b-roble-fado-brisa-ev-4v-room.jpg",
  "صور ارضيات/باركيه/353b-roble-sonata-or-4v-room.jpg",
  "صور ارضيات/باركيه/369b-roble-vera-siglo-xl-4v-room-2.jpg",
  "صور ارضيات/كاربيت/10.jpg",
  "صور ارضيات/كاربيت/FN9-3-1.jpg",
  "صور ارضيات/كاربيت/FN9-3-fn9-4.png",
  "صور ارضيات/كاربيت/Haze LP 850_1.jpg.webp",
  "صور ارضيات/كاربيت/Interior_Etch 901_Etch Gradient 901_Core 901.jpg.webp",
].map(encodeAssetPath);

const COLS = 4;
const ROWS = 3;

// Timing constants (kept slow and cinematic)
const TILE_STAGGER_MS = 55; // delay between each diagonal wave step
const TILE_DURATION_MS = 720; // each tile's individual transition
const MAX_DIAGONAL = COLS + ROWS - 2; // 5 diagonal steps
const PHASE_MS = MAX_DIAGONAL * TILE_STAGGER_MS + TILE_DURATION_MS + 130; // ~1125ms per cover/reveal phase
const DISPLAY_MS = 5200; // how long each image is fully shown

type Phase = "idle" | "covering" | "revealing";

export function FlooringHeroCarousel() {
  const [displayIdx, setDisplayIdx] = useState(0);
  const [tileSrc, setTileSrc] = useState(IMAGES[0]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [kenBurnsKey, setKenBurnsKey] = useState(0);
  const idxRef = useRef(0);

  // Preload all images on mount
  useEffect(() => {
    IMAGES.forEach((src) => {
      const img = new window.Image();
      img.src = src;
    });
  }, []);

  // Main animation loop
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    const runCycle = () => {
      // Wait for display duration, then start covering
      const t1 = setTimeout(() => {
        setTileSrc(IMAGES[idxRef.current]); // snapshot current image into tiles
        setPhase("covering");

        // Once tiles have covered the screen, swap background and start revealing
        const t2 = setTimeout(() => {
          const next = (idxRef.current + 1) % IMAGES.length;
          idxRef.current = next;
          setDisplayIdx(next);
          setKenBurnsKey((k) => k + 1);
          setPhase("revealing");

          // Once tiles have revealed the new image, return to idle and loop
          const t3 = setTimeout(() => {
            setPhase("idle");
            runCycle();
          }, PHASE_MS);
          timers.push(t3);
        }, PHASE_MS);
        timers.push(t2);
      }, DISPLAY_MS);
      timers.push(t1);
    };

    runCycle();
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <section
      aria-label="معرض الأرضيات"
      style={{
        position: "relative",
        width: "100%",
        height: "100dvh",
        minHeight: "100vh",
        overflow: "hidden",
        backgroundColor: "#0c0a09",
      }}
    >
      <style>{`
        @keyframes heroKenBurns {
          from { transform: scale(1)   translateY(0%); }
          to   { transform: scale(1.07) translateY(-1.5%); }
        }
        @keyframes heroChevronFloat {
          0%, 100% { transform: translateX(-50%) translateY(0);   opacity: 0.45; }
          50%       { transform: translateX(-50%) translateY(10px); opacity: 0.75; }
        }
        @media (prefers-reduced-motion: reduce) {
          .hero-bg-img  { animation: none !important; }
          .hero-chevron { animation: none !important; }
        }
      `}</style>

      {/* Background image — Ken Burns slow pan */}
      <img
        key={kenBurnsKey}
        className="hero-bg-img"
        src={IMAGES[displayIdx]}
        alt=""
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: "center center",
          animation: "heroKenBurns 7s ease-out forwards",
          willChange: "transform",
        }}
      />

      {/* Cinematic gradient overlay — dark top + heavy bottom vignette */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background: [
            "radial-gradient(ellipse 110% 80% at 50% 50%, transparent 35%, rgba(0,0,0,0.32) 100%)",
            "linear-gradient(to bottom, rgba(0,0,0,0.32) 0%, rgba(0,0,0,0.06) 22%, rgba(0,0,0,0.04) 52%, rgba(0,0,0,0.60) 80%, rgba(0,0,0,0.82) 100%)",
          ].join(", "),
          zIndex: 2,
        }}
      />

      {/* Mosaic tile overlay grid */}
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, zIndex: 3 }}>
        {Array.from({ length: ROWS }, (_, row) =>
          Array.from({ length: COLS }, (_, col) => {
            const key = row * COLS + col;
            // CSS background-position to map each tile to its slice of the full image
            const xPct = (col / (COLS - 1)) * 100;
            const yPct = (row / (ROWS - 1)) * 100;
            // Diagonal stagger: top-left tiles animate first
            const delay = (col + row) * TILE_STAGGER_MS;
            const active = phase !== "idle";
            const covering = phase === "covering";

            return (
              <div
                key={key}
                style={{
                  position: "absolute",
                  width: `${100 / COLS}%`,
                  height: `${100 / ROWS}%`,
                  left: `${(col / COLS) * 100}%`,
                  top: `${(row / ROWS) * 100}%`,
                  backgroundImage: `url("${tileSrc}")`,
                  backgroundSize: `${COLS * 100}% ${ROWS * 100}%`,
                  backgroundPosition: `${xPct}% ${yPct}%`,
                  backgroundRepeat: "no-repeat",
                  // idle: invisible + slightly shrunk ready to "settle in"
                  // covering: fully visible + settled at scale(1)
                  // revealing: invisible + slightly zoomed out
                  opacity: covering ? 1 : 0,
                  transform:
                    phase === "idle"
                      ? "scale(0.972)"
                      : covering
                      ? "scale(1)"
                      : "scale(1.018)",
                  transition: active
                    ? `opacity ${TILE_DURATION_MS}ms cubic-bezier(0.4,0,0.2,1), transform ${TILE_DURATION_MS}ms cubic-bezier(0.4,0,0.2,1)`
                    : "none",
                  transitionDelay: active ? `${delay}ms` : "0ms",
                  willChange: "opacity, transform",
                }}
              />
            );
          })
        )}
      </div>

      {/* Text overlay — Arabic, centered, fixed within the hero */}
      <div
        dir="rtl"
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 10,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: "0 clamp(1.5rem, 5vw, 5rem)",
          pointerEvents: "none",
          gap: "clamp(0.6rem, 1.2vw, 1rem)",
        }}
      >
        <h1
          style={{
            fontFamily: "var(--font-tajawal), sans-serif",
            fontWeight: 700,
            fontSize: "clamp(2.6rem, 6.5vw, 5.8rem)",
            color: "#ffffff",
            lineHeight: 1.15,
            letterSpacing: "-0.01em",
            textShadow:
              "0 2px 28px rgba(0,0,0,0.60), 0 1px 5px rgba(0,0,0,0.35)",
            margin: 0,
          }}
        >
          شف الأرضية في غرفتك
        </h1>
        <p
          style={{
            fontFamily: "var(--font-tajawal), sans-serif",
            fontWeight: 300,
            fontSize: "clamp(1rem, 2.3vw, 1.65rem)",
            color: "rgba(255,255,255,0.78)",
            lineHeight: 1.65,
            letterSpacing: "0.02em",
            textShadow: "0 1px 14px rgba(0,0,0,0.50)",
            margin: 0,
          }}
        >
          امسح وجرّبها على صورتك
        </p>
      </div>

      {/* Down chevron — guides visitor to the section below */}
      <a
        href="#start-session"
        aria-label="انتقل إلى قسم البدء"
        className="hero-chevron"
        style={{
          position: "absolute",
          bottom: "clamp(1.75rem, 3.5vh, 2.75rem)",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 10,
          color: "rgba(255,255,255,0.45)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textDecoration: "none",
          animation: "heroChevronFloat 2.8s ease-in-out infinite",
        }}
      >
        <svg
          width="34"
          height="34"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ marginTop: "-14px", opacity: 0.45 }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </a>
    </section>
  );
}
