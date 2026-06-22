"use client";

import {
  useEffect,
  useRef,
  type ChangeEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
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
  minHeight = 36,
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
    <div className="relative min-w-0 flex-1">
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
          "min-h-0 w-full resize-none overflow-y-auto rounded-[18px] border border-[#d1d1d6] bg-white py-[7px] pl-4 pr-11 text-right text-sm leading-5 text-[#0f1721] outline-none transition placeholder:text-[#aeaeb2] focus:border-[#aeaeb2] focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-100",
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
          "sc-send absolute bottom-1 right-1 grid h-7 w-7 place-items-center rounded-full bg-[#34c759] text-white transition hover:brightness-95 disabled:opacity-40",
          sendButtonClassName,
        )}
      >
        {isLoading ? (
          <span
            aria-hidden
            className="h-4 w-4 animate-spin rounded-sm bg-white"
            style={{ animationDuration: "1.2s" }}
          />
        ) : (
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
        )}
      </button>
    </div>
  );
}
