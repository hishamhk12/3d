"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Image from "next/image";

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

export function BeforeAfterSlider({
  beforeImageUrl,
  afterImageUrl,
  beforeLabel = "قبل",
  afterLabel = "بعد",
  alt = "Before and after preview",
  className = "",
  imageClassName = "",
  sizes = "100vw",
  priority = false,
  unoptimized = false,
  fit = "cover",
}: BeforeAfterSliderProps) {
  const id = useId();
  const [beforeReveal, setBeforeReveal] = useState(50);
  const beforeSrc = beforeImageUrl || afterImageUrl;
  const objectClass = fit === "contain" ? "object-contain" : "object-cover";

  // ── Drag state (all in refs — never trigger re-renders during drag) ──────
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const pendingXRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  // Reads pendingXRef and commits to state. Called inside rAF or synchronously
  // on pointer-up to flush the last position with zero visual lag.
  const commitPosition = useCallback(() => {
    rafRef.current = null;
    const x = pendingXRef.current;
    if (x === null || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pct = Math.min(100, Math.max(0, ((x - rect.left) / rect.width) * 100));
    setBeforeReveal(pct);
    pendingXRef.current = null;
  }, []);

  // Store clientX and request one rAF per frame — no extra setState calls.
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
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      isDraggingRef.current = true;
      scheduleUpdate(e.clientX);
    },
    [scheduleUpdate],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current) return;
      e.preventDefault();
      scheduleUpdate(e.clientX);
    },
    [scheduleUpdate],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // already released — safe to ignore
      }
      // Flush pending position immediately so lift feels instant.
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        commitPosition();
      }
    },
    [commitPosition],
  );

  const onPointerCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    isDraggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
  }, []);

  // Cancel any pending rAF on unmount to avoid stale state updates.
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={`relative isolate overflow-hidden select-none bg-[#071729] ${className}`}
      // touch-action:none tells the browser to surrender scroll/zoom handling
      // so pointer events are always cancellable and never stolen by the UA.
      style={{ touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {/* ── After side: blur background ─────────────────────────────────── */}
      <Image
        src={afterImageUrl}
        alt=""
        fill
        draggable={false}
        unoptimized={unoptimized}
        priority={priority}
        sizes={sizes}
        className="pointer-events-none scale-110 object-cover object-center opacity-90 blur-2xl"
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-0 bg-black/35" aria-hidden />

      {/* ── After side: foreground ──────────────────────────────────────── */}
      <Image
        src={afterImageUrl}
        alt={alt}
        fill
        draggable={false}
        unoptimized={unoptimized}
        priority={priority}
        sizes={sizes}
        className={`pointer-events-none z-10 ${objectClass} object-center ${imageClassName}`}
      />

      {/* ── Before side: clipped reveal ─────────────────────────────────── */}
      <div
        className="pointer-events-none absolute inset-0 z-20"
        style={{ clipPath: `inset(0 ${100 - beforeReveal}% 0 0)` }}
        aria-hidden
      >
        <Image
          src={beforeSrc}
          alt=""
          fill
          draggable={false}
          unoptimized={unoptimized}
          priority={priority}
          sizes={sizes}
          className="pointer-events-none scale-110 object-cover object-center opacity-90 blur-2xl"
          aria-hidden
        />
        <div className="pointer-events-none absolute inset-0 bg-black/35" aria-hidden />
        <Image
          src={beforeSrc}
          alt=""
          fill
          draggable={false}
          unoptimized={unoptimized}
          priority={priority}
          sizes={sizes}
          className={`pointer-events-none ${objectClass} object-center ${imageClassName}`}
        />
      </div>

      {/* ── Labels ──────────────────────────────────────────────────────── */}
      <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex items-center justify-between text-[11px] font-bold">
        <span className="rounded-full border border-white/15 bg-black/50 px-2.5 py-1 text-white/85 backdrop-blur-md">
          {afterLabel}
        </span>
        <span className="rounded-full border border-white/15 bg-black/50 px-2.5 py-1 text-white/85 backdrop-blur-md">
          {beforeLabel}
        </span>
      </div>

      {/* ── Divider line ─────────────────────────────────────────────────── */}
      <div
        className="pointer-events-none absolute inset-y-0 z-20 w-px bg-white/85 shadow-[0_0_18px_rgba(0,0,0,0.45)]"
        style={{ left: `${beforeReveal}%` }}
      />

      {/* ── Handle knob (visual only — hit area is the entire container) ── */}
      <div
        className="pointer-events-none absolute top-1/2 z-30 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/80 bg-white text-slate-950 shadow-[0_10px_30px_rgba(0,0,0,0.45)]"
        style={{ left: `${beforeReveal}%` }}
      >
        <span className="flex items-center gap-1 text-[15px] font-black leading-none" aria-hidden>
          <span>‹</span>
          <span>›</span>
        </span>
      </div>

      {/* ── Accessible keyboard fallback ─────────────────────────────────── */}
      {/* pointer-events-none so touch/mouse events pass through to the container;
          the element is still keyboard-focusable and responds to arrow keys. */}
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
