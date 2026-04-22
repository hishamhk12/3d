import { ROOM_PREVIEW_ROUTES, ROOM_PREVIEW_TIMEOUTS } from "@/lib/room-preview/constants";
import type {
  ConnectRoomPreviewSessionResponse,
  CreateRoomPreviewSessionResponse,
  RoomPreviewSession,
  RoomPreviewSessionResponse,
} from "@/lib/room-preview/types";
import {
  assertValidResponse,
  isConnectRoomPreviewSessionResponse,
  isRoomPreviewApiErrorResponse,
  isRoomPreviewSessionResponse,
} from "@/lib/room-preview/validators";


export type RoomPreviewRequestErrorCode =
  | "timeout"
  | "not_found"
  | "expired"
  | "invalid_response"
  | "network"
  | "server";

export class RoomPreviewRequestError extends Error {
  code: RoomPreviewRequestErrorCode;
  status?: number;

  constructor(
    code: RoomPreviewRequestErrorCode,
    message: string,
    options?: {
      status?: number;
    },
  ) {
    super(message);
    this.name = "RoomPreviewRequestError";
    this.code = code;
    this.status = options?.status;
  }
}

function getErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof RoomPreviewRequestError) {
    return error.message;
  }

  return error instanceof Error ? error.message : fallbackMessage;
}

function createTimeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  // iOS throttles setTimeout in background tabs, so AbortController alone is
  // not reliable.  We also expose a manual abort so the caller can race the
  // fetch against a parallel timer promise if needed.
  return {
    signal: controller.signal,
    didTimeOut: () => timedOut,
    clear: () => clearTimeout(timeoutId),
    forceAbort: () => {
      timedOut = true;
      controller.abort();
    },
  };
}

/**
 * Returns a promise that rejects after `ms` milliseconds.
 * Used to race against fetch() so we get a timeout even when the browser
 * throttles setTimeout (iOS background tabs, some Android WebViews).
 */
function rejectAfter(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error("timeout")), ms),
  );
}

function assertRoomPreviewResponse<T>(
  data: unknown,
  isValid: (value: unknown) => value is T,
  message: string,
) {
  try {
    return assertValidResponse(data, isValid, message);
  } catch {
    throw new RoomPreviewRequestError("invalid_response", message);
  }
}

export async function requestRoomPreviewJson(
  input: string,
  init: RequestInit,
  fallbackMessage: string,
  timeoutMs: number = ROOM_PREVIEW_TIMEOUTS.REQUEST_MS,
) {
  const timeout = createTimeoutSignal(timeoutMs);
  let response: Response;

  const headers = new Headers(init.headers);

  try {
    // Race the fetch against an independent promise-based timer.
    // This ensures timeout fires even when the browser throttles setTimeout
    // (iOS background tabs, some Android WebViews).
    response = await Promise.race([
      fetch(input, {
        ...init,
        headers,
        signal: timeout.signal,
      }),
      rejectAfter(timeoutMs),
    ]);
  } catch (error) {
    timeout.clear();

    const isAbortOrTimeout =
      timeout.didTimeOut() ||
      (error instanceof Error && (error.message === "timeout" || error.name === "AbortError"));

    if (isAbortOrTimeout) {
      throw new RoomPreviewRequestError("timeout", "The request timed out. Please try again.");
    }

    throw new RoomPreviewRequestError("network", getErrorMessage(error, fallbackMessage));
  }

  timeout.clear();

  let data: unknown;

  try {
    data = await response.json();
  } catch {
    throw new RoomPreviewRequestError("invalid_response", "The server returned an invalid response.", {
      status: response.status,
    });
  }

  if (!response.ok) {
    if (isRoomPreviewApiErrorResponse(data)) {
      if (data.code === "SESSION_NOT_FOUND") {
        throw new RoomPreviewRequestError("not_found", data.error, {
          status: response.status,
        });
      }

      if (data.code === "SESSION_EXPIRED") {
        throw new RoomPreviewRequestError("expired", data.error, {
          status: response.status,
        });
      }

      throw new RoomPreviewRequestError("server", data.error, {
        status: response.status,
      });
    }

    throw new RoomPreviewRequestError("server", fallbackMessage, {
      status: response.status,
    });
  }

  return data;
}

