import "server-only";

// Server-only bridge from the 3d seller area to the existing chatbot FastAPI
// service. The browser NEVER calls FastAPI directly: a verified seller session is
// exchanged here for a SHORT-LIVED external-seller JWT, signed with
// EXTERNAL_SELLER_JWT_SECRET only. That secret is a SEPARATE trust boundary from
// SELLER_SESSION_SECRET (the seller cookie) and from INTERNAL_JWT_SECRET (the
// chatbot's own internal user token) — there is no fallback between them.
//
// Nothing here is ever exposed to the browser: not the URL, not the secret, not
// the minted token. The seller id and showroom come ONLY from the DB-resolved
// CurrentSeller, never from the request body.
import { SignJWT } from "jose";
import type { CurrentSeller } from "./account-access";

const ISSUER = "3d-app";
const AUDIENCE = "fastapi";
const ACTOR_TYPE = "external_seller";
const SUBJECT_PREFIX = "3d-seller:";
const TOKEN_TTL_SECONDS = 60; // short-lived; matches the FastAPI external contract
const MIN_SECRET_LENGTH = 32;

function isWeakSecret(value: string | undefined | null): boolean {
  if (!value) return true;
  const v = value.trim();
  if (v.length < MIN_SECRET_LENGTH) return true;
  const lower = v.toLowerCase();
  return lower.includes("change-me") || lower.includes("insecure");
}

/**
 * Resolve and validate EXTERNAL_SELLER_JWT_SECRET. In production it must be a
 * strong secret AND distinct from both SELLER_SESSION_SECRET and
 * INTERNAL_JWT_SECRET (separate trust boundaries; no shared key). In development
 * a missing/weak value throws too — there is no insecure dev fallback for a token
 * the external FastAPI service must cryptographically trust.
 */
function getExternalSellerSecret(): Uint8Array {
  const value = process.env.EXTERNAL_SELLER_JWT_SECRET;
  if (isWeakSecret(value)) {
    throw new Error(
      "EXTERNAL_SELLER_JWT_SECRET is missing, too short (< 32 chars), or a " +
        "placeholder. Set a strong EXTERNAL_SELLER_JWT_SECRET matching the FastAPI service.",
    );
  }
  const secret = (value as string).trim();
  if (process.env.NODE_ENV === "production") {
    const sellerSession = process.env.SELLER_SESSION_SECRET?.trim();
    const internal = process.env.INTERNAL_JWT_SECRET?.trim();
    if (secret === sellerSession || secret === internal) {
      throw new Error(
        "EXTERNAL_SELLER_JWT_SECRET must be different from SELLER_SESSION_SECRET " +
          "and INTERNAL_JWT_SECRET (separate trust boundaries; no shared key).",
      );
    }
  }
  return new TextEncoder().encode(secret);
}

/** Whether the seller-chat integration is enabled. Defaults to ON in dev, and
 *  requires SELLER_CHAT_ENABLED=true (or 1) to be enabled in production. */
export function isSellerChatEnabled(): boolean {
  const v = process.env.SELLER_CHAT_ENABLED?.toLowerCase();
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return process.env.NODE_ENV !== "production";
}

/** Base URL of the chatbot FastAPI service (server-only). Never sent to the
 *  browser. Trailing slashes are trimmed so path joins are predictable. */
export function getChatbotFastapiUrl(): string {
  const url = process.env.CHATBOT_FASTAPI_URL?.trim();
  if (!url) {
    throw new Error(
      "CHATBOT_FASTAPI_URL is not set. Point it at the chatbot FastAPI service " +
        "(server-only, private network).",
    );
  }
  return url.replace(/\/+$/, "");
}

/**
 * Mint a short-lived external-seller JWT for the FastAPI `/internal/chat`
 * contract. Claims carry only safe, DB-derived identity:
 *   sub = "3d-seller:<seller.id>", actorType = "external_seller",
 *   showroomId = seller.showroomId, iss = "3d-app", aud = "fastapi", iat, exp (~60s).
 * No password, no session JWT, no admin/internal role, no browser-provided ids.
 */
