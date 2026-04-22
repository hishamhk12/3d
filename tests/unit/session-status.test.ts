import { describe, it, expect } from "vitest";
import { isEffectivelyExpired } from "@/lib/room-preview/session-status";

const PAST = new Date(Date.now() - 60_000).toISOString();
const FUTURE = new Date(Date.now() + 60_000).toISOString();

describe("isEffectivelyExpired", () => {
  it("returns false for a live session with a future expiresAt", () => {
    expect(isEffectivelyExpired({ status: "waiting_for_mobile", expiresAt: FUTURE })).toBe(false);
  });

  it("returns true for a live session with a past expiresAt", () => {
    expect(isEffectivelyExpired({ status: "waiting_for_mobile", expiresAt: PAST })).toBe(true);
  });

  it("returns true for null expiresAt — legacy orphan session", () => {
    expect(isEffectivelyExpired({ status: "waiting_for_mobile", expiresAt: null })).toBe(true);
  });

  it("returns true when status is 'expired' regardless of expiresAt value", () => {
    expect(isEffectivelyExpired({ status: "expired", expiresAt: FUTURE })).toBe(true);
    expect(isEffectivelyExpired({ status: "expired", expiresAt: null })).toBe(true);
  });

  it("returns false for a terminal-success session with a future expiresAt", () => {
    expect(isEffectivelyExpired({ status: "result_ready", expiresAt: FUTURE })).toBe(false);
  });

  it("returns true for a terminal-success session with a past expiresAt", () => {
    expect(isEffectivelyExpired({ status: "result_ready", expiresAt: PAST })).toBe(true);
  });
});
