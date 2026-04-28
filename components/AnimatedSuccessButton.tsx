"use client";

import { useState, useEffect, type CSSProperties } from "react";
import { ArrowUp, Check } from "lucide-react";

type ButtonState = "idle" | "loading" | "success";

const confettiColors = ["#4f46e5", "#818cf8", "#c084fc", "#6366f1", "#a855f7"];

function seededRandom(seed: number) {
  const x = Math.sin(seed * 997) * 10000;
  return x - Math.floor(x);
}

const confettiParticles = Array.from({ length: 14 }).map((_, i) => {
  const angle = (i * 360) / 14 + (seededRandom(i + 1) * 20 - 10);
  const distance = 40 + seededRandom(i + 2) * 40;
  const startRotation = seededRandom(i + 4) * 360;

  return {
    id: i,
    x: Math.cos((angle * Math.PI) / 180) * distance,
    y: Math.sin((angle * Math.PI) / 180) * distance,
    size: 3 + seededRandom(i + 3) * 4,
    startRotation,
    endRotation: startRotation + (seededRandom(i + 5) * 180 - 90),
    color: confettiColors[Math.floor(seededRandom(i + 6) * confettiColors.length)],
    duration: 0.8 + seededRandom(i + 7) * 0.4,
  };
});

export function AnimatedSuccessButton() {
  const [state, setState] = useState<ButtonState>("idle");

  useEffect(() => {
    if (state === "loading") {
      const timer = setTimeout(() => {
        setState("success");
      }, 1500);
      return () => clearTimeout(timer);
    }
    
    if (state === "success") {
      const timer = setTimeout(() => {
        setState("idle");
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [state]);

  const handleClick = () => {
    if (state === "idle") {
      setState("loading");
    }
  };

  return (
    <div className="relative flex items-center justify-center">
      <button
        onClick={handleClick}
        disabled={state !== "idle"}
        className="relative flex items-center justify-center overflow-hidden rounded-full bg-[#0a1526] text-white shadow-[0_8px_20px_rgba(10,21,38,0.15)] transition-[width,transform,opacity] duration-500 ease-out active:scale-95 disabled:cursor-default"
        style={{ height: 48, width: state === "loading" ? 48 : 140 }}
      >
        {state === "idle" && (
          <div className="button-state-in flex items-center gap-2">
            <ArrowUp className="size-4 text-blue-400" strokeWidth={2.5} />
            <span className="text-sm font-semibold tracking-wide">Submit</span>
          </div>
        )}

        {state === "loading" && (
          <div className="button-state-in flex items-center justify-center gap-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="loading-dot size-1.5 rounded-full bg-white/70"
                style={{ animationDelay: `${i * 0.12}s` }}
              />
            ))}
          </div>
        )}

        {state === "success" && (
          <div className="button-state-in flex items-center gap-2">
            <Check className="size-4 text-emerald-400" strokeWidth={3} />
            <span className="text-sm font-semibold tracking-wide">Success</span>
          </div>
        )}
      </button>

      {/* Confetti Burst */}
      {state === "success" && (
        <div className="pointer-events-none absolute inset-0">
          {confettiParticles.map((particle) => (
            <span
              key={particle.id}
              className="success-confetti-piece absolute left-1/2 top-1/2 rounded-sm"
              style={{
                width: particle.size,
                height: particle.size,
                backgroundColor: particle.color,
                "--confetti-x": `${particle.x}px`,
                "--confetti-y": `${particle.y}px`,
                "--confetti-start-rotation": `${particle.startRotation}deg`,
                "--confetti-end-rotation": `${particle.endRotation}deg`,
                animationDuration: `${particle.duration}s`,
              } as CSSProperties}
            />
          ))}
        </div>
      )}
    </div>
  );
}
