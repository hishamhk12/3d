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

export const ParticleButton = forwardRef<HTMLButtonElement, ParticleButtonProps>(
function ParticleButton({
    children,
    onClick,
    successDuration = 1000,
    particleClassName,
    showParticles = true,
    canTrigger,
    className,
    disabled,
    ...props
  }, ref) {
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

  async function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (disabled || (canTrigger && !canTrigger())) return;

    if (showParticles && !prefersReducedMotion) {
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

    await onClick?.(event);
  }

  return (
    <>
      {particleBurst ? (
        <SuccessParticles
          origin={particleBurst.origin}
          vectors={particleBurst.vectors}
          particleClassName={particleClassName}
        />
      ) : null}
      <button
        ref={ref}
        {...props}
        disabled={disabled}
        onClick={handleClick}
        className={cn(
          isPressed && "scale-95",
          className,
        )}
      >
        {children}
      </button>
    </>
  );
});
