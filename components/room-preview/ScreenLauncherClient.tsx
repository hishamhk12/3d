"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import SessionStatePanel from "@/components/room-preview/SessionStatePanel";
import { useI18n } from "@/lib/i18n/provider";
import { ROOM_PREVIEW_ROUTES } from "@/lib/room-preview/constants";
import {
  createRoomPreviewSession,
  isRoomPreviewRequestError,
  storeScreenSessionToken,
} from "@/lib/room-preview/session-client";

type ScreenLauncherState = "creating" | "failed";

export default function ScreenLauncherClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const [state, setState] = useState<ScreenLauncherState>("creating");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Read the screen token from the URL once — safe to memo in state because the
  // launcher page is only rendered when the URL already contains the final param.
  const screenToken = searchParams.get("st") ?? undefined;

  useEffect(() => {
    let active = true;

    async function createSession() {
      setState("creating");
      setError(null);

      try {
        const data = await createRoomPreviewSession(screenToken);

        if (!active) {
          return;
        }

        // Store the token in an HttpOnly cookie via the server so it is never
        // exposed in the URL, browser history, or proxy / CDN access logs.
        // The screen page reads it server-side from cookies() instead.
        if (data.token) {
          await storeScreenSessionToken(data.sessionId, data.token);
        }

        if (!active) {
          return;
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
      }
    }

    void createSession();

    return () => {
      active = false;
    };
  }, [attempt, router, screenToken, t.roomPreview.launcher.createFailed]);

  return (
    <main className="relative min-h-screen overflow-hidden text-[#1d1d1f]">
      <div className="mx-auto flex min-h-screen max-w-3xl items-center justify-center px-4 py-10">
        {state === "creating" ? (
          <div className="tour-panel w-full rounded-[32px] p-8 text-center">
            <p className="text-[11px] font-bold tracking-[0.2em] text-[#003C71] uppercase drop-shadow-sm">
              {t.roomPreview.shared.eyebrow}
            </p>
            <h1 className="mt-4 text-4xl font-bold text-[#1d1d1f]">
              {t.roomPreview.launcher.title}
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-sm font-medium leading-7 text-[#4a4a52]">
              {t.roomPreview.launcher.description}
            </p>
            <div className="mt-8 flex flex-col items-center gap-4">
              <LoaderCircle className="size-10 animate-spin" style={{color:'#003C71'}} />
              <p className="text-sm font-medium text-[#4a4a52]">
                {t.roomPreview.launcher.requestingSessionId}
              </p>
            </div>
          </div>
        ) : (
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
        )}
      </div>
    </main>
  );
}
