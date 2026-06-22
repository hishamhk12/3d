"use client";

// Conversation area — hosts the Welcome hero (robot + title + subtitle + 3
// suggestion pills) when empty, otherwise the live messages list with inventory
// cards, a source badge, the loading "thinking" bubble, and a compact recoverable
// error state with retry. Ported visuals; technical/voice paths removed.
import { forwardRef } from "react";
import Image from "next/image";
import { summaryText } from "@/lib/seller/chat/format";
import {
  InventoryProductCard,
  groupInventoryByProduct,
} from "@/components/seller/chat/InventoryProductCard";
import type { ChatMessage } from "@/components/seller/chat/types";

interface Props {
  messages: ChatMessage[];
  loading: boolean;
  suggestions: string[];
  robotSrc: string;
  onAsk: (q: string) => void;
  onRetry: (messageId: string, question: string) => void;
}

const ChatMessages = forwardRef<HTMLDivElement, Props>(function ChatMessages(
  { messages, loading, suggestions, robotSrc, onAsk, onRetry },
  ref,
) {
  return (
    <div
      ref={ref}
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden overscroll-contain px-5 pb-6 pt-3"
    >
      {messages.length === 0 && (
        <div className="flex flex-col items-center gap-3 px-2 pt-4 text-center">
          <div className="sc-robot-wrap">
            <Image
              src={robotSrc}
              alt=""
              aria-hidden
              width={150}
              height={161}
              draggable={false}
              priority
              className="sc-robot block h-auto w-[150px] select-none"
            />
          </div>
          <h2 className="text-[20px] font-semibold leading-snug text-[#003a7d]">
            مرحباً بك في مساعد المخزون
          </h2>
          <p className="max-w-[300px] text-sm leading-relaxed text-[#5b6770]">
            استخدم الذكاء الاصطناعي لمعرفة الكميات المتاحة، التوفر حسب المستودع،
            وتواريخ الوصول المتوقعة.
          </p>
          <div className="flex w-full flex-col items-center gap-3 pt-2">
            {suggestions.slice(0, 3).map((s) => (
              <button
                key={s}
                onClick={() => onAsk(s)}
                disabled={loading}
                className="sc-pill max-w-[88%] whitespace-normal rounded-full border border-black/10 bg-black/5 px-[14px] py-[6px] text-sm text-black/80 transition hover:bg-black/[0.08] disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {messages.map((m) => {
        if (m.errorState) {
          const es = m.errorState;
          return (
            <div key={m.id} className="sc-bot-in w-full min-w-0 self-end">
              <div className="sc-shadow-card flex flex-col gap-2 rounded-[12px] border border-[#fa4616]/30 bg-[#fa4616]/10 px-4 py-3 text-sm text-[#fa4616]">
                <span>تعذّر الحصول على رد من المساعد. حاول مرة أخرى.</span>
                {es.kind === "retry" && (
                  <button
                    type="button"
                    onClick={() => onRetry(m.id, es.question)}
                    className="self-start rounded-lg border border-[#fa4616]/40 px-3 py-1 text-xs font-medium transition hover:bg-[#fa4616]/10"
                  >
                    إعادة المحاولة
                  </button>
                )}
              </div>
            </div>
          );
        }
        return (
          <div
            key={m.id}
            className={
              m.role === "user"
                ? "sc-user-in max-w-[88%] min-w-0 self-start"
                : "sc-bot-in w-full min-w-0 self-end"
            }
          >
            <div
              className={
                m.role === "user"
                  ? "sc-shadow-card inline-block rounded-[12px] rounded-bl-md bg-[#003a7d] px-4 py-2 text-white"
                  : `sc-shadow-card min-w-0 break-words rounded-[12px] px-4 py-3 [overflow-wrap:anywhere] ${
                      m.isError
                        ? "border border-[#fa4616]/30 bg-[#fa4616]/10 text-[#fa4616]"
                        : "border border-slate-200 bg-white text-slate-800"
                    }`
              }
            >
              <p className="whitespace-pre-wrap break-words leading-relaxed [overflow-wrap:anywhere]">
                {summaryText(m.text ?? "", !!(m.cards && m.cards.length > 0))}
              </p>

              {m.cards && m.cards.length > 0 && (
                <div className="mt-3 flex flex-col gap-3">
                  {groupInventoryByProduct(m.cards).map((g, i) => (
                    <InventoryProductCard key={g.productCode} group={g} index={i} />
                  ))}
                </div>
              )}

              {m.role === "bot" && !m.isError && m.mode && (
                <div className="mt-2 flex items-center gap-2">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      m.mode === "ai"
                        ? "bg-[#00afd7]/10 text-[#0090b4]"
                        : "bg-slate-200 text-[#5b6770]"
                    }`}
                  >
                    {m.mode === "ai" ? "AI: Gemini" : "Fallback"}
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {loading && (
        <div className="self-end">
          <div className="sc-loading sc-shadow-card rounded-[12px] border border-slate-200 bg-white px-4 py-2 text-[#5b6770]">
            جاري البحث…
          </div>
        </div>
      )}
    </div>
  );
});

export default ChatMessages;
