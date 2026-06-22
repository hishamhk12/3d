"use client";

// Seller-chat header — a minimal native-style top bar with a single back button
// (replaces the previous welcome/avatar strip and logout action).
import { useRouter } from "next/navigation";

export type ChatBotState = "idle" | "thinking" | "answering" | "success" | "error";

export default function ChatHeader(_props: {
  state: ChatBotState;
  sellerName: string;
  showroomCode: string;
}) {
  const router = useRouter();

  return (
    <header
      className="flex shrink-0 items-center justify-end border-b border-slate-100 px-3 py-2.5"
      style={{ paddingTop: "max(0.625rem, env(safe-area-inset-top))" }}
    >
      <button
        type="button"
        onClick={() => router.back()}
        aria-label="رجوع"
        title="رجوع"
        className="grid h-10 w-10 place-items-center rounded-full text-[#003a7d] transition hover:bg-slate-100 active:scale-95"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-6 w-6"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M15 18 9 12l6-6" />
        </svg>
      </button>
    </header>
  );
}
