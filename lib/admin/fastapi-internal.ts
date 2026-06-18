import "server-only";

import { SignJWT } from "jose";

const INTERNAL_ADMIN_SUBJECT = "3d-admin";
const INTERNAL_ADMIN_AUDIENCE = "fastapi";
const TOKEN_TTL_SECONDS = 60;
const DEFAULT_TIMEOUT_MS = 8_000;

export type FastapiInternalErrorCode =
  | "configuration"
  | "timeout"
  | "network"
  | "upstream"
  | "invalid_json";

export type FastapiInternalResult<T> =
  | { ok: true; status: number; data: T }
  | {
      ok: false;
      status?: number;
      error: { code: FastapiInternalErrorCode; message: string };
    };

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: BodyInit;
  headers?: HeadersInit;
  timeoutMs?: number;
};

function safeError(code: FastapiInternalErrorCode, status?: number): FastapiInternalResult<never> {
  const messages: Record<FastapiInternalErrorCode, string> = {
    configuration: "Chatbot service is not configured.",
    timeout: "Chatbot service did not respond in time.",
    network: "Chatbot service is unavailable.",
    upstream: "Chatbot service returned an error.",
    invalid_json: "Chatbot service returned an invalid response.",
  };
  return { ok: false, status, error: { code, message: messages[code] } };
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function assertDistinctSecrets(internalSecret: string): void {
  const externalSellerSecret = process.env.EXTERNAL_SELLER_JWT_SECRET?.trim();
  const sellerSessionSecret = process.env.SELLER_SESSION_SECRET?.trim();

  if (externalSellerSecret && externalSellerSecret === internalSecret) {
    throw new Error("INTERNAL_JWT_SECRET must differ from EXTERNAL_SELLER_JWT_SECRET");
  }
  if (sellerSessionSecret && sellerSessionSecret === internalSecret) {
    throw new Error("INTERNAL_JWT_SECRET must differ from SELLER_SESSION_SECRET");
  }
  if (externalSellerSecret && sellerSessionSecret && externalSellerSecret === sellerSessionSecret) {
    throw new Error("EXTERNAL_SELLER_JWT_SECRET must differ from SELLER_SESSION_SECRET");
  }
}

function getFastapiBaseUrl(): string {
  return requiredEnv("CHATBOT_FASTAPI_URL").replace(/\/+$/, "");
}

function getInternalSecretBytes(): Uint8Array {
  const secret = requiredEnv("INTERNAL_JWT_SECRET");
  assertDistinctSecrets(secret);
  return new TextEncoder().encode(secret);
}

export async function createInternalAdminJwt(now = Math.floor(Date.now() / 1000)): Promise<string> {
  return new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(INTERNAL_ADMIN_SUBJECT)
    .setAudience(INTERNAL_ADMIN_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + TOKEN_TTL_SECONDS)
    .sign(getInternalSecretBytes());
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function parseJson<T>(response: Response): Promise<FastapiInternalResult<T>> {
  let data: T;
  try {
    data = (await response.json()) as T;
  } catch {
    return safeError("invalid_json", response.status);
  }

  if (!response.ok) {
    return safeError("upstream", response.status);
  }

  return { ok: true, status: response.status, data };
}

export async function internalAdminFetchJson<T>(
  path: string,
  options: RequestOptions = {},
): Promise<FastapiInternalResult<T>> {
  let token: string;
  let url: string;
  try {
    token = await createInternalAdminJwt();
    url = `${getFastapiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  } catch {
    return safeError("configuration");
  }

  try {
    const response = await fetchWithTimeout(
      url,
      {
        method: options.method ?? "GET",
        body: options.body,
        cache: "no-store",
        headers: {
          ...options.headers,
          Authorization: `Bearer ${token}`,
        },
      },
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    return parseJson<T>(response);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return safeError("timeout");
    }
    return safeError("network");
  }
}
