// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChatbotAdmin from "@/app/(admin)/admin/chatbot/_components/ChatbotAdmin";
import type { AdminChatbotStatus } from "@/app/(admin)/admin/chatbot/_components/status-types";

const FASTAPI_URL = "https://fastapi.internal.local";
const JWT = "eyJ.internal.jwt";
const SECRET = "internal-admin-secret-32-bytes-long";
const DB_URL = "postgres://private-db.internal/app";

function status(overrides: Partial<AdminChatbotStatus> = {}): AdminChatbotStatus {
  return {
    checkedAt: "2026-06-17T08:30:00.000Z",
    fastapi: { status: "healthy", reachable: true },
    database: { status: "healthy", reachable: true },
    gemini: { status: "healthy", configured: true },
    inventory: { status: "healthy", rowCount: 321 },
    imports: { status: "healthy", latestSuccessfulImportAt: "2026-06-17T08:00:00.000Z" },
    dataSource: { status: "healthy", current: "excel" },
    sap: { status: "not_configured", configured: false },
    features: {
      sellerChat: { status: "healthy", enabled: true },
      autocomplete: { status: "healthy", enabled: true },
      technicalDocuments: { status: "disabled", enabled: false },
      voice: { status: "disabled", enabled: false },
      webKnowledge: { status: "disabled", enabled: false },
    },
    local: {
      status: "healthy",
      sellerCount: 5,
      showroomCount: 2,
      sellerChatEnabled: true,
    },
    ...overrides,
  };
}

function response(body: unknown, ok = true, httpStatus = 200): Response {
  return new Response(JSON.stringify(body), {
    status: httpStatus,
    headers: { "Content-Type": "application/json" },
    statusText: ok ? "OK" : "Error",
  });
}

function expectNoLeak(container: HTMLElement) {
  const text = container.textContent ?? "";
  for (const forbidden of [
    FASTAPI_URL,
    JWT,
    SECRET,
    DB_URL,
    "Authorization",
    "Bearer ",
    "INTERNAL_JWT_SECRET",
    "CHATBOT_FASTAPI_URL",
    "DATABASE_URL",
  ]) {
    expect(text).not.toContain(forbidden);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("admin chatbot status UI", () => {
  it("renders the loading state while status is pending", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));

    render(<ChatbotAdmin />);

    expect(await screen.findByText("Loading status...")).toBeTruthy();
  });

  it("renders healthy overview cards, counts, and last import timestamp", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(status())));

    const { container } = render(<ChatbotAdmin />);

    expect(await screen.findByText("Chatbot API")).toBeTruthy();
    expect(screen.getByText("Inventory database")).toBeTruthy();
    expect(screen.getByText("Gemini")).toBeTruthy();
    expect(screen.getByText("Seller chat")).toBeTruthy();
    expect(screen.getByText("Inventory records")).toBeTruthy();
    expect(screen.getByText("321")).toBeTruthy();
    expect(screen.getAllByText("Sellers").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getAllByText("Showrooms").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getAllByText("Healthy").length).toBeGreaterThanOrEqual(6);
    expect(container.textContent).toContain("2026");
    expectNoLeak(container);
  });

  it("renders degraded and unavailable states plus no-import copy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response(
          status({
            fastapi: { status: "unavailable", reachable: false },
            database: { status: "degraded", reachable: false },
            gemini: { status: "degraded", configured: false },
            inventory: { status: "unavailable", rowCount: null },
            imports: { status: "degraded", latestSuccessfulImportAt: null },
            local: { status: "degraded", sellerCount: null, showroomCount: null, sellerChatEnabled: false },
          }),
        ),
      ),
    );

    const { container } = render(<ChatbotAdmin />);

    await waitFor(() => expect(screen.getAllByText("Unavailable").length).toBeGreaterThanOrEqual(2));
    expect(screen.getAllByText("Degraded").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText("No successful import")).toBeTruthy();
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThanOrEqual(2);
    expectNoLeak(container);
  });

  it("refreshes manually and does not poll or refetch on tab switch", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(status({ inventory: { status: "healthy", rowCount: 10 } })))
      .mockResolvedValueOnce(response(status({ inventory: { status: "healthy", rowCount: 11 } })));
    vi.stubGlobal("fetch", fetchMock);

    render(<ChatbotAdmin />);

    expect(await screen.findByText("10")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("tab", { name: "Settings & Status" }));
    expect(await screen.findByText("Data source")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(screen.getByText("11")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every((call) => call[0] === "/api/admin/chatbot/status")).toBe(true);
  });

  it("renders read-only settings without checkbox, switch, or toggle controls", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(status())));

    const { container } = render(<ChatbotAdmin />);

    await screen.findByText("Chatbot API");
    fireEvent.click(screen.getByRole("tab", { name: "Settings & Status" }));

    expect(await screen.findByText("Data source")).toBeTruthy();
    expect(screen.getByText("Excel")).toBeTruthy();
    expect(screen.getByText("SAP")).toBeTruthy();
    expect(screen.getAllByText("Not configured").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Seller chat")).toBeTruthy();
    expect(screen.getAllByText("Enabled").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Autocomplete")).toBeTruthy();
    expect(screen.getByText("Technical documents")).toBeTruthy();
    expect(screen.getByText("Voice")).toBeTruthy();
    expect(screen.getByText("Web knowledge")).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(container.querySelector("input[type='checkbox']")).toBeNull();
    expect(container.textContent?.toLowerCase()).not.toContain("toggle");
    expectNoLeak(container);
  });
});
