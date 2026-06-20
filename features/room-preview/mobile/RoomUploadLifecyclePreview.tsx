"use client";

import { useState } from "react";
import {
  RoomUploadStatus,
  type RoomUploadStatusState,
} from "@/features/room-preview/mobile/RoomUploadStatus";

const STATES: RoomUploadStatusState[] = ["idle", "uploading", "success", "error"];

const STATE_LABEL: Record<RoomUploadStatusState, string> = {
  idle: "Idle",
  uploading: "Uploading",
  success: "Success",
  error: "Error",
};

const PILL_BTN =
  "flex h-14 w-full items-center justify-center rounded-[32px] text-lg font-bold text-white " +
  "transition-all duration-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed";
const PRIMARY_BTN_STYLE = { background: "#192126", boxShadow: "0 10px 26px rgba(25,33,38,0.28)" } as const;

export default function RoomUploadLifecyclePreview() {
  const [state, setState] = useState<RoomUploadStatusState>("idle");

  function playHappyPath() {
    setState("uploading");
    window.setTimeout(() => setState("success"), 1100);
    window.setTimeout(() => setState("idle"), 2100);
  }

  function playFailurePath() {
    setState("uploading");
    window.setTimeout(() => setState("error"), 1100);
  }

  return (
    <main dir="rtl" className="min-h-screen bg-white px-6 text-[var(--text-primary)]">
      <section className="mx-auto flex min-h-screen w-full max-w-[393px] flex-col items-center justify-center py-6 text-center">
        <div className="mb-6 flex w-full flex-wrap justify-center gap-2">
          {STATES.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setState(item)}
              data-active={state === item ? "true" : "false"}
              className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 transition data-[active=true]:border-[#003A7D] data-[active=true]:bg-[#003A7D] data-[active=true]:text-white"
            >
              {STATE_LABEL[item]}
            </button>
          ))}
        </div>

        <div className="mx-auto flex w-full max-w-[345px] flex-col items-center">
          <h1 className="font-display text-center text-2xl font-semibold text-[var(--text-primary)]">
            ارفع صورة غرفتك
          </h1>
          <p className="mx-auto mt-3 max-w-xs text-center text-sm leading-7 text-[var(--text-secondary)]">
            اختر صورة واضحة لتجربة المنتج داخل مساحتك.
          </p>

          <div
            aria-live="polite"
            aria-busy={state === "uploading" ? "true" : undefined}
            className="group mt-6 flex w-full flex-col items-center justify-center gap-4 rounded-[40px] border border-[var(--border)] bg-[var(--bg-surface)] p-3 shadow-[var(--shadow-lg)] transition-all duration-300"
          >
            <div className="flex min-h-[180px] w-full flex-col items-center justify-center gap-4 rounded-[32px] border border-[var(--brand-cyan)]/25 bg-[var(--brand-cyan)]/[0.05] px-6 py-10">
              <RoomUploadStatus state={state} onRetry={playHappyPath} />
            </div>
          </div>

          {state === "idle" ? (
            <button type="button" className={`${PILL_BTN} mt-5 focus-visible:ring-[#192126]/45`} style={PRIMARY_BTN_STYLE}>
              اختيار صورة من المعرض
            </button>
          ) : null}

          <p className="mt-4 text-center text-xs leading-6 text-[var(--text-muted)]">
            صوّر الغرفة بشكل أفقي وبإضاءة واضحة.
          </p>
        </div>

        <div className="mt-8 grid w-full max-w-[345px] grid-cols-2 gap-3">
          <button
            type="button"
            onClick={playHappyPath}
            className="min-h-11 rounded-[15px] bg-[#003A7D] px-4 text-sm font-bold text-white"
          >
            تشغيل النجاح
          </button>
          <button
            type="button"
            onClick={playFailurePath}
            className="min-h-11 rounded-[15px] border border-[#003A7D] bg-white px-4 text-sm font-bold text-[#003A7D]"
          >
            تشغيل الفشل
          </button>
        </div>
      </section>
    </main>
  );
}
