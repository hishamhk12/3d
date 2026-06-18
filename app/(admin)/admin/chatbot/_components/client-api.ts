"use client";

// Tiny client fetch helper for the admin Chatbot tabs. Always no-store; returns a
// normalized { ok, status, data } so callers can render safe error messages
// without ever seeing internal upstream detail (the server routes already map
// errors to safe messages).
export interface ApiResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
}

export async function apiGet<T = unknown>(url: string): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as T;
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: {} as T };
  }
}

export async function apiSend<T = unknown>(
  url: string,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  body?: unknown,
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      cache: "no-store",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as T;
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: {} as T };
  }
}

export function errorMessage(r: { status: number; data: unknown }, fallback: string): string {
  if (r.status === 401) return "Your admin session has expired. Please sign in again.";
  const msg = (r.data as { error?: unknown } | null)?.error;
  return typeof msg === "string" ? msg : fallback;
}
