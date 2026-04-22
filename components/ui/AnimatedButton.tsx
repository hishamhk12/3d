"use client";

import React, { ButtonHTMLAttributes, MouseEvent, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAnimatedNavigation } from "@/hooks/useAnimatedNavigation";

export interface AnimatedButtonProps {
  children?: React.ReactNode;
  href?: string;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  glowColor?: string;
  animationDelay?: number;
  disabled?: boolean;
  type?: ButtonHTMLAttributes<HTMLButtonElement>["type"];
  form?: string;
  "aria-label"?: string;
}

export function AnimatedButton({
  children,
  href,
  onClick,
  className = "",
  glowColor = "rgba(255, 255, 255, 0.4)",
  animationDelay = 400,
  disabled,
  type,
  form,
  "aria-label": ariaLabel,
}: AnimatedButtonProps) {
  const { navigate } = useAnimatedNavigation(animationDelay);
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([]);

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const id = Date.now();

    setRipples((prev) => [...prev, { id, x, y }]);

    setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== id));
    }, 600);

    if (onClick) {
      onClick(e);
    }

    if (href && !e.defaultPrevented) {
      navigate(href);
    }
  };

  return (
    <motion.button
      onClick={handleClick}
      whileHover={{ scale: 1.02, y: -2 }}
      whileTap={{ scale: 0.95 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className={`relative overflow-hidden transition-shadow hover:shadow-lg ${className}`}
      disabled={disabled}
      type={type}
      form={form}
      aria-label={ariaLabel}
    >
      <span className="relative z-10 flex h-full w-full items-center justify-center gap-2">
        {children}
      </span>

      <AnimatePresence>
        {ripples.map((ripple) => (
          <motion.span
            key={ripple.id}
            initial={{ top: ripple.y, left: ripple.x, scale: 0, opacity: 1 }}
            animate={{ scale: 4, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="pointer-events-none absolute z-0 rounded-full"
            style={{
              width: "100px",
              height: "100px",
              marginTop: "-50px",
              marginLeft: "-50px",
              background: `radial-gradient(circle, ${glowColor} 0%, transparent 70%)`,
            }}
          />
        ))}
      </AnimatePresence>
    </motion.button>
  );
}
