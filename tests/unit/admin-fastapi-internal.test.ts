import { jwtVerify } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInternalAdminJwt, internalAdminFetchJson } from "@/lib/admin/fastapi-internal";
import type { FastapiInternalResult } from "@/lib/admin/fastapi-internal";

const INTERNAL_SECRET = "internal-admin-secret-32-bytes-long";
const EXTERNAL_SECRET = "external-seller-secret-32-bytes-long";
const SELLER_SECRET = "seller-session-secret-32-bytes-long";
const FASTAPI_URL = "https://fastapi.internal.local";

function secretBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function setValidEnv() {
  process.env.CHATBOT_FASTAPI_URL = FASTAPI_URL;
  process.env.INTERNAL_JWT_SECRET = INTERNAL_SECRET;
  process.env.EXTERNAL_SELLER_JWT_SECRET = EXTERNAL_SECRET;
  process.env.SELLER_SESSION_SECRET = SELLER_SECRET;
}

function expectSafeErrorText(value: unknown) {
  const text = JSON.stringify(value);
  expect(text).not.toContain(INTERNAL_SECRET);
  expect(text).not.toContain(EXTERNAL_SECRET);
  expect(text).not.toContain(SELLER_SECRET);
  expect(text).not.toContain(FASTAPI_URL);
  expect(text).not.toContain("Authorization");
  expect(text).not.toContain("Bearer ");
}

function expectFailure<T>(result: FastapiInternalResult<T>): Extract<FastapiInternalResult<T>, { ok: false }> {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("Expected internal FastAPI call to fail");
  }
  return result;
}

beforeEach(() => {
  setValidEnv();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("internal admin FastAPI client", () => {
  it("creates an HS256 admin JWT with trusted subject, role, audience, and short expiration", async () => {
    const now = 1_800_000_000;
    const token = await createInternalAdminJwt(now);
    const { payload, protectedHeader } = await jwtVerify(token, secretBytes(INTERNAL_SECRET), {
      audience: "fastapi",
      subject: "3d-admin",
    });

    expect(protectedHeader.alg).toBe("HS256");
    expect(payload.role).toBe("admin");
    expect(payload.aud).toBe("fastapi");
    expect(payload.sub).toBe("3d-admin");
    expect(payload.iat).toBe(now);
    expect(payload.exp).toBe(now + 60);
  });

  it("uses INTERNAL_JWT_SECRET, not the seller secrets, for outbound admin calls", async () => {
    let authorization = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        authorization = new Headers(init.headers).get("Authorization") ?? "";
        return Response.json({ ready: true });
      }),
    );

    const result = await internalAdminFetchJson<{ ready: boolean }>("/internal/admin/status");

    expect(result).toEqual({ ok: true, status: 200, data: { ready: true } });
    const token = authorization.replace(/^Bearer\s+/, "");
    await expect(jwtVerify(token, secretBytes(INTERNAL_SECRET), { audience: "fastapi" })).resolves.toBeTruthy();
    await expect(jwtVerify(token, secretBytes(EXTERNAL_SECRET), { audience: "fastapi" })).rejects.toThrow();
    await expect(jwtVerify(token, secretBytes(SELLER_SECRET), { audience: "fastapi" })).rejects.toThrow();
  });

  it("rejects equal internal/external/seller secrets before calling FastAPI", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    process.env.INTERNAL_JWT_SECRET = EXTERNAL_SECRET;
    let result = expectFailure(await internalAdminFetchJson("/internal/admin/status"));
    expect(result.error.code).toBe("configuration");

    process.env.INTERNAL_JWT_SECRET = INTERNAL_SECRET;
    process.env.SELLER_SESSION_SECRET = INTERNAL_SECRET;
    result = expectFailure(await internalAdminFetchJson("/internal/admin/status"));
    expect(result.error.code).toBe("configuration");

    process.env.SELLER_SESSION_SECRET = SELLER_SECRET;
    process.env.EXTERNAL_SELLER_JWT_SECRET = SELLER_SECRET;
    result = expectFailure(await internalAdminFetchJson("/internal/admin/status"));
    expect(result.error.code).toBe("configuration");

    expect(fetchMock).not.toHaveBeenCalled();
    expectSafeErrorText(result);
  });

  it("maps request timeouts to safe normalized errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          }),
      ),
    );

    const result = expectFailure(await internalAdminFetchJson("/internal/admin/status", { timeoutMs: 1 }));

    expect(result.error.code).toBe("timeout");
    expect(result.error.message).toBe("Chatbot service did not respond in time.");
    expectSafeErrorText(result);
  });

  it("maps malformed JSON responses to safe normalized errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not-json", { status: 200 })),
    );

    const result = expectFailure(await internalAdminFetchJson("/internal/admin/status"));

    expect(result.error.code).toBe("invalid_json");
    expect(result.status).toBe(200);
    expectSafeErrorText(result);
  });
});
