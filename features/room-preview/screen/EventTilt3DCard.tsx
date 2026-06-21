"use client";

import * as React from "react";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "framer-motion";

/*
 * Motion logic extracted VERBATIM from the installed 21st.dev component
 * `components/3d-card.tsx` (InteractiveTravelCard). Every spring / rotation /
 * depth value below is copied from that component unchanged. The ONLY
 * adaptation is the trigger: instead of mouse hover driving the motion values,
 * a session-event change replays the exact same movement once.
 */

// ── Original values from components/3d-card.tsx (do not change) ──────────────
const SPRING_CONFIG = { damping: 15, stiffness: 150 };
const ROTATE_INPUT: [number, number] = [-0.5, 0.5];
const ROTATE_X_OUTPUT = ["10.5deg", "-10.5deg"];
const ROTATE_Y_OUTPUT = ["-10.5deg", "10.5deg"];
const CONTENT_DEPTH = "translateZ(50px)";

// The original drives mouseX/mouseY within the [-0.5, 0.5] domain on hover and
// resets to 0 on mouse-leave. To REPLAY that same movement on an event we push
// to the top of that same input domain, then release back to rest (0) — reusing
// the original springs/transforms, introducing no new motion values. The dwell
// is trigger timing only (not a spring/rotation/depth value).
const TILT_PEAK = 0.5;
const TILT_RELEASE_MS = 450;

export interface EventTilt3DCardProps {
  /** When this value changes (after mount), the original 3D movement replays once. */
  trigger: unknown;
  className?: string;
  children: React.ReactNode;
}

/**
 * Wraps a card with the installed 3D-card tilt motion, replayed on a real
 * session event instead of on hover. The motion plays only when `trigger`
 * actually changes (so polling that returns identical values never replays),
 * and is disabled entirely for users who prefer reduced motion (static card).
 */
export function EventTilt3DCard({ trigger, className, children }: EventTilt3DCardProps) {
  const prefersReducedMotion = useReducedMotion();

  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const springX = useSpring(mouseX, SPRING_CONFIG);
  const springY = useSpring(mouseY, SPRING_CONFIG);
  const rotateX = useTransform(springY, ROTATE_INPUT, ROTATE_X_OUTPUT);
  const rotateY = useTransform(springX, ROTATE_INPUT, ROTATE_Y_OUTPUT);

  // Tracks the last trigger value so the motion replays only on a real change
  // (initialised to the mount value → no replay on first render / reload).
  const prevTrigger = React.useRef(trigger);

  React.useEffect(() => {
    if (Object.is(prevTrigger.current, trigger)) return;
    prevTrigger.current = trigger;
    if (prefersReducedMotion) return;

    // Replay the original tilt, then release back to rest (as handleMouseLeave does).
    mouseX.set(TILT_PEAK);
    mouseY.set(TILT_PEAK);
    const releaseId = window.setTimeout(() => {
      mouseX.set(0);
      mouseY.set(0);
    }, TILT_RELEASE_MS);
    return () => window.clearTimeout(releaseId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  return (
    <motion.div
      style={{ rotateX, rotateY, transformStyle: "preserve-3d", width: "fit-content", height: "fit-content" }}
      className={className}
    >
      <div style={{ transform: CONTENT_DEPTH, transformStyle: "preserve-3d" }}>{children}</div>
    </motion.div>
  );
}
