"use client";

import { useState } from "react";
import BrandedQrLoadingScreen from "@/components/room-preview/BrandedQrLoadingScreen";
import { AnimatedLink } from "@/components/ui/AnimatedLink";
import type { Direction } from "@/lib/i18n/types";

type RoomPreviewStartTransitionLinkProps = {
  children: React.ReactNode;
  description: string;
  dir: Direction;
  href: string;
  title: string;
};

export default function RoomPreviewStartTransitionLink({
  children,
  description,
  dir,
  href,
  title,
}: RoomPreviewStartTransitionLinkProps) {
  const [isStarting, setIsStarting] = useState(false);

  return (
    <>
      <AnimatedLink
        href={href}
        className="actome-button flex items-center justify-center text-center px-16 py-5 text-2xl font-bold"
        glowColor="rgba(255, 140, 50, 0.4)"
        animationDelay={0}
        onClick={() => setIsStarting(true)}
      >
        {children}
      </AnimatedLink>

      {isStarting ? (
        <div className="fixed inset-0 z-[100]">
          <BrandedQrLoadingScreen dir={dir} title={title} description={description} />
        </div>
      ) : null}
    </>
  );
}
