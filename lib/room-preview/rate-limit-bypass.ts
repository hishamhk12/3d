const RATE_LIMIT_DISABLED_LOG = "[room-preview] Rate limiting disabled for development";

declare global {
  var roomPreviewRateLimitBypassLogged: boolean | undefined;
}

export function isRoomPreviewRateLimitDisabled(): boolean {
  const disabled =
    process.env.NODE_ENV === "development" ||
    process.env.ROOM_PREVIEW_DISABLE_RATE_LIMIT === "true";

  if (disabled && !globalThis.roomPreviewRateLimitBypassLogged) {
    console.info(RATE_LIMIT_DISABLED_LOG);
    globalThis.roomPreviewRateLimitBypassLogged = true;
  }

  return disabled;
}
