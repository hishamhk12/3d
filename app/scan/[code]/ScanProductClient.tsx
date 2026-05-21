"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ROOM_PREVIEW_ACTIVE_SESSION_STORAGE_KEY } from "@/lib/room-preview/product-qr";

type ScanProductClientProps = {
  productCode: string;
};

export default function ScanProductClient({ productCode }: ScanProductClientProps) {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        setActiveSessionId(window.localStorage.getItem(ROOM_PREVIEW_ACTIVE_SESSION_STORAGE_KEY));
      } catch {
        setActiveSessionId(null);
      }
    });
  }, []);

  if (!activeSessionId) {
    return (
      <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
        Open this from the room preview session to use it in your room.
      </p>
    );
  }

  return (
    <div className="mt-4">
      <Link
        href={`/room-preview/mobile/${encodeURIComponent(activeSessionId)}?productCode=${encodeURIComponent(productCode)}`}
        className="inline-flex w-full items-center justify-center rounded-md bg-[var(--brand-gold)] px-5 py-3 text-sm font-bold text-[var(--text-on-gold)] transition hover:opacity-90 sm:w-auto"
      >
        Use this product in room preview
      </Link>
      <p className="mt-2 text-xs leading-5 text-[var(--text-secondary)]">
        This will return to your active mobile session.
      </p>
    </div>
  );
}
