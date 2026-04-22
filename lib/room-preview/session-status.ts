import type { RoomPreviewSessionStatus } from "./types";

// ─── Status groups ────────────────────────────────────────────────────────────

export const LIVE_STATUSES = [
  "created",
  "waiting_for_mobile",
  "mobile_connected",
  "room_selected",
  "product_selected",
  "ready_to_render",
  "rendering",
] as const satisfies readonly RoomPreviewSessionStatus[];

export const SUCCESS_STATUSES = [
  "result_ready",
  "completed",
] as const satisfies readonly RoomPreviewSessionStatus[];

export const CLOSED_STATUSES = [
  "expired",
] as const satisfies readonly RoomPreviewSessionStatus[];

export const PROBLEM_STATUSES = [
  "failed",
] as const satisfies readonly RoomPreviewSessionStatus[];

export type SessionStatusGroup = "live" | "success" | "closed" | "problem";

export const STATUS_GROUP: Readonly<Record<RoomPreviewSessionStatus, SessionStatusGroup>> = {
  created:            "live",
  waiting_for_mobile: "live",
  mobile_connected:   "live",
  room_selected:      "live",
  product_selected:   "live",
  ready_to_render:    "live",
  rendering:          "live",
  result_ready:       "success",
  completed:          "success",
  failed:             "problem",
  expired:            "closed",
};

// ─── Predicates ───────────────────────────────────────────────────────────────

export function isLiveStatus(status: string): boolean {
  return (LIVE_STATUSES as readonly string[]).includes(status);
}

/**
 * True when the session's wall-clock expiry has passed, regardless of whether
 * the cleanup job has run yet. Use this for display logic and service guards.
 *
 * null expiresAt = legacy orphan created before the expiry field was added.
 * Treat it as expired so old sessions never surface as active.
 */
export function isEffectivelyExpired(session: {
  status: string;
  expiresAt: string | null;
}): boolean {
  if (session.status === "expired") return true;
  if (session.expiresAt === null) return true;
  return new Date(session.expiresAt) <= new Date();
}
