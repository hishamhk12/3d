"use client";

import { useId, useState } from "react";
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

  return (
    <div className={`relative isolate overflow-hidden bg-[#071729] ${className}`}>
      <Image
        src={afterImageUrl}
        alt=""
        fill
        unoptimized={unoptimized}
        priority={priority}
        sizes={sizes}
        className="scale-110 object-cover object-center opacity-90 blur-2xl"
        aria-hidden
      />
      <div className="absolute inset-0 bg-black/35" aria-hidden />

      <Image
        src={afterImageUrl}
        alt={alt}
        fill
        unoptimized={unoptimized}
        priority={priority}
        sizes={sizes}
        className={`z-10 ${objectClass} object-center ${imageClassName}`}
      />

      <div
        className="absolute inset-0 z-20"
        style={{ clipPath: `inset(0 ${100 - beforeReveal}% 0 0)` }}
        aria-hidden
      >
        <Image
          src={beforeSrc}
          alt=""
          fill
          unoptimized={unoptimized}
          priority={priority}
          sizes={sizes}
          className="scale-110 object-cover object-center opacity-90 blur-2xl"
          aria-hidden
        />
        <div className="absolute inset-0 bg-black/35" aria-hidden />
        <Image
          src={beforeSrc}
          alt=""
          fill
          unoptimized={unoptimized}
          priority={priority}
          sizes={sizes}
          className={`${objectClass} object-center ${imageClassName}`}
        />
      </div>

      <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex items-center justify-between text-[11px] font-bold">
        <span className="rounded-full border border-white/15 bg-black/50 px-2.5 py-1 text-white/85 backdrop-blur-md">
          {afterLabel}
        </span>
        <span className="rounded-full border border-white/15 bg-black/50 px-2.5 py-1 text-white/85 backdrop-blur-md">
          {beforeLabel}
        </span>
      </div>

      <div
        className="pointer-events-none absolute inset-y-0 z-20 w-px bg-white/85 shadow-[0_0_18px_rgba(0,0,0,0.45)]"
        style={{ left: `${beforeReveal}%` }}
      />
      <div
        className="pointer-events-none absolute top-1/2 z-30 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/80 bg-white text-slate-950 shadow-[0_10px_30px_rgba(0,0,0,0.45)]"
        style={{ left: `${beforeReveal}%` }}
      >
        <span className="flex items-center gap-1 text-[15px] font-black leading-none" aria-hidden>
          <span>‹</span>
          <span>›</span>
        </span>
      </div>

      <label htmlFor={id} className="sr-only">
        {beforeLabel} / {afterLabel}
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        value={beforeReveal}
        onChange={(event) => setBeforeReveal(Number(event.target.value))}
        className="before-after-range absolute inset-0 z-40 h-full w-full cursor-ew-resize opacity-0"
        aria-label={`${beforeLabel} / ${afterLabel}`}
      />
    </div>
  );
}
