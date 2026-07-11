"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, ImageOff } from "lucide-react";

// Mobile-only 3D carousel for the "existing customer" confirm screen, built to
// match the requested feature-carousel motion (translateX/scale/rotateY per
// slot, ~500ms ease, autoplay, swipe) but scoped to this flow's real data —
// no demo images, no desktop layout.

export type PreviousPreviewItem = {
  id: string;
  src: string;
  alt?: string;
  title?: string | null;
};

const AUTOPLAY_MS = 4000;
const SWIPE_THRESHOLD_PX = 40;

interface PreviousPreviewsCarouselProps {
  items: PreviousPreviewItem[];
  index: number;
  onIndexChange: (index: number) => void;
}

export function PreviousPreviewsCarousel({ items, index, onIndexChange }: PreviousPreviewsCarouselProps) {
  const total = items.length;
  const [failedIds, setFailedIds] = useState<Record<string, boolean>>({});
  const [reducedMotion, setReducedMotion] = useState(false);
  const [pageHidden, setPageHidden] = useState(false);

  const dragStartX = useRef<number | null>(null);
  const dragDeltaX = useRef(0);
  const dragStartY = useRef<number | null>(null);
  const dragAxis = useRef<"x" | "y" | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const onVisibility = () => setPageHidden(document.hidden);
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const goTo = useCallback(
    (next: number) => {
      if (total === 0) return;
      onIndexChange(((next % total) + total) % total);
    },
    [total, onIndexChange],
  );

  const handleNext = useCallback(() => goTo(index + 1), [goTo, index]);
  const handlePrev = useCallback(() => goTo(index - 1), [goTo, index]);

  // Restarts on every index change — including manual nav — so interaction
  // always pushes the next autoplay tick 4s out.
  useEffect(() => {
    if (total <= 1 || reducedMotion || pageHidden) return;
    const id = setInterval(() => goTo(index + 1), AUTOPLAY_MS);
    return () => clearInterval(id);
  }, [index, total, reducedMotion, pageHidden, goTo]);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (total <= 1) return;
    const touch = e.touches[0];
    dragStartX.current = touch.clientX;
    dragStartY.current = touch.clientY;
    dragDeltaX.current = 0;
    dragAxis.current = null;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (dragStartX.current === null || dragStartY.current === null) return;
    const touch = e.touches[0];
    const dx = touch.clientX - dragStartX.current;
    const dy = touch.clientY - dragStartY.current;
    dragDeltaX.current = dx;

    if (dragAxis.current === null && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
      dragAxis.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    // `touch-action: pan-y` on the wrapper already tells the browser to leave
    // horizontal panning to us and keep native vertical scroll — no
    // preventDefault() needed (and React's touchmove listener is passive, so
    // calling it here would just warn without doing anything).
  };

  const handleTouchEnd = () => {
    if (dragAxis.current === "x") {
      const delta = dragDeltaX.current;
      if (delta <= -SWIPE_THRESHOLD_PX) handleNext();
      else if (delta >= SWIPE_THRESHOLD_PX) handlePrev();
    }
    dragStartX.current = null;
    dragStartY.current = null;
    dragDeltaX.current = 0;
    dragAxis.current = null;
  };

  if (total === 0) return null;

  return (
    <div className="w-full">
      <div
        className="relative mx-auto w-full select-none overflow-hidden"
        style={{
          height: "clamp(360px, 46svh, 440px)",
          perspective: "1000px",
          touchAction: "pan-y",
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {items.map((item, i) => {
          let pos = i - index;
          if (pos > total / 2) pos -= total;
          if (pos < -total / 2) pos += total;

          const isCurrent = pos === 0;
          const isAdjacent = Math.abs(pos) === 1;
          if (Math.abs(pos) > 1) return null;

          const failed = failedIds[item.id];

          return (
            <div
              key={item.id}
              className="absolute left-1/2 top-0 h-full ease-out"
              style={{
                width: "min(72vw, 300px)",
                marginLeft: "calc(min(72vw, 300px) / -2)",
                transitionProperty: "transform, opacity, filter",
                transitionDuration: reducedMotion ? "0ms" : "500ms",
                transform: `translateX(${pos * 45}%) scale(${isCurrent ? 1 : isAdjacent ? 0.86 : 0.7}) rotateY(${pos * -10}deg)`,
                zIndex: isCurrent ? 10 : isAdjacent ? 5 : 1,
                opacity: isCurrent ? 1 : isAdjacent ? 0.4 : 0,
                filter: isCurrent ? "blur(0px)" : "blur(2px)",
                visibility: Math.abs(pos) > 1 ? "hidden" : "visible",
              }}
              aria-hidden={!isCurrent}
            >
              <div className="relative h-full w-full overflow-hidden rounded-[26px] border border-black/5 bg-[var(--brand-navy)]/5 shadow-xl">
                {!failed ? (
                  <Image
                    src={item.src}
                    alt={item.alt ?? ""}
                    fill
                    unoptimized
                    priority={isCurrent}
                    sizes="(max-width: 430px) 72vw, 300px"
                    className="object-cover"
                    draggable={false}
                    onError={() => setFailedIds((prev) => ({ ...prev, [item.id]: true }))}
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-[var(--text-muted)]">
                    <ImageOff className="h-8 w-8" />
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {total > 1 && (
          <>
            <button
              type="button"
              onClick={handlePrev}
              aria-label={"الصورة السابقة"}
              className="absolute left-1 top-1/2 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-black/5 bg-white/80 text-[var(--text-primary)] shadow-md backdrop-blur-sm active:scale-95"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={handleNext}
              aria-label={"الصورة التالية"}
              className="absolute right-1 top-1/2 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-black/5 bg-white/80 text-[var(--text-primary)] shadow-md backdrop-blur-sm active:scale-95"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        )}
      </div>

      {total > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          {items.map((item, i) => (
            <button
              key={item.id}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`عرض المعاينة ${i + 1}`}
              className={`h-2 rounded-full transition-all duration-300 ${
                i === index ? "w-6 bg-[var(--brand-cyan)]" : "w-2 bg-black/15"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
