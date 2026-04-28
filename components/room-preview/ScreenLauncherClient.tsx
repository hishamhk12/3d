"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import BrandedQrLoadingScreen from "@/components/room-preview/BrandedQrLoadingScreen";
import SessionStatePanel from "@/components/room-preview/SessionStatePanel";
import { useI18n } from "@/lib/i18n/provider";
import { ROOM_PREVIEW_ROUTES } from "@/lib/room-preview/constants";
import {
  createRoomPreviewSession,
  fetchRoomPreviewSession,
  isRoomPreviewRequestError,
  type RoomPreviewSessionCreateSource,
} from "@/lib/room-preview/session-client";
import { trackClientSessionEvent } from "@/lib/room-preview/session-diagnostics-client";
import type { RoomPreviewSession } from "@/lib/room-preview/types";

type ScreenLauncherState = "creating" | "failed";
const BRANDED_LOADING_MIN_MS = 2_000;
const SCREEN_SESSION_STORAGE_KEY = "room-preview:screen-session-id";
const SCREEN_SESSION_CREATE_LOCK_KEY = "room-preview:screen-session-create-lock";
const SCREEN_SESSION_CREATE_LOCK_TTL_MS = 30_000;
const TERMINAL_SESSION_STATUSES = new Set(["expired", "failed", "completed", "result_ready"]);

function logScreenSessionLifecycle(
  eventType: "screen_session_created" | "screen_session_reused" | "duplicate_session_create_blocked",
  metadata?: Record<string, unknown>,
) {
  console.info(`[room-preview] ${eventType}`, metadata ?? {});
}

