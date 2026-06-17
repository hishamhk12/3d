"use client";

// iMessage-style composer (Figma "Message (iPhone)") adapted for the seller chat:
// a Creative/Balanced/Precise mode selector, a presentational camera glyph, a
// rounded RTL text field, and a green circular send button inside the field.
// Owns the inline product-code typeahead (debounced fetch from the protected 3d
// route, fragment detect/replace, keyboard nav). Voice/mic is intentionally
// removed. Selecting a suggestion inserts the CODE only and never submits.
import { useEffect, useMemo, useRef, useState } from "react";
import CodeAutocomplete from "@/components/seller/chat/CodeAutocomplete";
import {
  debounce,
  detectCodeFragment,
  fetchCodeSuggestions,
  nextHighlight,
  replaceFragment,
  selectAt,
  type ProductSuggestion,
} from "@/lib/seller/chat/code-suggest";

export type ChatStyle = "creative" | "balanced" | "precise";

const STYLES: { value: ChatStyle; label: string }[] = [
  { value: "creative", label: "إبداعي" },
  { value: "balanced", label: "متوازن" },
  { value: "precise", label: "دقيق" },
];

const CODE_ENDPOINT = "/api/seller/inventory/code-suggestions";
const MAX_QUESTION = 500;

export default function ChatComposer({
  style,
  onStyleChange,
  loading,
  placeholder,
  onSend,
}: {
  style: ChatStyle;
  onStyleChange: (s: ChatStyle) => void;
  loading: boolean;
  placeholder: string;
  onSend: (text: string) => void;
}) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const [codeSugs, setCodeSugs] = useState<ProductSuggestion[]>([]);
  const [codeOpen, setCodeOpen] = useState(false);
  const [codeHighlight, setCodeHighlight] = useState(-1);
  const [codeLoading, setCodeLoading] = useState(false);
  const [codeError, setCodeError] = useState(false);
  const codeFragRef = useRef<{ start: number; end: number } | null>(null);
  const codeAbortRef = useRef<AbortController | null>(null);
  const codePanelRef = useRef<HTMLDivElement>(null);

  const runCodeSearch = useMemo(
    () =>
      debounce(async (fragment: string) => {
        codeAbortRef.current?.abort();
        const ac = new AbortController();
        codeAbortRef.current = ac;
        const { ok, suggestions } = await fetchCodeSuggestions(CODE_ENDPOINT, fragment, ac.signal);
        if (ac.signal.aborted) return;
        setCodeLoading(false);
        setCodeError(!ok);
        setCodeSugs(suggestions.slice(0, 8));
        setCodeHighlight(-1);
        setCodeOpen(true);
      }, 250),
    [],
  );

  function closeCodeMenu() {
    runCodeSearch.cancel();
    codeAbortRef.current?.abort();
    codeFragRef.current = null;
    setCodeOpen(false);
    setCodeSugs([]);
    setCodeLoading(false);
    setCodeError(false);
    setCodeHighlight(-1);
  }

  function onComposerChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setInput(value);
    const caret = e.target.selectionStart ?? value.length;
    const frag = detectCodeFragment(value, caret);
    if (!frag) {
      closeCodeMenu();
      return;
    }
    codeFragRef.current = { start: frag.start, end: frag.end };
    setCodeError(false);
    setCodeLoading(true);
    setCodeOpen(true);
    runCodeSearch(frag.fragment);
  }

  function chooseCodeSuggestion(s: ProductSuggestion) {
    const frag = codeFragRef.current;
    if (!frag) return;
    const next = replaceFragment(input, frag.start, frag.end, s.code);
    setInput(next);
    const caret = frag.start + s.code.length;
    closeCodeMenu();
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        try {
          el.setSelectionRange(caret, caret);
        } catch {
          /* unsupported — ignore */
        }
      }
    });
  }

  function onComposerKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!codeOpen) return; // menu closed → Enter submits the form
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (codeSugs.length === 0) return;
      e.preventDefault();
      setCodeHighlight((h) => nextHighlight(h, e.key as "ArrowDown" | "ArrowUp", codeSugs.length));
    } else if (e.key === "Enter") {
      // While the menu is open, Enter never sends: it selects or just closes.
      e.preventDefault();
      const code = selectAt(codeSugs, codeHighlight);
      if (code) chooseCodeSuggestion(codeSugs[codeHighlight]);
      else closeCodeMenu();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeCodeMenu();
    }
  }

  // Close the suggestions on an outside click.
  useEffect(() => {
    if (!codeOpen) return;
    function onDocMouseDown(ev: MouseEvent) {
      const t = ev.target as Node;
      if (codePanelRef.current?.contains(t)) return;
      if (inputRef.current?.contains(t)) return;
      closeCodeMenu();
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeOpen]);

  function submit() {
    const q = input.trim();
    if (!q || loading) return;
    closeCodeMenu();
    setInput("");
    onSend(q);
  }

  return (
    <>
      <CodeAutocomplete
        ref={codePanelRef}
        open={codeOpen}
        loading={codeLoading}
        error={codeError}
        suggestions={codeSugs}
        highlight={codeHighlight}
        onHighlight={setCodeHighlight}
        onChoose={chooseCodeSuggestion}
      />

      {/* Mode selector (tone/verbosity only — never inventory facts). */}
      <div dir="rtl" className="flex items-center justify-center gap-1.5 px-5 pb-1 pt-1">
        {STYLES.map((s) => (
          <button
            key={s.value}
            type="button"
            onClick={() => onStyleChange(s.value)}
            aria-pressed={style === s.value}
            className={`sc-pill rounded-full border px-3 py-1 text-xs transition ${
              style === s.value
                ? "border-[#003a7d] bg-[#003a7d] text-white"
                : "border-slate-300 bg-white text-[#5b6770] hover:bg-slate-50"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="mx-5 h-px shrink-0 bg-[#eeeeeb]" />

      <form
        dir="ltr"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex shrink-0 items-center gap-2 px-3 pb-5 pt-2"
      >
        {/* Camera — presentational (no image-upload in inventory chat). */}
        <button
          type="button"
          aria-label="الكاميرا"
          title="الكاميرا"
          disabled={loading}
          tabIndex={-1}
          className="grid h-9 w-9 shrink-0 place-items-center text-[#8e8e93] transition disabled:opacity-50"
        >
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="h-[26px] w-[26px]"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H8l1.2-1.8A1 1 0 0 1 10 4.8h4a1 1 0 0 1 .83.45L16 7h2.5A1.5 1.5 0 0 1 20 8.5V17a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17V8.5Z" />
            <circle cx="12" cy="12.5" r="3.2" />
          </svg>
        </button>

        <div className="relative min-w-0 flex-1">
          <input
            ref={inputRef}
            value={input}
            onChange={onComposerChange}
            onKeyDown={onComposerKeyDown}
            placeholder={placeholder}
            dir="rtl"
            disabled={loading}
            maxLength={MAX_QUESTION}
            role="combobox"
            aria-expanded={codeOpen}
            aria-autocomplete="list"
            aria-controls="seller-chat-code-suggestions"
            className="h-9 w-full rounded-full border border-[#d1d1d6] bg-white pl-4 pr-11 text-sm text-[#0f1721] outline-none transition placeholder:text-[#aeaeb2] focus:border-[#aeaeb2]"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            aria-label="إرسال"
            title="إرسال"
            className="sc-send absolute right-1 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full bg-[#34c759] text-white transition hover:brightness-95 disabled:opacity-40"
          >
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="h-[18px] w-[18px]"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 19V6M6.5 11.5 12 6l5.5 5.5" />
            </svg>
          </button>
        </div>
      </form>
    </>
  );
}
