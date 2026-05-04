"use client";

import { useEffect, useRef, useState } from "react";

const INTERVAL_MS = 30_000;
const TERMINAL_STATUSES = new Set(["expired", "completed"]);

export interface ScreenHeartbeatState {
  isConnected: boolean;
  failedCount: number;
  lastSuccessAt: number | null;
}

export function useScreenHeartbeat(
  sessionId: string,
  sessionStatus: string | null | undefined,
): ScreenHeartbeatState {
  const [isConnected, setIsConnected] = useState(true);
  const [failedCount, setFailedCount] = useState(0);
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!sessionId || TERMINAL_STATUSES.has(sessionStatus ?? "")) {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    async function ping() {
      try {
        const res = await fetch(
          `/api/room-preview/sessions/${sessionId}/heartbeat`,
          { method: "POST" },
        );
        if (res.ok) {
          const body = await res.json() as { ok: boolean; terminal?: boolean };
          if (body.terminal) {
            clearInterval(intervalRef.current!);
            intervalRef.current = null;
            return;
          }
          setIsConnected(true);
          setFailedCount(0);
          setLastSuccessAt(Date.now());
        } else {
          setIsConnected(false);
          setFailedCount((n) => n + 1);
        }
      } catch {
        setIsConnected(false);
        setFailedCount((n) => n + 1);
      }
    }

    void ping();
    intervalRef.current = setInterval(ping, INTERVAL_MS);

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [sessionId, sessionStatus]);

  return { isConnected, failedCount, lastSuccessAt };
}
