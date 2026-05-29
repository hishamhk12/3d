// Small, pure response builders and predicates used by the render route.
//
// Each function here is move-as-is: identical status code, identical body
// shape, identical control flow. No diagnostics, no side effects, no shared
// state — they are extracted purely to reduce the line count of route.ts.

import { NextResponse } from "next/server";
import type { RoomPreviewSession } from "@/lib/room-preview/types";

// ─── Dedupe ───────────────────────────────────────────────────────────────────

/**
 * True when the request inputs match a previously cached render result that
 * should be returned as-is. Skips dedup when the session is at result_ready:
 * the customer explicitly pressed "تعديل" to request a fresh render with the
 * same inputs.
 */
export function isCachedRenderHit(
  session: Pick<RoomPreviewSession, "renderResult" | "status">,
  screenFields: { lastRenderHash: string | null } | null | undefined,
  renderHash: string,
): boolean {
  return (
    screenFields?.lastRenderHash === renderHash &&
    session.renderResult !== null &&
    session.status !== "result_ready"
  );
}

/** 200 OK — returns the cached session body on dedup hit. */
export function cachedRenderResponse(session: RoomPreviewSession): NextResponse {
  return NextResponse.json(session, { status: 200 });
}

// ─── Catch-block response builders ────────────────────────────────────────────

/** 404 Not Found response built from a typed not-found error. */
export function sessionNotFoundResponse(
  error: { code: string; message: string },
): NextResponse {
  return NextResponse.json(
    { code: error.code, error: error.message },
    { status: 404 },
  );
}

/** 410 Gone response built from a typed expired error. */
export function sessionExpiredResponse(
  error: { code: string; message: string },
): NextResponse {
  return NextResponse.json(
    { code: error.code, error: error.message },
    { status: 410 },
  );
}

/** 400 Bad Request response built from a session transition error. */
export function sessionInvalidStateResponse(
  error: { code: string; message: string },
): NextResponse {
  return NextResponse.json(
    { code: error.code, error: error.message },
    { status: 400 },
  );
}

/** 500 Internal Server Error fallback for unexpected render-route failures. */
export function renderInternalErrorResponse(): NextResponse {
  return NextResponse.json(
    { error: "Failed to start render session." },
    { status: 500 },
  );
}
