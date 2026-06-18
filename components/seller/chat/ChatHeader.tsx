"use client";

// Seller-chat header — the Figma identity row: lavender avatar (neutral person
// glyph, NOT the blue mascot), greeting + live status subtitle, and a logout
// action on the end (replaces the chatbot's in-app Back button). Ported visual.
import SellerLogoutButton from "@/components/seller/SellerLogoutButton";

export type ChatBotState = "idle" | "thinking" | "answering" | "success" | "error";

const BUSY_STATUS_AR: Partial<Record<ChatBotState, string>> = {
  thinking: "يفكّر…",
  answering: "يُجيب…",
  error: "تنبيه",
};

export default function ChatHeader({
  state,
  sellerName,
  showroomCode,
}: {
  state: ChatBotState;
  sellerName: string;
  showroomCode: string;
}) {
  const ring =
    state === "error"
      ? "ring-[#fa4616]/40"
      : state === "idle" || state === "success"
        ? "ring-slate-200"
        : "ring-[#00afd7]/50";

  // At rest: safe seller/showroom identity. While busy: the live status.
  const subtitle = BUSY_STATUS_AR[state] ?? `${sellerName} — معرض ${showroomCode}`;

  return (
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
      <div className="flex items-center gap-3">
        <div
          className={`grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-[#dbd1fc] ring-2 ${ring}`}
        >
          <svg viewBox="0 0 24 24" className="h-7 w-7 text-[#6d5bae]" fill="currentColor" aria-hidden>
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
          </svg>
        </div>
        <div className="min-w-0 leading-tight">
          <p className="text-base font-semibold text-[#003a7d]">مرحباً 👋</p>
          <p className="truncate text-xs text-[#5b6770]">{subtitle}</p>
        </div>
      </div>
      <SellerLogoutButton />
    </header>
  );
}
