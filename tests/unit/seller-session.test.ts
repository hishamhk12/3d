import { describe, it, expect } from "vitest";
import { SignJWT } from "jose";
import {
  createSellerToken,
  verifySellerToken,
  SELLER_SESSION_COOKIE,
  SELLER_SESSION_COOKIE_OPTIONS,
} from "@/lib/seller/session";

const SECRET = () =>
  new TextEncoder().encode(process.env.SELLER_SESSION_SECRET as string);

describe("seller session tokens", () => {
  it("round-trips sub + tokenVersion", async () => {
    const token = await createSellerToken({ id: "seller_1", tokenVersion: 3 });
    const claims = await verifySellerToken(token);
    expect(claims).toEqual({ sub: "seller_1", tokenVersion: 3 });
  });

  it("treats a missing tokenVersion claim as 0", async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("seller_2")
      .setIssuer("3d-app")
      .setAudience("seller")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(SECRET());
    expect(await verifySellerToken(token)).toEqual({ sub: "seller_2", tokenVersion: 0 });
  });

  it("rejects empty/undefined tokens", async () => {
    expect(await verifySellerToken(undefined)).toBeNull();
    expect(await verifySellerToken("")).toBeNull();
    expect(await verifySellerToken("not-a-jwt")).toBeNull();
  });

  it("rejects a wrong issuer", async () => {
    const token = await new SignJWT({ tokenVersion: 0 })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("seller_3")
      .setIssuer("evil")
      .setAudience("seller")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(SECRET());
    expect(await verifySellerToken(token)).toBeNull();
  });

  it("rejects a wrong audience", async () => {
    const token = await new SignJWT({ tokenVersion: 0 })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("seller_4")
      .setIssuer("3d-app")
      .setAudience("admin")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(SECRET());
    expect(await verifySellerToken(token)).toBeNull();
  });

  it("rejects a token signed with the wrong secret", async () => {
    const token = await new SignJWT({ tokenVersion: 0 })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("seller_5")
      .setIssuer("3d-app")
      .setAudience("seller")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("a-different-secret-that-is-32-bytes!!"));
    expect(await verifySellerToken(token)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await new SignJWT({ tokenVersion: 0 })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("seller_6")
      .setIssuer("3d-app")
      .setAudience("seller")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(SECRET());
    expect(await verifySellerToken(token)).toBeNull();
  });

  it("rejects a non-integer/negative tokenVersion claim", async () => {
    const make = async (tv: unknown) =>
      new SignJWT({ tokenVersion: tv as number })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject("seller_7")
        .setIssuer("3d-app")
        .setAudience("seller")
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(SECRET());
    expect(await verifySellerToken(await make("3"))).toBeNull();
    expect(await verifySellerToken(await make(-1))).toBeNull();
    expect(await verifySellerToken(await make(1.5))).toBeNull();
  });

  it("uses a dedicated, secure cookie name + options", () => {
    expect(SELLER_SESSION_COOKIE).toBe("seller_session");
    expect(SELLER_SESSION_COOKIE_OPTIONS.httpOnly).toBe(true);
    expect(SELLER_SESSION_COOKIE_OPTIONS.sameSite).toBe("lax");
    expect(SELLER_SESSION_COOKIE_OPTIONS.path).toBe("/");
  });
});
