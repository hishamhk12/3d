import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { jwtVerify, decodeJwt } from "jose";
import {
  isSellerChatEnabled,
  getChatbotFastapiUrl,
  mintExternalSellerToken,
} from "@/lib/seller/fastapi";

const EXTERNAL_SECRET = "external-seller-secret-0123456789abcdef-strong";
const SELLER = {
  id: "seller-xyz",
  name: "بائع",
  sellerCode: "S-9",
  showroomId: "showroom-9",
  showroomCode: "JEDDAH",
};

beforeEach(() => {
  vi.stubEnv("EXTERNAL_SELLER_JWT_SECRET", EXTERNAL_SECRET);
  vi.stubEnv("CHATBOT_FASTAPI_URL", "http://fastapi.internal:8001/");
  vi.stubEnv("SELLER_CHAT_ENABLED", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("mintExternalSellerToken", () => {
  it("mints an HS256 token with the strict external-seller claims", async () => {
    const token = await mintExternalSellerToken(SELLER);
    const { payload, protectedHeader } = await jwtVerify(
      token,
      new TextEncoder().encode(EXTERNAL_SECRET),
      { issuer: "3d-app", audience: "fastapi" },
    );
    expect(protectedHeader.alg).toBe("HS256");
    expect(payload.sub).toBe("3d-seller:seller-xyz");
    expect(payload.actorType).toBe("external_seller");
    expect(payload.showroomId).toBe("showroom-9");
    expect(payload.iss).toBe("3d-app");
    expect(payload.aud).toBe("fastapi");
  });

  it("uses a short ~60s TTL and carries no password/session/role claims", async () => {
    const token = await mintExternalSellerToken(SELLER);
    const payload = decodeJwt(token);
    const ttl = (payload.exp as number) - (payload.iat as number);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(120);
    expect(payload.role).toBeUndefined();
    expect(payload.password).toBeUndefined();
    expect(payload.tokenVersion).toBeUndefined();
  });

  it("throws (no insecure fallback) when the secret is missing or weak", async () => {
    vi.stubEnv("EXTERNAL_SELLER_JWT_SECRET", "");
    await expect(mintExternalSellerToken(SELLER)).rejects.toThrow(
      /EXTERNAL_SELLER_JWT_SECRET/,
    );
    vi.stubEnv("EXTERNAL_SELLER_JWT_SECRET", "change-me-short");
    await expect(mintExternalSellerToken(SELLER)).rejects.toThrow(
      /EXTERNAL_SELLER_JWT_SECRET/,
    );
  });
});

describe("config helpers", () => {
  it("isSellerChatEnabled honours the flag and dev default", () => {
    vi.stubEnv("SELLER_CHAT_ENABLED", "true");
    expect(isSellerChatEnabled()).toBe(true);
    vi.stubEnv("SELLER_CHAT_ENABLED", "false");
    expect(isSellerChatEnabled()).toBe(false);
    vi.stubEnv("SELLER_CHAT_ENABLED", "");
    expect(isSellerChatEnabled()).toBe(true); // dev default (NODE_ENV !== production)
  });

  it("getChatbotFastapiUrl trims trailing slashes", () => {
    expect(getChatbotFastapiUrl()).toBe("http://fastapi.internal:8001");
  });

  it("getChatbotFastapiUrl throws when unset", () => {
    vi.stubEnv("CHATBOT_FASTAPI_URL", "");
    expect(() => getChatbotFastapiUrl()).toThrow(/CHATBOT_FASTAPI_URL/);
  });
});
