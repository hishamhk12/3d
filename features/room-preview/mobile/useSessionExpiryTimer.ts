"use client";

import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { RoomPreviewSession } from "@/lib/room-preview/types";
import type { MobileSessionViewState } from "@/features/room-preview/mobile/mobile-session-utils";

/**
 * Client-side expiry timer.
 *
 * Safety net: if the server hasn't notified about expiry yet (no SSE on
 * mobile), force the UI into expired state the moment wall-clock time is
 * reached so the customer sees the right message immediately.
 *
 * The body is moved verbatim from `useMobileSession.ts` — identical guard
 * (`viewState !== "ready" || !session?.expiresAt`), identical wall-clock
 * computation, identical synchronous transition for already-expired sessions,
 * identical `setTimeout` with `msUntilExpiry`, identical `clearTimeout` cleanup,
 * identical deps `[session?.expiresAt, viewState]`.
 *
 * No Arabic strings appear in this effect. No API calls are made.
 */
export interface UseSessionExpiryTimerParams {
  session: RoomPreviewSession | null;
  viewState: MobileSessionViewState;
  setSession: Dispatch<SetStateAction<RoomPreviewSession | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setViewState: Dispatch<SetStateAction<MobileSessionViewState>>;
}

export function useSessionExpiryTimer(params: UseSessionExpiryTimerParams): void {
  const { session, viewState, setSession, setError, setViewState } = params;

  useEffect(() => {
    if (viewState !== "ready" || !session?.expiresAt) return;

    const msUntilExpiry = new Date(session.expiresAt).getTime() - Date.now();

    if (msUntilExpiry <= 0) {
      setSession(null);
      setError(null);
      setViewState("expired");
      return;
    }

    const timer = setTimeout(() => {
      setSession(null);
      setError(null);
      setViewState("expired");
    }, msUntilExpiry);

    return () => clearTimeout(timer);
  }, [session?.expiresAt, viewState, setSession, setError, setViewState]);
}
