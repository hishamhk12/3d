"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

/**
 * Global hook to handle animated navigation.
 * Delays the actual route change to allow micro-interactions (like tap bounce) to finish.
 */
export function useAnimatedNavigation(defaultDelayMs: number = 400) {
  const router = useRouter();
  const [isNavigating, setIsNavigating] = useState(false);

  const navigate = useCallback(
    (href: string, delayMs?: number) => {
      const delay = delayMs ?? defaultDelayMs;
      setIsNavigating(true);

      // Allow the tap/click animation to complete before pushing the route
      setTimeout(() => {
        router.push(href);
        
        // Reset state after a short buffer to avoid flashes during route change
        setTimeout(() => setIsNavigating(false), 500);
      }, delay);
    },
    [router, defaultDelayMs]
  );

  return { navigate, isNavigating };
}
