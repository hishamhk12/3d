"use client";

// Visual port of 21st.dev's kokonutd/ai-input-with-loading (light mode): soft
// translucent bg-black/5 rounded-3xl field, right-aligned circular send button
// with an upward arrow, and a rotating black square while loading. The
// integration props (controlled value, real loading state, RTL textareaProps,
// inline product-code typeahead via inputRef) are kept so the seller chat
// behaves exactly as before.
import {
  useEffect,
  useRef,
  type ChangeEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { ArrowUp } from "lucide-react";
import { Textarea, type TextareaProps } from "@/components/ui/textarea";
import { useAutoResizeTextarea } from "@/hooks/use-auto-resize-textarea";
import { cn } from "@/lib/utils";

interface AIInputWithLoadingProps {
  value: string;
  onValueChange: (value: string, event: ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: (value: string) => void | Promise<void>;
  isLoading: boolean;
  minHeight?: number;
  maxHeight?: number;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  textareaProps?: Omit<TextareaProps, "value" | "onChange" | "disabled">;
  textareaClassName?: string;
  sendButtonClassName?: string;
  sendLabel: string;
}

export function AIInputWithLoading({
  value,
  onValueChange,
  onSubmit,
  isLoading,
  minHeight = 56,
  maxHeight = 144,
  inputRef,
  textareaProps,
  textareaClassName,
  sendButtonClassName,
  sendLabel,
}: AIInputWithLoadingProps) {
  const { textareaRef, adjustHeight } = useAutoResizeTextarea({ minHeight, maxHeight });
  const submittingRef = useRef(false);

  useEffect(() => {
    adjustHeight(value.length === 0);
  }, [adjustHeight, value]);

  function setTextareaRef(node: HTMLTextAreaElement | null) {
    textareaRef.current = node;
    if (inputRef) inputRef.current = node;
  }

  async function submit() {
    const trimmed = value.trim();
    if (!trimmed || isLoading || submittingRef.current) return;

    submittingRef.current = true;
    try {
      await onSubmit(trimmed);
    } finally {
      submittingRef.current = false;
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    textareaProps?.onKeyDown?.(event);
    if (event.defaultPrevented) return;

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  const { className: ignoredClassName, onKeyDown: ignoredOnKeyDown, ...restTextareaProps } =
    textareaProps ?? {};
  void ignoredClassName;
  void ignoredOnKeyDown;

  return (
    <div className="min-w-0 flex-1">
      <div className="relative">
        <Textarea
          {...restTextareaProps}
          ref={setTextareaRef}
          value={value}
          onChange={(event) => {
            onValueChange(event.target.value, event);
            adjustHeight();
          }}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          className={cn(
            // Soft translucent neutral field (light-mode AIInputWithLoading look).
            "w-full resize-none overflow-y-auto rounded-3xl border-none bg-black/5 py-4 pl-6 pr-10",
            "text-right text-base leading-[1.2] text-black placeholder:text-black/70",
            // Subtle persistent ring; a slightly stronger ring on focus.
            "ring-1 ring-black/10 transition focus-visible:ring-2 focus-visible:ring-black/20 focus-visible:outline-none",
            "disabled:cursor-not-allowed disabled:opacity-100 [&::-webkit-resizer]:hidden",
            textareaClassName,
          )}
          style={{ height: minHeight, minHeight, maxHeight }}
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={isLoading || !value.trim()}
          aria-label={sendLabel}
          title={sendLabel}
          className={cn(
            "sc-send absolute right-3 top-1/2 grid -translate-y-1/2 place-items-center rounded-xl bg-black/5 p-1.5 text-black transition disabled:opacity-40",
            sendButtonClassName,
          )}
        >
          {isLoading ? (
            <span
              aria-hidden
              className="h-4 w-4 animate-spin rounded-sm bg-black"
              style={{ animationDuration: "1.2s" }}
            />
          ) : (
            <ArrowUp
              aria-hidden
              className={cn("h-4 w-4 transition-opacity", value.trim() ? "opacity-100" : "opacity-30")}
            />
          )}
        </button>
      </div>
    </div>
  );
}
