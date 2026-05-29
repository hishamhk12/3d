// Pure helpers and constants used by useMobileSession.ts.
//
// Each symbol here is move-as-is from the original hook file: identical
// behavior, identical return shapes, identical Arabic strings. Nothing in
// this file calls a React hook or touches React state — everything is
// importable from server or client code without any "use client" boundary.

import { isRoomPreviewRequestError } from "@/lib/room-preview/session-client";
import type { TranslationDictionary } from "@/lib/i18n/dictionaries";
import type { RoomPreviewSession } from "@/lib/room-preview/types";

// ─── Constants ────────────────────────────────────────────────────────────────

export const MOBILE_NETWORK_ERROR_MESSAGE =
  "تعذر الاتصال بالسيرفر، تأكد أن الجوال والكمبيوتر على نفس الشبكة";
export const MOBILE_INITIAL_LOAD_MAX_ATTEMPTS = 3;
export const MOBILE_INITIAL_LOAD_RETRY_DELAY_MS = 1_500;

// ─── Types ────────────────────────────────────────────────────────────────────

export type MobileSessionViewState =
  | "loading"
  | "ready"
  | "not_found"
  | "expired"
  | "failed";

export type SaveStatus = "idle" | "success" | "error";

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function isSessionConnected(session: RoomPreviewSession) {
  return session.mobileConnected;
}

export function getViewStateFromError(
  error: unknown,
  t: TranslationDictionary,
): { message: string; state: Exclude<MobileSessionViewState, "loading" | "ready"> } {
  if (isRoomPreviewRequestError(error)) {
    if (error.code === "not_found") return { state: "not_found", message: t.roomPreview.mobile.invalidLink };
    if (error.code === "expired")   return { state: "expired",   message: t.roomPreview.mobile.expiredLink };
    return { state: "failed", message: error.message };
  }
  return { state: "failed", message: t.roomPreview.mobile.loadFailed };
}

export function createActionErrorMessage(error: unknown, fallbackMessage: string) {
  if (isRoomPreviewRequestError(error)) return error.message;
  return error instanceof Error ? error.message : fallbackMessage;
}

export function wait(durationMs: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

export function isNetworkInterrupted(error: unknown) {
  return (
    (isRoomPreviewRequestError(error) && error.code === "network") ||
    (error instanceof TypeError && error.message === "Failed to fetch")
  );
}
