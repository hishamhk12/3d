"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowUp, Check } from "lucide-react";

type ButtonState = "idle" | "loading" | "success";

const confettiColors = ["#4f46e5", "#818cf8", "#c084fc", "#6366f1", "#a855f7"];

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
      <motion.button
        layout
        onClick={handleClick}
        disabled={state !== "idle"}
        className="relative flex items-center justify-center overflow-hidden rounded-full bg-[#0a1526] text-white shadow-[0_8px_20px_rgba(10,21,38,0.15)] disabled:cursor-default"
        style={{ height: 48 }}
        animate={{
          width: state === "loading" ? 48 : 140,
        }}
        transition={{ type: "spring", bounce: 0, duration: 0.5 }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {state === "idle" && (
            <motion.div
              key="idle"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15, transition: { duration: 0.2 } }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="flex items-center gap-2"
            >
              <ArrowUp className="size-4 text-blue-400" strokeWidth={2.5} />
              <span className="font-semibold tracking-wide text-sm">Submit</span>
            </motion.div>
          )}

          {state === "loading" && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.2 } }}
              className="flex items-center justify-center gap-1"
            >
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  className="size-1.5 rounded-full bg-white/70"
                  animate={{ y: ["0%", "-40%", "0%"] }}
                  transition={{
                    duration: 0.6,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: i * 0.12,
                  }}
                />
              ))}
            </motion.div>
          )}

          {state === "success" && (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, y: 15, transition: { duration: 0.2 } }}
              transition={{ duration: 0.4, type: "spring", bounce: 0 }}
              className="flex items-center gap-2"
            >
              <Check className="size-4 text-emerald-400" strokeWidth={3} />
              <span className="font-semibold tracking-wide text-sm">Success</span>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>

      {/* Confetti Burst */}
      <AnimatePresence>
        {state === "success" && (
          <div className="absolute inset-0 pointer-events-none">
            {Array.from({ length: 14 }).map((_, i) => {
              const angle = (i * 360) / 14 + (Math.random() * 20 - 10);
              const distance = 40 + Math.random() * 40;
              const x = Math.cos((angle * Math.PI) / 180) * distance;
              const y = Math.sin((angle * Math.PI) / 180) * distance;
              const size = 3 + Math.random() * 4;
              const startRotation = Math.random() * 360;
              const endRotation = startRotation + (Math.random() * 180 - 90);
              const color = confettiColors[Math.floor(Math.random() * confettiColors.length)];

              return (
                <motion.div
                  key={i}
                  className="absolute left-1/2 top-1/2 rounded-sm"
                  style={{
                    width: size,
                    height: size,
                    backgroundColor: color,
                    x: "-50%",
                    y: "-50%",
                  }}
                  initial={{ opacity: 1, x: "-50%", y: "-50%", rotate: startRotation }}
                  animate={{
                    opacity: 0,
                    x: `calc(-50% + ${x}px)`,
                    y: `calc(-50% + ${y}px)`,
                    rotate: endRotation,
                  }}
                  transition={{
                    duration: 0.8 + Math.random() * 0.4,
                    ease: [0.25, 1, 0.5, 1], // Custom strong ease out (deceleration)
                  }}
                />
              );
            })}
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
