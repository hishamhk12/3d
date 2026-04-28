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
    document.body.style.overflow = "hidden";

    const timeout1 = setTimeout(() => setIsFadingOut(true), 1600);
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
          className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[var(--bg-page)] transition-opacity duration-700 ease-in-out ${
            isFadingOut ? "opacity-0 pointer-events-none" : "opacity-100"
          }`}
        >
          <div className="relative h-48 w-[85vw] max-w-sm">
            <CompanyLogo className="h-full w-full object-contain text-[var(--brand-navy)]" />
          </div>
        </div>
      )}
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
