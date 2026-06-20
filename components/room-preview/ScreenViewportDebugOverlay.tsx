"use client";

import { useEffect, useState } from "react";

type ViewportDebugState = {
  innerWidth: number;
  innerHeight: number;
  screenWidth: number;
  screenHeight: number;
  devicePixelRatio: number;
  visualViewportWidth: number | null;
  visualViewportHeight: number | null;
};

function readViewportDebugState(): ViewportDebugState {
  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    devicePixelRatio: window.devicePixelRatio,
    visualViewportWidth: window.visualViewport?.width ?? null,
    visualViewportHeight: window.visualViewport?.height ?? null,
  };
}

export default function ScreenViewportDebugOverlay() {
  const [state, setState] = useState<ViewportDebugState | null>(null);

  useEffect(() => {
    const update = () => setState(readViewportDebugState());
    update();

    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);

    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, []);

  if (!state) return null;

  return (
    <aside className="screen-viewport-debug" dir="ltr" aria-label="Screen viewport debug">
      <div>inner: {state.innerWidth} x {state.innerHeight}</div>
      <div>screen: {state.screenWidth} x {state.screenHeight}</div>
      <div>dpr: {state.devicePixelRatio}</div>
      <div>
        visualViewport:{" "}
        {state.visualViewportWidth === null || state.visualViewportHeight === null
          ? "n/a"
          : `${Math.round(state.visualViewportWidth)} x ${Math.round(state.visualViewportHeight)}`}
      </div>
    </aside>
  );
}