function getStoredScreenSessionId() {
  try {
    return localStorage.getItem(SCREEN_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveScreenSessionId(sessionId: string) {
  try {
    localStorage.setItem(SCREEN_SESSION_STORAGE_KEY, sessionId);
  } catch {
    // Non-fatal: the in-memory lock still protects this mount.
  }
}

function clearStoredScreenSessionId(sessionId?: string | null) {
  try {
    if (!sessionId || localStorage.getItem(SCREEN_SESSION_STORAGE_KEY) === sessionId) {
      localStorage.removeItem(SCREEN_SESSION_STORAGE_KEY);
    }
  } catch {
    // Ignore unavailable storage.
  }
}

function isReusableScreenSession(session: RoomPreviewSession) {
  if (TERMINAL_SESSION_STATUSES.has(session.status)) return false;
  // Once a mobile user has connected (gate completed), don't reuse for next visitor.
  if (session.mobileConnected) return false;
  return !session.expiresAt || new Date(session.expiresAt).getTime() > Date.now();
}

async function validateStoredScreenSession() {
  const storedSessionId = getStoredScreenSessionId();
  if (!storedSessionId) {
    return null;
  }

  try {
    const session = await fetchRoomPreviewSession(storedSessionId);
    if (!isReusableScreenSession(session)) {
      clearStoredScreenSessionId(storedSessionId);
      return null;
    }
    return session;
  } catch {
    clearStoredScreenSessionId(storedSessionId);
    return null;
  }
}

function acquireScreenSessionCreateLock() {
  const now = Date.now();
  try {
    const existingRaw = localStorage.getItem(SCREEN_SESSION_CREATE_LOCK_KEY);
    const existing = Number(existingRaw?.split(":")[0] ?? "0");
    if (Number.isFinite(existing) && now - existing < SCREEN_SESSION_CREATE_LOCK_TTL_MS) {
      return null;
    }
    const token = `${now}:${crypto.randomUUID()}`;
    localStorage.setItem(SCREEN_SESSION_CREATE_LOCK_KEY, token);
    return token;
  } catch {
    return "__memory__";
  }
}

function releaseScreenSessionCreateLock(lockToken: string | null) {
  if (!lockToken || lockToken === "__memory__") {
    return;
  }

  try {
    if (localStorage.getItem(SCREEN_SESSION_CREATE_LOCK_KEY) === lockToken) {
      localStorage.removeItem(SCREEN_SESSION_CREATE_LOCK_KEY);
    }
  } catch {
    // Ignore unavailable storage.
  }
}

async function waitForReusableStoredScreenSession() {
  const deadline = Date.now() + SCREEN_SESSION_CREATE_LOCK_TTL_MS;
  while (Date.now() < deadline) {
    const session = await validateStoredScreenSession();
    if (session) {
      return session;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

export default function ScreenLauncherClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { dir, t } = useI18n();
  const [state, setState] = useState<ScreenLauncherState>("creating");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const screenSessionCreationLockRef = useRef(false);

  // Read the screen token from the URL once — safe to memo in state because the
  // launcher page is only rendered when the URL already contains the final param.
  const screenToken = searchParams.get("st") ?? undefined;
  const createSource: RoomPreviewSessionCreateSource =
    searchParams.get("source") === "hero_try_button" ? "hero_try_button" : "screen_launcher";

  useEffect(() => {
    let active = true;

    async function createSession() {
      if (screenSessionCreationLockRef.current) {
        logScreenSessionLifecycle("duplicate_session_create_blocked", { reason: "ref_lock" });
        return;
      }

      screenSessionCreationLockRef.current = true;
      const startedAt = Date.now();
      let createLockToken: string | null = null;
      setState("creating");
      setError(null);

      try {
        const reusableSession = await validateStoredScreenSession();
        if (reusableSession) {
          logScreenSessionLifecycle("screen_session_reused", { sessionId: reusableSession.id });
          void trackClientSessionEvent(reusableSession.id, {
            source: "screen",
            eventType: "screen_session_reused",
            level: "info",
            statusAfter: reusableSession.status,
          });

          router.replace(ROOM_PREVIEW_ROUTES.screenSession(reusableSession.id));
          return;
        }

        createLockToken = acquireScreenSessionCreateLock();
        if (!createLockToken) {
          logScreenSessionLifecycle("duplicate_session_create_blocked", { reason: "storage_lock" });
          const lockedSession = await waitForReusableStoredScreenSession();
          if (lockedSession) {
            logScreenSessionLifecycle("screen_session_reused", {
              sessionId: lockedSession.id,
              source: "storage_lock_wait",
            });
            void trackClientSessionEvent(lockedSession.id, {
              source: "screen",
              eventType: "screen_session_reused",
              level: "info",
              statusAfter: lockedSession.status,
              metadata: { source: "storage_lock_wait" },
            });

            router.replace(ROOM_PREVIEW_ROUTES.screenSession(lockedSession.id));
            return;
          }

          throw new Error("Another screen session creation is still in progress.");
        }

        const data = await createRoomPreviewSession(screenToken, {
          existingSessionId: getStoredScreenSessionId(),
          source: createSource,
        });
        saveScreenSessionId(data.sessionId);

        logScreenSessionLifecycle("screen_session_created", { sessionId: data.sessionId });
        void trackClientSessionEvent(data.sessionId, {
          source: "screen",
          eventType: "screen_session_created",
          level: "info",
        });

        const elapsed = Date.now() - startedAt;
        const remaining = Math.max(0, BRANDED_LOADING_MIN_MS - elapsed);

        // Only honour the minimum display time if the effect is still active.
        // If Strict Mode cleaned up the effect, skip the wait and navigate immediately.
        if (active && remaining > 0) {
          await new Promise((resolve) => setTimeout(resolve, remaining));
        }

        router.replace(ROOM_PREVIEW_ROUTES.screenSession(data.sessionId));
      } catch (createError) {
        if (!active) {
          return;
        }

        setState("failed");
        setError(
          isRoomPreviewRequestError(createError)
            ? createError.message
            : t.roomPreview.launcher.createFailed,
        );
      } finally {
        screenSessionCreationLockRef.current = false;
        releaseScreenSessionCreateLock(createLockToken);
      }
    }

    void createSession();

    return () => {
      active = false;
    };
  }, [attempt, createSource, router, screenToken, t.roomPreview.launcher.createFailed]);

  return (
    <>
      {state === "creating" ? (
        <BrandedQrLoadingScreen
          dir={dir}
          title={t.roomPreview.launcher.brandedLoadingTitle}
          description={t.roomPreview.launcher.brandedLoadingDescription}
        />
      ) : (
        <main className="relative min-h-screen overflow-hidden text-[#1d1d1f]">
          <div className="mx-auto flex min-h-screen max-w-3xl items-center justify-center px-4 py-10">
            <SessionStatePanel
              title={t.roomPreview.launcher.failedTitle}
              description={error ?? t.roomPreview.launcher.failedDescription}
              actions={[
                {
                  label: t.common.actions.retry,
                  onClick: () => setAttempt((current) => current + 1),
                },
                {
                  href: ROOM_PREVIEW_ROUTES.landing,
                  label: t.roomPreview.launcher.backToQrTest,
                  variant: "secondary",
                },
              ]}
            />
          </div>
        </main>
      )}
    </>
  );
}
