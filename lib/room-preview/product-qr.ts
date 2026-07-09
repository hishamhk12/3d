export const ROOM_PREVIEW_ACTIVE_SESSION_STORAGE_KEY = "room-preview.activeSessionId";

const RAW_PRODUCT_CODE_PATTERN = /^[A-Za-z0-9._-]+$/;

/** True when the value is a plausible product code / SKU (path-safe charset). */
export function isValidProductCode(value: string): boolean {
  return RAW_PRODUCT_CODE_PATTERN.test(value);
}

export function parseProductCodeFromQrValue(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const url = trimmed.startsWith("/")
      ? new URL(trimmed, "https://room-preview.local")
      : new URL(trimmed);
    const match = url.pathname.match(/^\/scan\/([^/?#]+)$/i);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    if (!RAW_PRODUCT_CODE_PATTERN.test(trimmed)) return null;
    return trimmed;
  }
}
