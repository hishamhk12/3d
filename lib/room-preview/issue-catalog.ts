export const SESSION_ISSUE_TYPES = [
  "MOBILE_UI_BLOCKED",
  "MOBILE_HYDRATION_STUCK",
  "MOBILE_RAPID_RELOAD",
  "MOBILE_EXCESSIVE_POLLING",
  "QR_OPENED_NO_MOBILE_CONNECT",
  "MOBILE_OPENED_NO_PROGRESS",
  "ROOM_UPLOAD_FAILED",
  "ROOM_UPLOAD_STUCK",
  "IMAGE_TOO_LARGE",
  "IMAGE_INVALID",
  "IMAGE_QUALITY_INSUFFICIENT",
  "FLOOR_NOT_VISIBLE",
  "RENDER_TIMEOUT",
  "RENDER_FAILED",
  "SCREEN_NOT_UPDATING",
  "SESSION_STUCK",
  "NETWORK_INTERRUPTED",
] as const;

export type SessionIssueType = (typeof SESSION_ISSUE_TYPES)[number];
export type SessionIssueSeverity = "warning" | "error" | "fatal";
export type SessionIssueStatus = "open" | "resolved" | "ignored";
export type CustomerMessageKey =
  | "retry_upload"
  | "retry_render"
  | "reload_page"
  | "retake_room_photo"
  | "reconnect_mobile";

export type SessionIssueDefinition = {
  adminMessage: string;
  customerMessageKey: CustomerMessageKey | null;
  recommendedAction: string | null;
  severity: SessionIssueSeverity;
  userVisible: boolean;
};

export const SESSION_ISSUE_CATALOG: Record<SessionIssueType, SessionIssueDefinition> = {
  MOBILE_UI_BLOCKED: {
    severity: "error",
    userVisible: true,
    customerMessageKey: "reload_page",
    adminMessage: "Mobile UI appears blocked or unresponsive.",
    recommendedAction: "Ask the customer to reload the mobile page and check for overlay or JS errors.",
  },
  MOBILE_HYDRATION_STUCK: {
    severity: "error",
    userVisible: true,
    customerMessageKey: "reload_page",
    adminMessage: "Mobile page loaded but hydration did not complete in time.",
    recommendedAction: "Reload the mobile page. Check browser console and bundle errors.",
  },
  QR_OPENED_NO_MOBILE_CONNECT: {
    severity: "warning",
    userVisible: true,
    customerMessageKey: "reconnect_mobile",
    adminMessage: "QR activation opened but the mobile client did not connect to the session.",
    recommendedAction: "Confirm the phone is on the same network and reopen the QR link.",
  },
  MOBILE_OPENED_NO_PROGRESS: {
    severity: "warning",
    userVisible: true,
    customerMessageKey: "reload_page",
    adminMessage: "Mobile page loaded but no room, product, or render progress followed.",
    recommendedAction: "Ask the customer to continue, reload, or start a fresh session if the UI is idle.",
  },
  ROOM_UPLOAD_FAILED: {
    severity: "error",
    userVisible: true,
    customerMessageKey: "retry_upload",
    adminMessage: "Room image upload failed.",
    recommendedAction: "Retry upload. If repeated, inspect file type, size, storage, and server logs.",
  },
  ROOM_UPLOAD_STUCK: {
    severity: "error",
    userVisible: true,
    customerMessageKey: "retry_upload",
    adminMessage: "Room upload started but did not complete within the threshold.",
    recommendedAction: "Ask the customer to retry upload and verify network stability.",
  },
  IMAGE_TOO_LARGE: {
    severity: "warning",
    userVisible: true,
    customerMessageKey: "retake_room_photo",
    adminMessage: "Uploaded room image exceeded the configured size limit.",
    recommendedAction: "Use a smaller or compressed image.",
  },
  IMAGE_INVALID: {
    severity: "warning",
    userVisible: true,
    customerMessageKey: "retake_room_photo",
    adminMessage: "Uploaded room image could not be decoded or validated.",
    recommendedAction: "Retake or choose another JPG/PNG/WebP image.",
  },
  IMAGE_QUALITY_INSUFFICIENT: {
    severity: "warning",
    userVisible: true,
    customerMessageKey: "retake_room_photo",
    adminMessage: "Room image quality appears insufficient for preview.",
    recommendedAction: "Retake a brighter, sharper photo with more floor visible.",
  },
  FLOOR_NOT_VISIBLE: {
    severity: "warning",
    userVisible: true,
    customerMessageKey: "retake_room_photo",
    adminMessage: "The uploaded room image may not show enough visible floor.",
    recommendedAction: "Ask for a new image with the floor clearly visible.",
  },
  RENDER_TIMEOUT: {
    severity: "error",
    userVisible: true,
    customerMessageKey: "retry_render",
    adminMessage: "Render did not complete before the timeout threshold.",
    recommendedAction: "Retry render. Check AI provider latency, queue capacity, and function duration.",
  },
  RENDER_FAILED: {
    severity: "error",
    userVisible: true,
    customerMessageKey: "retry_render",
    adminMessage: "Render pipeline failed.",
    recommendedAction: "Retry render. Inspect render job logs and provider response.",
  },
  SCREEN_NOT_UPDATING: {
    severity: "warning",
    userVisible: false,
    customerMessageKey: null,
    adminMessage: "Screen client stopped receiving session updates or fell back to polling.",
    recommendedAction: "Check SSE connectivity, Redis pub/sub, and screen network.",
  },
  SESSION_STUCK: {
    severity: "error",
    userVisible: false,
    customerMessageKey: null,
    adminMessage: "Session stayed active without expected progress for too long.",
    recommendedAction: "Review timeline, open issues, and consider resetting the session.",
  },
  MOBILE_RAPID_RELOAD: {
    severity: "warning",
    userVisible: false,
    customerMessageKey: null,
    adminMessage: "Mobile page reloaded multiple times within 10 seconds.",
    recommendedAction: "Check for iOS memory pressure, BFCache restore loops, or router.refresh calls in the session flow.",
  },
  MOBILE_EXCESSIVE_POLLING: {
    severity: "warning",
    userVisible: false,
    customerMessageKey: null,
    adminMessage: "Mobile client fired more than 6 session fetches within 10 seconds.",
    recommendedAction: "Check for a retry loop in the loadSession effect — likely caused by loadAttempt counter incrementing too fast.",
  },
  NETWORK_INTERRUPTED: {
    severity: "warning",
    userVisible: true,
    customerMessageKey: "reload_page",
    adminMessage: "Client network connection was interrupted.",
    recommendedAction: "Ask the customer to reload or reconnect to the showroom network.",
  },
};

export function isSessionIssueType(value: string): value is SessionIssueType {
  return (SESSION_ISSUE_TYPES as readonly string[]).includes(value);
}
