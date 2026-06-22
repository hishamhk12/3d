"use client";

import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

type ParticleVector = { x: number; y: number };
type ParticleOrigin = { x: number; y: number };

export interface ParticleButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  successDuration?: number;
  particleClassName?: string;
  showParticles?: boolean;
  canTrigger?: () => boolean;
}

function createParticleVectors(): ParticleVector[] {
  return Array.from({ length: 6 }, (_, index) => ({
    x: (index % 2 ? 1 : -1) * (Math.random() * 50 + 20),
    y: -Math.random() * 50 - 20,
  }));
}

function SuccessParticles({
  origin,
  vectors,
  particleClassName,
}: {
  origin: ParticleOrigin;
  vectors: ParticleVector[];
  particleClassName?: string;
}) {
  return createPortal(
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[10000]">
      {vectors.map((vector, index) => (
        <motion.span
          key={index}
          data-particle="true"
          className={cn(
            "fixed h-1 w-1 rounded-full bg-black",
            particleClassName,
          )}
          style={{ left: origin.x, top: origin.y }}
          initial={{ scale: 0, x: 0, y: 0 }}
          animate={{
            scale: [0, 1, 0],
            x: [0, vector.x],
            y: [0, vector.y],
          }}
          transition={{
            duration: 0.6,
            delay: index * 0.1,
            ease: "easeOut",
          }}
        />
      ))}
    </div>,
    document.body,
  );
}

interface UseParticleBurstOptions {
  successDuration?: number;
  particleClassName?: string;
  showParticles?: boolean;
}

/**
 * The reusable Particle Button animation: on `burst(event)` it emits six
 * particles from the clicked element's centre (via a body portal) and flags a
 * brief press scale-down for ~100ms. Returns `particles` (render it anywhere —
 * it portals to <body>) and `isPressed`. Respects prefers-reduced-motion and
 * cleans up its timers on unmount. Lets the same animation be attached to an
 * existing button without changing that button's markup or styling.
 */
export function useParticleBurst({
  successDuration = 1000,
  particleClassName,
  showParticles = true,
}: UseParticleBurstOptions = {}) {
  const [particleBurst, setParticleBurst] = useState<{
    origin: ParticleOrigin;
    vectors: ParticleVector[];
  } | null>(null);
  const [isPressed, setIsPressed] = useState(false);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefersReducedMotion = useReducedMotion();

  useEffect(
    () => () => {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    },
    [],
  );

  function burst(event: MouseEvent<HTMLElement>) {
    if (!showParticles || prefersReducedMotion) return;

    const rect = event.currentTarget.getBoundingClientRect();
    setParticleBurst({
      origin: {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      },
      vectors: createParticleVectors(),
    });

    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    clearTimerRef.current = setTimeout(() => {
      setParticleBurst(null);
      clearTimerRef.current = null;
    }, successDuration);

    setIsPressed(true);
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    pressTimerRef.current = setTimeout(() => {
      setIsPressed(false);
      pressTimerRef.current = null;
    }, 100);
  }

  const particles = particleBurst ? (
    <SuccessParticles
      origin={particleBurst.origin}
      vectors={particleBurst.vectors}
      particleClassName={particleClassName}
    />
  ) : null;

  return { burst, particles, isPressed };
}

export const ParticleButton = forwardRef<HTMLButtonElement, ParticleButtonProps>(
  function ParticleButton(
    {
      children,
      onClick,
      successDuration = 1000,
      particleClassName,
      showParticles = true,
      canTrigger,
      className,
      disabled,
      ...props
    },
    ref,
  ) {
    const { burst, particles, isPressed } = useParticleBurst({
      successDuration,
      particleClassName,
      showParticles,
    });

    async function handleClick(event: MouseEvent<HTMLButtonElement>) {
      if (disabled || (canTrigger && !canTrigger())) return;
      burst(event);
      await onClick?.(event);
    }

    return (
      <>
        {particles}
        <button
          ref={ref}
          {...props}
          disabled={disabled}
          onClick={handleClick}
          className={cn(isPressed && "scale-95", className)}
        >
          {children}
        </button>
      </>
    );
  },
);
