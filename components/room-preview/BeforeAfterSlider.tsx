"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { PointerEvent } from "react";

type BeforeAfterSliderProps = {
  beforeImageUrl?: string | null;
  afterImageUrl: string;
  beforeLabel?: string;
  afterLabel?: string;
  alt?: string;
  className?: string;
  imageClassName?: string;
  sizes?: string;
  priority?: boolean;
  unoptimized?: boolean;
  fit?: "cover" | "contain";
};

type ImageBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function BeforeAfterSlider({
  beforeImageUrl,
  afterImageUrl,
  beforeLabel = "قبل",
  afterLabel = "بعد",
  alt = "Before and after preview",
  className = "",
  imageClassName = "",
  fit = "cover",
}: BeforeAfterSliderProps) {
  const id = useId();
  const [beforeReveal, setBeforeReveal] = useState(50);
  const [imageBox, setImageBox] = useState<ImageBox | null>(null);
  const beforeSrc = beforeImageUrl || afterImageUrl;
  const containImageClass =
    "block h-auto w-auto max-h-full max-w-full object-contain";
  const coverImageClass =
    "block h-full w-full max-h-full max-w-full object-cover";
  const imageClass = fit === "contain" ? containImageClass : coverImageClass;

  const containerRef = useRef<HTMLDivElement>(null);
  const afterImageRef = useRef<HTMLImageElement>(null);
  const isDraggingRef = useRef(false);
  const pendingXRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  const measureDisplayedImage = useCallback(() => {
    const container = containerRef.current;
    const image = afterImageRef.current;
    if (!container || !image) return;

    const containerRect = container.getBoundingClientRect();
    const imageRect = image.getBoundingClientRect();
    if (containerRect.width <= 0 || containerRect.height <= 0 || imageRect.width <= 0 || imageRect.height <= 0) {
      return;
    }

    setImageBox({
      left: imageRect.left - containerRect.left,
      top: imageRect.top - containerRect.top,
      width: imageRect.width,
      height: imageRect.height,
    });
  }, []);

  useEffect(() => {
    measureDisplayedImage();

    const container = containerRef.current;
    const image = afterImageRef.current;
    if (!container) return undefined;

    const observer = new ResizeObserver(measureDisplayedImage);
    observer.observe(container);
    if (image) observer.observe(image);

    window.addEventListener("resize", measureDisplayedImage);
    window.visualViewport?.addEventListener("resize", measureDisplayedImage);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measureDisplayedImage);
      window.visualViewport?.removeEventListener("resize", measureDisplayedImage);
    };
  }, [measureDisplayedImage]);

  const commitPosition = useCallback(() => {
    rafRef.current = null;
    const x = pendingXRef.current;
    if (x === null || !containerRef.current) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const box = imageBox ?? {
      left: 0,
      top: 0,
      width: containerRect.width,
      height: containerRect.height,
    };
    const pct = Math.min(100, Math.max(0, ((x - containerRect.left - box.left) / box.width) * 100));
    setBeforeReveal(pct);
    pendingXRef.current = null;
  }, [imageBox]);

  const scheduleUpdate = useCallback(
    (clientX: number) => {
      pendingXRef.current = clientX;
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(commitPosition);
      }
    },
    [commitPosition],
  );

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      isDraggingRef.current = true;
      scheduleUpdate(e.clientX);
    },
    [scheduleUpdate],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current) return;
      e.preventDefault();
      scheduleUpdate(e.clientX);
    },
    [scheduleUpdate],
  );

  const onPointerUp = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Already released.
      }
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        commitPosition();
      }
    },
    [commitPosition],
  );

  const onPointerCancel = useCallback((e: PointerEvent<HTMLDivElement>) => {
    isDraggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Already released.
    }
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const box = imageBox ?? { left: 0, top: 0, width: 0, height: 0 };
  const dividerLeft = box.left + (box.width * beforeReveal) / 100;
  const overlaysReady = box.width > 0 && box.height > 0;

  return (
    <div
      ref={containerRef}
      className={`relative isolate overflow-hidden bg-[#071729] select-none ${className}`}
      style={{ touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <div className="absolute inset-0 flex h-full w-full items-center justify-center overflow-hidden">
        <img
          ref={afterImageRef}
          src={afterImageUrl}
          alt={alt}
          draggable={false}
          decoding="async"
          loading="eager"
          className={`pointer-events-none ${imageClass} ${imageClassName}`}
          onLoad={measureDisplayedImage}
        />
      </div>

      {overlaysReady ? (
        <div
          className="pointer-events-none absolute z-20 overflow-hidden"
          style={{
            left: box.left,
            top: box.top,
            width: box.width,
            height: box.height,
            clipPath: `inset(0 ${100 - beforeReveal}% 0 0)`,
          }}
          aria-hidden
        >
          <img
            src={beforeSrc}
            alt=""
            draggable={false}
            decoding="async"
            loading="eager"
            className={`pointer-events-none h-full w-full max-h-full max-w-full ${
              fit === "contain" ? "object-contain" : "object-cover"
            } object-center ${imageClassName}`}
            onLoad={measureDisplayedImage}
          />
        </div>
      ) : null}

      {overlaysReady ? (
        <div
          className="pointer-events-none absolute z-30 flex items-center justify-between text-[11px] font-bold"
          style={{
            left: box.left + 12,
            right: `calc(100% - ${box.left + box.width - 12}px)`,
            top: box.top + 12,
          }}
        >
          <span className="rounded-full border border-white/15 bg-black/50 px-2.5 py-1 text-white/85 backdrop-blur-md">
            {afterLabel}
          </span>
          <span className="rounded-full border border-white/15 bg-black/50 px-2.5 py-1 text-white/85 backdrop-blur-md">
            {beforeLabel}
          </span>
        </div>
      ) : null}

      {overlaysReady ? (
        <>
          <div
            className="pointer-events-none absolute z-30 w-px bg-white/85 shadow-[0_0_18px_rgba(0,0,0,0.45)]"
            style={{
              left: dividerLeft,
              top: box.top,
              height: box.height,
            }}
          />

          <div
            className="pointer-events-none absolute z-40 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/80 bg-white text-slate-950 shadow-[0_10px_30px_rgba(0,0,0,0.45)]"
            style={{
              left: dividerLeft,
              top: box.top + box.height / 2,
            }}
          >
            <span className="flex items-center gap-1 text-[15px] font-black leading-none" aria-hidden>
              <span>‹</span>
              <span>›</span>
            </span>
          </div>
        </>
      ) : null}

      <label htmlFor={id} className="sr-only">
        {beforeLabel} / {afterLabel}
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        value={Math.round(beforeReveal)}
        onChange={(e) => setBeforeReveal(Number(e.target.value))}
        className="pointer-events-none absolute inset-0 z-40 h-full w-full cursor-ew-resize opacity-0"
        aria-label={`${beforeLabel} / ${afterLabel}`}
      />
    </div>
  );
}