export async function mintExternalSellerToken(seller: CurrentSeller): Promise<string> {
  return new SignJWT({
    actorType: ACTOR_TYPE,
    showroomId: seller.showroomId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(`${SUBJECT_PREFIX}${seller.id}`)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(getExternalSellerSecret());
}

export interface FastapiChatPayload {
  question: string;
  style: "creative" | "balanced" | "precise";
}

export interface FastapiCallResult {
  /** Upstream HTTP status (only present when a response was received). */
  status?: number;
  /** Parsed upstream JSON (only present on a successful 2xx JSON response). */
  data?: unknown;
  /** Failure classification when no usable success response was produced. */
  error?:
    | "preflight_config"
    | "upstream_auth"
    | "upstream_status"
    | "upstream_invalid"
    | "timeout"
    | "unreachable";
}

const REQUEST_TIMEOUT_MS = 45_000; // bounded; covers Gemini retries (FastAPI maxDuration ~60s)

function isSellerFastapiPreflightError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.message.includes("EXTERNAL_SELLER_JWT_SECRET") ||
      err.message.includes("CHATBOT_FASTAPI_URL"))
  );
}

/**
 * Server-to-server call to FastAPI `/internal/chat` with a freshly minted
 * external-seller token and a bounded AbortController timeout. Never throws for
 * upstream conditions — returns a classified {@link FastapiCallResult} so the
 * route maps everything to a safe response without leaking upstream internals.
 */
export async function callFastapiChat(
  seller: CurrentSeller,
  payload: FastapiChatPayload,
): Promise<FastapiCallResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    const token = await mintExternalSellerToken(seller);
    const baseUrl = getChatbotFastapiUrl();
    res = await fetch(`${baseUrl}/internal/chat`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ question: payload.question, style: payload.style }),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { error: "timeout" };
    }
    if (isSellerFastapiPreflightError(err)) {
      return { error: "preflight_config" };
    }
    return { error: "unreachable" };
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 403) {
    return { status: res.status, error: "upstream_auth" };
  }
  if (!res.ok) {
    return { status: res.status, error: "upstream_status" };
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { status: res.status, error: "upstream_invalid" };
  }
  if (!data || typeof data !== "object" || typeof (data as { answer?: unknown }).answer !== "string") {
    return { status: res.status, error: "upstream_invalid" };
  }
  return { status: res.status, data };
}

/** Strip internal-only fields (e.g. the dev `debug` object) before returning the
 *  upstream chat payload to the browser. Keeps all keys a future copied UI needs:
 *  answer, cards, mode, intent, productCode, warehouse. */
export function sanitizeChatResponse(data: unknown): Record<string, unknown> {
  const obj = { ...(data as Record<string, unknown>) };
  delete obj.debug;
  return obj;
}

// ── Product-code autocomplete (the second external-accessible endpoint) ──────
export interface CodeSuggestion {
  code: string;
  label: string;
}

const MAX_SUGGEST_QUERY = 64;
const SUGGEST_TIMEOUT_MS = 8_000; // typeahead must stay snappy
const MAX_SUGGESTIONS = 8;

/**
 * Server-to-server call to FastAPI `/internal/inventory/code-suggestions` with a
 * freshly minted external-seller token. Returns CODE-ONLY items (never stock
 * quantities). Never throws and never leaks upstream detail: any failure (auth,
 * timeout, network, bad JSON) degrades to an empty list so the composer typeahead
 * fails open without blocking message submission.
 */
export async function callFastapiCodeSuggestions(
  seller: CurrentSeller,
  rawQuery: string,
): Promise<CodeSuggestion[]> {
  const query = (rawQuery ?? "").trim().slice(0, MAX_SUGGEST_QUERY);
  if (!query) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUGGEST_TIMEOUT_MS);
  try {
    const token = await mintExternalSellerToken(seller);
    const baseUrl = getChatbotFastapiUrl();
    const res = await fetch(
      `${baseUrl}/internal/inventory/code-suggestions?q=${encodeURIComponent(query)}`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal },
    );
    if (!res.ok) return [];
    const data: unknown = await res.json();
    if (!Array.isArray(data)) return [];
    return data
      .filter((d): d is { code: string; label?: unknown } => !!d && typeof (d as { code?: unknown }).code === "string")
      .slice(0, MAX_SUGGESTIONS)
      .map((d) => ({ code: d.code, label: typeof d.label === "string" ? d.label : d.code }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
