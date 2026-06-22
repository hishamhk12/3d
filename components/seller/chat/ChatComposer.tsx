"use client";

// iMessage-style composer (Figma "Message (iPhone)") adapted for the seller chat:
// a Creative/Balanced/Precise mode selector, a presentational camera glyph, a
// rounded RTL text field, and a green circular send button inside the field.
// Owns the inline product-code typeahead (debounced fetch from the protected 3d
// route, fragment detect/replace, keyboard nav). Voice/mic is intentionally
// removed. Selecting a suggestion inserts the CODE only and never submits.
import { useEffect, useMemo, useRef, useState } from "react";
import { AIInputWithLoading } from "@/components/ui/ai-input-with-loading";
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
  onSend: (text: string) => void | Promise<void>;
}) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  function onComposerChange(value: string, e: React.ChangeEvent<HTMLTextAreaElement>) {
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

  function onComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
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

  function submit(value = input) {
    const q = value.trim();
    if (!q || loading) return;
    closeCodeMenu();
    setInput("");
    return onSend(q);
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

      <form
        dir="ltr"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex shrink-0 items-start gap-2 border-t border-slate-100 px-3 pt-3"
        style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
      >
        {/* Microphone — presentational placeholder (no audio capture wired yet).
            Same size / position / translucent style as the previous camera control. */}
        <button
          type="button"
          aria-label="الميكروفون"
          title="الميكروفون"
          disabled={loading}
          tabIndex={-1}
          className="mt-1.5 grid h-11 w-11 shrink-0 place-items-center rounded-full bg-black/5 text-black/70 ring-1 ring-black/10 transition hover:bg-black/[0.08] disabled:opacity-50"
        >
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="h-[24px] w-[24px]"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 3a2.5 2.5 0 0 0-2.5 2.5v5a2.5 2.5 0 0 0 5 0v-5A2.5 2.5 0 0 0 12 3Z" />
            <path d="M6.5 10.5a5.5 5.5 0 0 0 11 0" />
            <line x1="12" y1="16" x2="12" y2="21" />
            <line x1="9" y1="21" x2="15" y2="21" />
          </svg>
        </button>

        <AIInputWithLoading
          value={input}
          onValueChange={onComposerChange}
          onSubmit={submit}
          isLoading={loading}
          minHeight={56}
          maxHeight={144}
          inputRef={inputRef}
          sendLabel="إرسال"
          textareaProps={{
            placeholder,
            dir: "rtl",
            maxLength: MAX_QUESTION,
            role: "combobox",
            "aria-expanded": codeOpen,
            "aria-autocomplete": "list",
            "aria-controls": "seller-chat-code-suggestions",
            onKeyDown: onComposerKeyDown,
          }}
        />
      </form>
    </>
  );
}
