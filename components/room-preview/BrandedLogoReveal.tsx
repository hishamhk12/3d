"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import { gsap } from "gsap";
import AnimatedContent from "@/components/reactbits/AnimatedContent";

/**
 * Centered company-logo reveal for the QR/loading glass panel.
 *
 * Asset: the exact file inspected on disk — public/شعار/شعار الشركة.svg.
 * (Note: "public/شعار الشركة/شعار.svg" does NOT exist on disk.) It is an SVG
 * whose Arabic + English lettering are all vector elements — 22 <path> + 1
 * <rect>, zero <text>/<tspan> — so it is an IMAGE, not live text. ReactBits
 * Blur Text is therefore deliberately NOT used (it only animates real text
 * characters). The whole SVG is revealed as one piece instead.
 *
 * Reveal (all on mount, no ScrollTrigger, no scrolling required):
 *   • opacity 0 → 1
 *   • blur    24px → 0
 *   • scale   0.90 → 1
 *   • duration ~1200ms
 * The opacity + blur are tweened directly with GSAP on mount (AnimatedContent
 * has no blur prop), guaranteeing the reveal runs and that opacity is never
 * gated by a scroll trigger. The official ReactBits AnimatedContent owns the
 * subtle scale-up and is configured (distance 0, threshold 0) to play on mount
 * with no movement. The logo stays exactly centered throughout.
 */

// public/شعار/شعار الشركة.svg — encodeURI keeps the Arabic folder/file + space URL-safe.
const COMPANY_LOGO_SRC = encodeURI("/شعار/شعار الشركة.svg");
// width/height carry only the intrinsic aspect ratio (viewBox 260.49 × 86.59,
// scaled ×100) so the rendered logo never distorts; display size is set in style.
const LOGO_RATIO_W = 26049;
const LOGO_RATIO_H = 8659;

const REVEAL_MS = 1200;
const REVEAL_S = REVEAL_MS / 1000;

export default function BrandedLogoReveal() {
  const logoRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = logoRef.current;
    if (!el) return;
    // Mount-driven blur-to-sharp + fade. No ScrollTrigger, no scroll needed.
    const tween = gsap.fromTo(
      el,
      { opacity: 0, filter: "blur(24px)" },
      {
        opacity: 1,
        filter: "blur(0px)",
        duration: REVEAL_S,
        ease: "power2.out",
      },
    );
    return () => {
      tween.kill();
    };
  }, []);

  return (
    <AnimatedContent
      distance={0}
      direction="vertical"
      animateOpacity={false}
      scale={0.9}
      duration={REVEAL_S}
      threshold={0}
      style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <span
        ref={logoRef}
        style={{
          display: "inline-flex",
          willChange: "opacity, filter",
        }}
      >
        <Image
          src={COMPANY_LOGO_SRC}
          alt="شعار الشركة"
          width={LOGO_RATIO_W}
          height={LOGO_RATIO_H}
          priority
          unoptimized
          draggable={false}
          style={{
            width: "min(640px, 58vw)",
            height: "auto",
            userSelect: "none",
          }}
        />
      </span>
    </AnimatedContent>
  );
}
