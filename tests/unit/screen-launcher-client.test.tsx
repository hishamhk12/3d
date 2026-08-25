// @vitest-environment happy-dom
import { StrictMode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ScreenLauncherClient from "@/components/room-preview/ScreenLauncherClient";

const mocks = vi.hoisted(() => {
  const replace = vi.fn();
  return {
    createRoomPreviewSession: vi.fn(),
    replace,
    router: { replace },
    searchParams: new URLSearchParams("source=hero_try_button"),
    translations: {
      common: { actions: { retry: "Retry" } },
      roomPreview: {
        launcher: {
          backToQrTest: "Back",
          brandedLoadingDescription: "Creating",
          brandedLoadingTitle: "Loading",
          createFailed: "Could not create session",
          failedDescription: "Try again",
          failedTitle: "Creation failed",
        },
      },
    },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({
    dir: "ltr",
    t: mocks.translations,
  }),
}));

vi.mock("@/components/room-preview/BrandedQrLoadingScreen", () => ({
  default: () => <div>Loading</div>,
}));

vi.mock("@/components/room-preview/SessionStatePanel", () => ({
  default: ({ description }: { description: string }) => <div>{description}</div>,
}));

vi.mock("@/lib/room-preview/session-client", () => ({
  createRoomPreviewSession: mocks.createRoomPreviewSession,
  fetchRoomPreviewSession: vi.fn(),
  isRoomPreviewRequestError: () => false,
}));

vi.mock("@/lib/room-preview/session-diagnostics-client", () => ({
  trackClientSessionEvent: vi.fn(),
}));

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  localStorage.clear();
  mocks.createRoomPreviewSession.mockReset();
  mocks.replace.mockReset();
});

describe("ScreenLauncherClient", () => {
  it("shows the creation failure instead of hanging during a Strict Mode effect replay", async () => {
    let rejectCreation!: (reason: Error) => void;
    mocks.createRoomPreviewSession.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectCreation = reject;
      }),
    );

    render(
      <StrictMode>
        <ScreenLauncherClient />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(mocks.createRoomPreviewSession).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      rejectCreation(new Error("database unavailable"));
    });

    await waitFor(() => {
      expect(screen.getByText("Could not create session")).toBeTruthy();
    });
    expect(mocks.createRoomPreviewSession).toHaveBeenCalledTimes(1);
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
