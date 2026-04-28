"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ROOM_PREVIEW_ROUTES } from "@/lib/room-preview/constants";

type State = "activating" | "redirecting" | "error";

export function ActivationHandler({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>("activating");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    const hash = window.location.hash;
    const token = hash.startsWith("#t=") ? decodeURIComponent(hash.slice(3)) : "";

    // Strip the fragment from history immediately — even before the async POST —
    // so the token is never recoverable from the browser history entry.
    history.replaceState(null, "", window.location.pathname);

    if (!token) {
      // No token: back-navigation or direct URL visit. Go to the mobile page;
      // if the cookie is present the experience loads, otherwise the gate redirects.
      queueMicrotask(() => setState("redirecting"));
      router.replace(ROOM_PREVIEW_ROUTES.mobileSession(sessionId));
      return;
    }

    async function activate() {
      try {
        const res = await fetch(`/api/room-preview/sessions/${sessionId}/activate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
          cache: "no-store",
        });

        setState("redirecting");

        if (res.ok) {
          router.replace(ROOM_PREVIEW_ROUTES.mobileSession(sessionId));
        } else {
          router.replace(`/room-preview/gate/${sessionId}?error=invalid_session`);
        }
      } catch {
        setErrorMsg("تعذّر الاتصال بالخادم. تأكد من اتصالك بنفس الشبكة ثم أعد المحاولة.");
        setState("error");
      }
    }

    void activate();
  }, [sessionId, router]);

  if (state === "error") {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center px-6 gap-6"
        style={{ background: "var(--background, #e0d6df)" }}
      >
        <div className="bg-white/80 backdrop-blur-sm rounded-3xl border border-red-200 p-8 max-w-sm w-full text-center shadow-sm">
          <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-sm font-medium text-gray-800 mb-1">خطأ في الاتصال</p>
          <p className="text-xs text-gray-500 mb-6 leading-relaxed">{errorMsg}</p>
          <button
            onClick={() => window.location.reload()}
            className="w-full py-2.5 px-4 rounded-xl bg-[#0a1f3d] text-white text-sm font-medium
                       hover:bg-[#0a1f3d]/90 active:scale-[0.98] transition-all"
          >
            إعادة المحاولة
          </button>
        </div>
      </div>
    );
  }

  // "activating" | "redirecting" — show a spinner so the user never sees a blank page
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: "var(--background, #e0d6df)" }}
    >
      <div className="flex flex-col items-center gap-4">
        <div
          className="w-10 h-10 rounded-full border-[3px] border-[#0a1f3d]/20 border-t-[#0a1f3d] animate-spin"
          aria-label="جارٍ التحميل"
        />
        <p className="text-xs text-[#0a1f3d]/50">
          {state === "redirecting" ? "جارٍ التوجيه…" : "جارٍ التحقق…"}
        </p>
      </div>
    </div>
  );
}
