// Chat message text formatting (render layer only) — ported from the chatbot's
// lib/chat/format.ts. When structured cards are present we strip the duplicated
// product list lines from the answer text so the same products are not shown
// twice (the cards are the source of truth). Without cards the text is unchanged.

/** A markdown-ish list line: "- ...", "• ...", "* ...", or "1. ..." / "1) ...". */
export function isListLine(line: string): boolean {
  const t = line.trim();
  return /^[-•*]\s+/.test(t) || /^\d+[.)]\s+/.test(t);
}

/**
 * Text to render for an assistant message. With cards, drop the duplicated
 * product list lines and keep the summary; without cards, return text unchanged.
 * Falls back to the original text if stripping would leave nothing.
 */
export function summaryText(text: string, hasCards: boolean): string {
  if (!hasCards || !text) return text;
  const kept = text
    .split("\n")
    .filter((line) => !isListLine(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return kept || text;
}
