import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Regression guard ─────────────────────────────────────────────────────────
// The customer_confirm step previously (briefly) reused a returning customer's
// last CustomerExperience.roomImageUrl as the session's selectedRoom, which
// skipped the room-capture step entirely (status jumped straight to
// "room_selected"). That broke the flow: the carousel on the confirm screen is
// display-only, and confirming must always fall through to the normal
// mobile room-upload step. This test locks that in: submitGateForm for
// customer_confirm must never touch selectedRoom / selectRoomForSession, even
// if a stray "experienceId" field is present in the submitted form data.

const cookieStore = {
  get: vi.fn(() => ({ value: "valid-token" })),
  set: vi.fn(),
};

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: vi.fn((fn: () => unknown) => { void fn(); }),
  };
});

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/room-preview/session-token", () => ({
  verifySessionToken: vi.fn(() => true),
  generateSessionToken: vi.fn(() => "generated-token"),
}));

vi.mock("@/lib/analytics/user-session-service", () => ({
  createAndBindUserSession: vi.fn(async () => "user-session-1"),
  sessionHasCompletedGate: vi.fn(async () => false),
}));

vi.mock("@/lib/analytics/event-tracker", () => ({
  trackEvent: vi.fn(async () => {}),
  getUserSessionIdForSession: vi.fn(async () => null),
}));

vi.mock("@/lib/room-preview/session-diagnostics", () => ({
  trackSessionEvent: vi.fn(async () => {}),
}));

const getCustomerById = vi.fn(async () => ({
  id: "cust-1",
  name: "أحمد",
  phoneE164: "+966501234567",
  countryCode: "SA",
  dialCode: "+966",
}));

vi.mock("@/lib/room-preview/customer-service", () => ({
  findCustomerByPhone: vi.fn(),
  createOrRefreshCustomer: vi.fn(),
  refreshCustomerLastSeen: vi.fn(async () => {}),
  getCustomerById: (...args: Parameters<typeof getCustomerById>) => getCustomerById(...args),
  normalizePhoneToE164: vi.fn((local: string, dial: string) => `${dial}${local}`),
  maskPhone: vi.fn((p: string) => p),
}));

const selectRoomForSession = vi.fn(async (_sessionId: string, room: unknown) => ({
  id: "session-1",
  status: "room_selected",
  selectedRoom: room,
}));
const getRoomPreviewSession = vi.fn(async () => ({
  id: "session-1",
  status: "mobile_connected",
}));
const connectMobileToSession = vi.fn(async () => ({
  id: "session-1",
  status: "mobile_connected",
}));

class FakeTransitionError extends Error {
  code = "SESSION_INVALID_STATE" as const;
  currentStatus = "mobile_connected";
}

vi.mock("@/lib/room-preview/session-service", () => ({
  connectMobileToSession: (...args: Parameters<typeof connectMobileToSession>) =>
    connectMobileToSession(...args),
  getRoomPreviewSession: (...args: Parameters<typeof getRoomPreviewSession>) =>
    getRoomPreviewSession(...args),
  isRoomPreviewSessionExpiredError: vi.fn(() => false),
  isRoomPreviewSessionNotFoundError: vi.fn(() => false),
  RoomPreviewSessionTransitionError: FakeTransitionError,
  selectCustomerRoomPreviewRole: vi.fn(async () => {}),
  selectRoomForSession: (...args: Parameters<typeof selectRoomForSession>) =>
    selectRoomForSession(...args),
}));

const { submitGateForm } = await import("@/app/room-preview/gate/[sessionId]/actions");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function confirmFormData(extra?: Record<string, string>) {
  const fd = new FormData();
  fd.set("sessionId", "session-1");
  fd.set("locale", "ar");
  fd.set("flow", "customer_confirm");
  fd.set("customerId", "cust-1");
  fd.set("name", "أحمد");
  for (const [key, value] of Object.entries(extra ?? {})) {
    fd.set(key, value);
  }
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  cookieStore.get.mockReturnValue({ value: "valid-token" });
  getCustomerById.mockResolvedValue({
    id: "cust-1",
    name: "أحمد",
    phoneE164: "+966501234567",
    countryCode: "SA",
    dialCode: "+966",
  });
  connectMobileToSession.mockResolvedValue({ id: "session-1", status: "mobile_connected" });
  getRoomPreviewSession.mockResolvedValue({ id: "session-1", status: "mobile_connected" });
});

describe("submitGateForm — customer_confirm never pre-fills the room", () => {
  it("does not call selectRoomForSession on a normal confirm submission", async () => {
    await expect(submitGateForm(confirmFormData())).rejects.toThrow(
      "NEXT_REDIRECT:/room-preview/mobile/session-1",
    );

    expect(selectRoomForSession).not.toHaveBeenCalled();
  });

  it("ignores a stray experienceId field — still never calls selectRoomForSession", async () => {
    // Guards against a stale client (old cached JS) still posting the field
    // that used to exist; the schema no longer parses it, so it must be inert.
    await expect(
      submitGateForm(confirmFormData({ experienceId: "exp-1" })),
    ).rejects.toThrow("NEXT_REDIRECT:/room-preview/mobile/session-1");

    expect(selectRoomForSession).not.toHaveBeenCalled();
  });

  it("connects the mobile device but leaves the session status at mobile_connected (not room_selected)", async () => {
    await expect(submitGateForm(confirmFormData())).rejects.toThrow(/^NEXT_REDIRECT:/);

    expect(connectMobileToSession).toHaveBeenCalledTimes(1);
    const connectedSession = await connectMobileToSession.mock.results[0]!.value;
    expect(connectedSession.status).toBe("mobile_connected");
    expect(selectRoomForSession).not.toHaveBeenCalled();
  });

  it("redirects straight to the mobile session route, where the normal room-upload step takes over", async () => {
    await expect(submitGateForm(confirmFormData())).rejects.toThrow(
      "NEXT_REDIRECT:/room-preview/mobile/session-1",
    );
  });
});
