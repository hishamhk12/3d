// Centralized error classification helpers used by useMobileSession.ts.
//
// These thin wrappers replace ternary expressions that were repeated 14+ times
// across the hook. Each helper is a pure function — no React, no I/O, no side
// effects — and is byte-equivalent to the inline expressions it replaces.

import {
  isRoomPreviewRequestError,
  type RoomPreviewRequestErrorCode,
} from "@/lib/room-preview/session-client";

/**
 * Returns a human-readable string for any thrown value. Mirrors the inline
 * pattern `error instanceof Error ? error.message : String(error)` used in
 * diagnostics events, debug logs, and template literals.
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Returns the typed code of a `RoomPreviewRequestError`, or `null` for any
 * other thrown value. Used to populate the `code:` field of diagnostics events.
 */
export function getRequestErrorCode(
  error: unknown,
): RoomPreviewRequestErrorCode | null {
  return isRoomPreviewRequestError(error) ? error.code : null;
}

/**
 * Predicate: true when `error` is a `RoomPreviewRequestError` whose code
 * matches `code`. Centralizes the repeated `isRoomPreviewRequestError(e) &&
 * e.code === "..."` checks used in the render-failure recovery branches.
 */
export function hasRequestErrorCode(
  error: unknown,
  code: RoomPreviewRequestErrorCode,
): boolean {
  return isRoomPreviewRequestError(error) && error.code === code;
}
