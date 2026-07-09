"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import FadeContent from "@/components/reactbits/FadeContent";
import { CircularGallery, type CircularGalleryItem } from "@/components/circular-gallery";
import { LiquidMetalButton } from "@/components/ui/liquid-metal-button";

// Destination of the «جربها في غرفتك الآن» CTA. Clicking it plays a ReactBits
// FadeContent transition first, then navigates here.
const TRY_NOW_TARGET = "/room-preview/screen?source=hero_try_button";

type Carousel3DProps = {
  images: string[];
};

/* ------------------------------------------------------------------ *
 * Room Preview landing — full-screen showroom gallery.
 *
 * The image gallery is the installed 21st.dev Circular Gallery
 * (components/circular-gallery.tsx): room cards arranged in a full 360°
 * 3D ring (rotateY + translateZ, perspective, preserve-3d) with the
 * component's original auto-rotation and per-card opacity equations.
 *
 * The ring lives inside a fixed design "stage" that is uniformly scaled
 * to fit the viewport (centered, never overflows, no page scroll). The
 * background, overlay, CTA and FadeContent transition are unchanged.
 * ------------------------------------------------------------------ */

// Square room images (1:1) → square cards (object-cover, no distortion).
// A smaller ring radius relative to the card size keeps the front card large
// and dominant while its neighbours overlap (hiding background gaps).
const CARD_W = 400;
const CARD_H = 400;
const RING_RADIUS = 780;
const RING_PERSPECTIVE = 1500;

// Fixed stage that contains the whole ring, scaled to fit the viewport.
const STAGE_W = 1640;
const STAGE_H = 900;

export function Carousel3D({ images }: Carousel3DProps) {
  const router = useRouter();
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [stageScale, setStageScale] = useState(1);
  const hasImages = images.length > 0;

  // Warm the destination route so navigation after the fade is instant.
  useEffect(() => {
    router.prefetch(TRY_NOW_TARGET);
  }, [router]);

  // CTA click → start the FadeContent transition; FadeContent's onComplete
  // performs the actual navigation to TRY_NOW_TARGET (route unchanged).
  const startTryNowTransition = useCallback(() => {
    setIsTransitioning(true);
  }, []);

  // Uniformly scale the fixed stage to fit the viewport — leaving vertical room
  // for the CTA below — without ever upscaling (keeps the room photos crisp).
  useEffect(() => {
    const compute = () => {
      const s = Math.min(
        window.innerWidth / STAGE_W,
        (window.innerHeight * 0.74) / STAGE_H,
        1,
      );
      setStageScale(s > 0 ? s : 1);
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);

  // Preload room images so the ring renders instantly.
  useEffect(() => {
    if (!hasImages) return;
    images.forEach((src) => {
      const img = new window.Image();
      img.src = src;
    });
  }, [hasImages, images]);

  const galleryItems: CircularGalleryItem[] = hasImages
    ? images.map((url, i) => ({ url, alt: `صورة غرفة ${i + 1}` }))
    : [];

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
        // Transparent: the server-rendered <main> behind already paints the
        // private.jpg background, so no interim color ever shows.
        background: "transparent",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "min(3.5vh, 40px)",
      }}
    >
      <style>{`
        .c3d-cta { transition: transform .18s ease, box-shadow .18s ease; }
        .c3d-cta:active { transform: scale(0.98); }
        .c3d-cta:focus-visible { outline: none; box-shadow: 0 0 0 4px rgba(255,255,255,0.6); }
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

      {/* ---- Circular Gallery ring inside a scaled stage ---- */}
      <div
        style={{
          position: "relative",
          zIndex: 2,
          width: STAGE_W * stageScale,
          height: STAGE_H * stageScale,
          flexShrink: 0,
        }}
      >
        {hasImages ? (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: STAGE_W,
              height: STAGE_H,
              transform: `scale(${stageScale})`,
              transformOrigin: "top left",
            }}
          >
            <CircularGallery
              items={galleryItems}
              radius={RING_RADIUS}
              cardWidth={CARD_W}
              cardHeight={CARD_H}
              perspective={RING_PERSPECTIVE}
            />
          </div>
        ) : (
          <p
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              color: "rgba(255,255,255,0.85)",
              fontFamily: "var(--font-tajawal), sans-serif",
              fontSize: 32,
            }}
          >
            لا توجد صور غرف للعرض حالياً
          </p>
        )}
      </div>

      {/* ---- Main CTA — 21st.dev Liquid Metal Button (frosted-glass inner),
          same position / dimensions / route / transition as before. ---- */}
      <LiquidMetalButton
        onClick={startTryNowTransition}
        height={72}
        paddingX={48}
        radius={100}
        ariaLabel="ابدأ التجربة"
        style={{ position: "relative", zIndex: 12, flexShrink: 0 }}
      >
        <span
          style={{
            fontFamily: "var(--font-tajawal), sans-serif",
            fontWeight: 700,
            fontSize: 26,
            letterSpacing: "0.01em",
            color: "#000000",
            whiteSpace: "nowrap",
          }}
        >
          جربها في غرفتك الآن
        </span>
      </LiquidMetalButton>

      {/* ---- ReactBits FadeContent transition overlay ----
          Mounted on CTA click. It fades a full-screen veil (matching the
          destination's background) in over the gallery, then navigates on
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
