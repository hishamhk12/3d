import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────
// Every DB-touching module is mocked so this test never opens a real Prisma
// connection. It exercises submitGateForm's control flow only: given a
// customer_confirm submission that includes an experienceId, does it look up
// the right CustomerExperience, validate ownership/image presence, and call
// selectRoomForSession with that experience's *roomImageUrl* (never the
// rendered resultImageUrl) for the *centered* selection only?

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

const getCustomerExperienceById = vi.fn();

vi.mock("@/lib/room-preview/customer-service", () => ({
  findCustomerByPhone: vi.fn(),
  createOrRefreshCustomer: vi.fn(),
  refreshCustomerLastSeen: vi.fn(async () => {}),
  getCustomerById: (...args: Parameters<typeof getCustomerById>) => getCustomerById(...args),
  getCustomerExperienceById: (...args: Parameters<typeof getCustomerExperienceById>) =>
    getCustomerExperienceById(...args),
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

const EXPERIENCES = [
  {
    id: "exp-1",
    customerId: "cust-1",
    roomImageUrl: "https://cdn.example.com/rooms/room-1.jpg",
    resultImageUrl: "https://cdn.example.com/results/result-1.jpg",
    productName: "سجاد فاخر",
  },
  {
    id: "exp-2",
    customerId: "cust-1",
    roomImageUrl: "https://cdn.example.com/rooms/room-2.jpg",
    resultImageUrl: "https://cdn.example.com/results/result-2.jpg",
    productName: "باركيه خشبي",
  },
  {
    id: "exp-3",
    customerId: "cust-1",
    roomImageUrl: null, // no original room photo saved for this visit
    resultImageUrl: "https://cdn.example.com/results/result-3.jpg",
    productName: "خشب أرضيات",
  },
];

function confirmFormData(experienceId?: string) {
  const fd = new FormData();
  fd.set("sessionId", "session-1");
  fd.set("locale", "ar");
  fd.set("flow", "customer_confirm");
  fd.set("customerId", "cust-1");
  fd.set("name", "أحمد");
  if (experienceId) fd.set("experienceId", experienceId);
  return fd;
}

async function runSubmit(fd: FormData) {
  await expect(submitGateForm(fd)).rejects.toThrow(/^NEXT_REDIRECT:/);
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
  selectRoomForSession.mockImplementation(async (_sessionId: string, room: unknown) => ({
    id: "session-1",
    status: "room_selected",
    selectedRoom: room,
  }));
});

describe("submitGateForm — customer_confirm room selection", () => {
  it("selecting the first (index 0) previous experience applies its roomImageUrl to the session", async () => {
    getCustomerExperienceById.mockImplementation(async (id: string) =>
      EXPERIENCES.find((e) => e.id === id) ?? null,
    );

    await runSubmit(confirmFormData("exp-1"));

    expect(getCustomerExperienceById).toHaveBeenCalledWith("exp-1");
    expect(selectRoomForSession).toHaveBeenCalledTimes(1);
    expect(selectRoomForSession).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        source: "gallery",
        imageUrl: EXPERIENCES[0].roomImageUrl,
      }),
    );
  });

  it("selecting the second previous experience applies its roomImageUrl — not the first's", async () => {
    getCustomerExperienceById.mockImplementation(async (id: string) =>
      EXPERIENCES.find((e) => e.id === id) ?? null,
    );

    await runSubmit(confirmFormData("exp-2"));

    expect(getCustomerExperienceById).toHaveBeenCalledWith("exp-2");
    expect(selectRoomForSession).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        source: "gallery",
        imageUrl: EXPERIENCES[1].roomImageUrl,
      }),
    );
    expect(selectRoomForSession).not.toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({ imageUrl: EXPERIENCES[0].roomImageUrl }),
    );
  });

  it("never sends the rendered resultImageUrl as the room image", async () => {
    getCustomerExperienceById.mockImplementation(async (id: string) =>
      EXPERIENCES.find((e) => e.id === id) ?? null,
    );

    await runSubmit(confirmFormData("exp-1"));

    const [, room] = selectRoomForSession.mock.calls[0] as [string, { imageUrl: string }];
    expect(room.imageUrl).not.toBe(EXPERIENCES[0].resultImageUrl);
    expect(room.imageUrl).toBe(EXPERIENCES[0].roomImageUrl);
  });

  it("rejects an experience that belongs to a different customer (tamper attempt)", async () => {
    getCustomerExperienceById.mockResolvedValue({
      id: "exp-other",
      customerId: "someone-else",
      roomImageUrl: "https://cdn.example.com/rooms/stolen.jpg",
      resultImageUrl: "https://cdn.example.com/results/stolen.jpg",
      productName: "test",
    });

    await runSubmit(confirmFormData("exp-other"));

    expect(selectRoomForSession).not.toHaveBeenCalled();
  });

  it("skips the room pre-fill (without blocking the redirect) when the experience has no roomImageUrl", async () => {
    getCustomerExperienceById.mockImplementation(async (id: string) =>
      EXPERIENCES.find((e) => e.id === id) ?? null,
    );

    await runSubmit(confirmFormData("exp-3"));

    expect(selectRoomForSession).not.toHaveBeenCalled();
  });

  it("skips the room pre-fill entirely when no experienceId is submitted (no history / nothing selected)", async () => {
    await runSubmit(confirmFormData());

    expect(getCustomerExperienceById).not.toHaveBeenCalled();
    expect(selectRoomForSession).not.toHaveBeenCalled();
  });

  it("still redirects to the mobile session even if selectRoomForSession throws", async () => {
    getCustomerExperienceById.mockImplementation(async (id: string) =>
      EXPERIENCES.find((e) => e.id === id) ?? null,
    );
    selectRoomForSession.mockRejectedValue(new FakeTransitionError("locked"));

    await expect(submitGateForm(confirmFormData("exp-1"))).rejects.toThrow(
      "NEXT_REDIRECT:/room-preview/mobile/session-1",
    );
  });

  it("redirects to the mobile session route on the happy path", async () => {
    getCustomerExperienceById.mockImplementation(async (id: string) =>
      EXPERIENCES.find((e) => e.id === id) ?? null,
    );

    await expect(submitGateForm(confirmFormData("exp-1"))).rejects.toThrow(
      "NEXT_REDIRECT:/room-preview/mobile/session-1",
    );
  });
});
