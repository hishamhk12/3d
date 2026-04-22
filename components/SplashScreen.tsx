"use client";

import { useState, useEffect } from "react";
import { CompanyLogo } from "@/components/CompanyLogo";

export default function SplashScreen({
  children,
}: {
  children: React.ReactNode;
}) {
  const [showSplash, setShowSplash] = useState(true);
  const [isFadingOut, setIsFadingOut] = useState(false);

  useEffect(() => {
    // Lock scroll during splash
    document.body.style.overflow = "hidden";

    // Wait for the SVG animation to finish playing before fading out (~1.5s)
    const timeout1 = setTimeout(() => {
      setIsFadingOut(true);
    }, 1600);

    // Completely remove splash screen from DOM
    const timeout2 = setTimeout(() => {
      setShowSplash(false);
      document.body.style.overflow = "unset";
    }, 2300);

    return () => {
      clearTimeout(timeout1);
      clearTimeout(timeout2);
      document.body.style.overflow = "unset";
    };
  }, []);

  return (
    <>
      {showSplash && (
        <div
          className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#e8f3fc] transition-opacity duration-700 ease-in-out ${
            isFadingOut ? "opacity-0 pointer-events-none" : "opacity-100"
          }`}
        >
          {/* We make the logo huge as requested */}
          <div className="relative h-48 w-[85vw] max-w-sm drop-shadow-xl">
            <CompanyLogo className="h-full w-full object-contain text-[#003C71]" />
          </div>
        </div>
      )}
      {/* Content is rendered in the DOM immediately so API calls fire on mount.
          It is visually hidden until the splash begins fading (2.8 s), then
          fades in alongside the splash fade-out. */}
      <div
        className={`w-full min-h-screen transition-opacity duration-1000 ${
          isFadingOut || !showSplash ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        {children}
      </div>
    </>
  );
}