export function isRoomPreviewRequestError(
  error: unknown,
): error is RoomPreviewRequestError {
  return error instanceof RoomPreviewRequestError;
}

export function getRoomPreviewErrorLogDetails(error: unknown) {
  if (error instanceof RoomPreviewRequestError) {
    return JSON.stringify({
      code: error.code,
      message: error.message,
      name: error.name,
      stack: error.stack ?? null,
      status: error.status ?? null,
    });
  }

  if (error instanceof Error) {
    return JSON.stringify({
      code: null,
      message: error.message,
      name: error.name,
      stack: error.stack ?? null,
      status: null,
    });
  }

  return JSON.stringify({
    code: null,
    message: String(error),
    name: typeof error,
    stack: null,
    status: null,
  });
}

/**
 * Ask the server to store the session token in an HttpOnly cookie so it is
 * never exposed in the URL, browser history, or proxy logs.
 *
 * The server verifies the token is valid for the given sessionId before
 * writing the cookie — an invalid token is rejected with 400.
 *
 * Throws `RoomPreviewRequestError` on failure.
 */
export async function storeScreenSessionToken(
  sessionId: string,
  token: string,
): Promise<void> {
  const response = await fetch(ROOM_PREVIEW_ROUTES.screenTokenApi(sessionId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new RoomPreviewRequestError(
      "server",
      "Could not store session token securely. Please retry.",
      { status: response.status },
    );
  }
}

export async function createRoomPreviewSession(screenToken?: string) {
  const headers: Record<string, string> = {};
  if (screenToken) headers["x-screen-token"] = screenToken;

  const data = await requestRoomPreviewJson(
    ROOM_PREVIEW_ROUTES.sessionsApi,
    {
      method: "POST",
      cache: "no-store",
      headers,
    },
    "Could not create a QR test session.",
  );

  const session = assertRoomPreviewResponse<RoomPreviewSession>(
    data,
    isRoomPreviewSessionResponse,
    "The server did not return a valid session.",
  );

  // The server also returns a `token` field alongside the session.
  const token =
    typeof (data as Record<string, unknown>).token === "string"
      ? ((data as Record<string, unknown>).token as string)
      : undefined;

  return {
    sessionId: session.id,
    token,
  } satisfies CreateRoomPreviewSessionResponse;
}

export async function fetchRoomPreviewSession(sessionId: string) {
  const data = await requestRoomPreviewJson(
    ROOM_PREVIEW_ROUTES.sessionApi(sessionId),
    {
      cache: "no-store",
    },
    "Could not load this session.",
  );

  return assertRoomPreviewResponse<RoomPreviewSessionResponse>(
    data,
    isRoomPreviewSessionResponse,
    "The server returned invalid session data.",
  );
}

export async function connectRoomPreviewSession(sessionId: string) {
  const data = await requestRoomPreviewJson(
    ROOM_PREVIEW_ROUTES.connectSessionApi(sessionId),
    {
      method: "POST",
      cache: "no-store",
    },
    "Could not confirm this session connection.",
  );

  return assertRoomPreviewResponse<ConnectRoomPreviewSessionResponse>(
    data,
    isConnectRoomPreviewSessionResponse,
    "The server returned an invalid connection response.",
  );
}

export async function createRenderForSession(sessionId: string) {
  const data = await requestRoomPreviewJson(
    ROOM_PREVIEW_ROUTES.renderApi(sessionId),
    {
      method: "POST",
      cache: "no-store",
    },
    "Could not trigger rendering session.",
    ROOM_PREVIEW_TIMEOUTS.RENDER_TRIGGER_MS,
  );

  return assertRoomPreviewResponse<RoomPreviewSessionResponse>(
    data,
    isRoomPreviewSessionResponse,
    "The server returned an invalid render response.",
  );
}
