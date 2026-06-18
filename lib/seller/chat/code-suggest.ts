// Pure, UI-agnostic helpers for the composer's inline product-code typeahead —
// ported from the chatbot's lib/inventory/{code-suggest,code-fragment,normalize}.
// No identity, no stock data: these only detect/replace a code fragment in the
// Arabic sentence and fetch CODE-ONLY suggestions from the protected 3d route.

const EASTERN_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** Convert Arabic/Persian digits to ASCII (length-preserving). */
export function normalizeDigits(raw: unknown): string {
  return String(raw ?? "")
    .replace(/[٠-٩]/g, (d) => String(EASTERN_DIGITS.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)));
}

// A suggestion item. The FastAPI proxy returns code + label only; productName /
// category are optional so a richer source could populate them later.
export interface ProductSuggestion {
  code: string;
  label: string;
  productName?: string | null;
  category?: string | null;
}

// Characters that can appear inside a product-code fragment.
const CODE_CHAR = /[A-Za-z0-9/-]/;
const MEANINGFUL = /[A-Za-z0-9]/;

export interface CodeFragment {
  fragment: string;
  start: number;
  end: number;
}

/** Find the code-like token at the caret (defaults to end of text). */
export function detectCodeFragment(
  text: string,
  caret: number = text.length,
): CodeFragment | null {
  const norm = normalizeDigits(text); // length preserved → offsets stay valid
  const pos = Math.max(0, Math.min(caret, norm.length));
  let start = pos;
  let end = pos;
  while (start > 0 && CODE_CHAR.test(norm[start - 1])) start--;
  while (end < norm.length && CODE_CHAR.test(norm[end])) end++;
  if (end <= start) return null;
  const fragment = norm.slice(start, end);
  if (!MEANINGFUL.test(fragment)) return null;
  return { fragment, start, end };
}

/** Replace text[start:end] with `code`, preserving the rest of the sentence. */
export function replaceFragment(
  text: string,
  start: number,
  end: number,
  code: string,
): string {
  return text.slice(0, start) + code + text.slice(end);
}

export interface CodeSuggestionsResult {
  ok: boolean;
  suggestions: ProductSuggestion[];
}

/**
 * Fetch suggestions for the composer typeahead. Never throws — returns
 * { ok:false, suggestions:[] } on any network/HTTP error so a failed lookup
 * surfaces an inline state without ever blocking message submission.
 */
export async function fetchCodeSuggestions(
  endpoint: string,
  q: string,
  signal?: AbortSignal,
): Promise<CodeSuggestionsResult> {
  try {
    const res = await fetch(`${endpoint}?q=${encodeURIComponent(q)}`, {
      cache: "no-store",
      signal,
    });
    if (!res.ok) return { ok: false, suggestions: [] };
    const data = await res.json();
    return {
      ok: true,
      suggestions: Array.isArray(data) ? (data as ProductSuggestion[]) : [],
    };
  } catch {
    return { ok: false, suggestions: [] };
  }
}

/** New highlighted index for an arrow key (wraps); -1 when there are none. */
export function nextHighlight(
  current: number,
  key: "ArrowDown" | "ArrowUp",
  count: number,
): number {
  if (count <= 0) return -1;
  if (key === "ArrowDown") return current >= count - 1 ? 0 : current + 1;
  return current <= 0 ? count - 1 : current - 1;
}

/** The code at `index`, or null if out of range (used by Enter/click select). */
export function selectAt(
  suggestions: ProductSuggestion[],
  index: number,
): string | null {
  return index >= 0 && index < suggestions.length ? suggestions[index].code : null;
}

/** Minimal trailing debounce with a cancel(), used for the typeahead fetch. */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
): ((...args: A) => void) & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const debounced = (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
  };
  return debounced;
}
