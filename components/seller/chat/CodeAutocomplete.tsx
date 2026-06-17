"use client";

// Inline product-code suggestions panel (renders ABOVE the composer; never covers
// the input or send button). Ported from the chatbot ChatClient inline dropdown.
// Presentational + accessible: role=listbox/option with aria-selected; selection
// inserts the CODE only and never submits the message (handled by the parent).
import { forwardRef } from "react";
import type { ProductSuggestion } from "@/lib/seller/chat/code-suggest";

interface Props {
  open: boolean;
  loading: boolean;
  error: boolean;
  suggestions: ProductSuggestion[];
  highlight: number;
  onHighlight: (index: number) => void;
  onChoose: (s: ProductSuggestion) => void;
}

const CodeAutocomplete = forwardRef<HTMLDivElement, Props>(function CodeAutocomplete(
  { open, loading, error, suggestions, highlight, onHighlight, onChoose },
  ref,
) {
  if (!open) return null;
  return (
    <div ref={ref} className="mx-5 mb-2 shrink-0">
      <div className="sc-dropdown-in sc-shadow-card overflow-hidden rounded-[14px] border border-slate-200 bg-white">
        {loading ? (
          <div className="px-4 py-3 text-[13px] text-[#5b6770]">جارٍ البحث…</div>
        ) : error ? (
          <div className="px-4 py-3 text-[13px] text-[#fa4616]">
            تعذّر جلب الاقتراحات. تابع الكتابة أو أرسل رسالتك.
          </div>
        ) : suggestions.length === 0 ? (
          <div className="px-4 py-3 text-[13px] text-[#5b6770]">لا توجد أكواد مطابقة.</div>
        ) : (
          <ul
            id="seller-chat-code-suggestions"
            role="listbox"
            aria-label="اقتراحات أكواد الأصناف"
            className="max-h-[40vh] overflow-y-auto"
          >
            {suggestions.map((s, i) => (
              <li
                key={s.code}
                role="option"
                aria-selected={i === highlight}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep input focus; select on click
                  onChoose(s);
                }}
                onMouseEnter={() => onHighlight(i)}
                className={`flex cursor-pointer items-center justify-between gap-3 px-4 py-2 transition ${
                  i === highlight ? "bg-[#00afd7]/10" : "hover:bg-slate-50"
                }`}
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] text-slate-700">{s.productName || s.code}</p>
                  {s.category && <p className="truncate text-[11px] text-[#5b6770]">{s.category}</p>}
                </div>
                <span dir="ltr" className="shrink-0 font-mono text-[13px] font-bold text-[#003a7d]">
                  {s.code}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
});

export default CodeAutocomplete;
