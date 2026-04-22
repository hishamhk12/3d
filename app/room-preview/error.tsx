"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { ROOM_PREVIEW_ROUTES } from "@/lib/room-preview/constants";

type ErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function RoomPreviewError({ error, reset }: ErrorProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-6 overflow-hidden bg-[#e0d6df] px-4 text-center text-[#1d1d1f]">
      <div className="rounded-[32px] border border-white/60 bg-white/40 p-10 shadow-sm backdrop-blur-md max-w-md w-full">
        <p className="text-[11px] font-bold tracking-[0.2em] text-[#003C71] uppercase">
          Room Preview
        </p>
        <h1 className="mt-4 text-3xl font-bold">Something went wrong</h1>
        <p className="mt-3 text-sm font-medium leading-6 text-[#4a4a52]">
          {error.message || "An unexpected error occurred in the room preview."}
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-xs text-[#8b7b8a]">
            Ref: {error.digest}
          </p>
        )}
        <div className="mt-8 flex flex-col gap-3">
          <button onClick={reset} className="glass-button w-full">
            Try again
          </button>
          <a
            href={ROOM_PREVIEW_ROUTES.landing}
            className="glass-button w-full bg-white/20 text-[#003C71]"
          >
            Back to Room Preview
          </a>
        </div>
      </div>
    </main>
  );
}
