// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ActivityTab from "@/app/(admin)/admin/chatbot/_components/ActivityTab";

const METRICS_URL = "/api/admin/chatbot/metrics";
const HISTORY_URL = "/api/admin/chatbot/import/history";
const FASTAPI_URL = "https://fastapi.internal.local";
const JWT = "eyJ.internal.jwt";
const SECRET = "internal-admin-secret-32-bytes-long";
const DB_URL = "postgres://private-db.internal/app";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function metrics(overrides: Record<string, unknown> = {}) {
  return {
    status: "ready",
    questionsToday: 4,
    questionsThisWeek: 11,
    distinctExternalSellers: 3,
    topProductCodes: [
      { value: "P-100", count: 5 },
      { value: "P-200", count: 2 },
    ],
    topWarehouses: [{ value: "RUH", count: 6 }],
    aiVsFallback: { ai: 7, fallback: 4 },
    recentActivity: [
      {
        timestamp: "2026-06-17T09:00:00.000Z",
        externalActorId: "3d-seller:seller-1",
        productCode: "P-100",
        warehouse: "RUH",
        intent: "ai:availability",
        seller: {
          sellerCode: "S-001",
          sellerName: "Seller One",
          showroomCode: "RIYADH",
          available: true,
        },
        question: `full question ${FASTAPI_URL}`,
        answer: `full answer ${DB_URL}`,
      },
    ],
    ...overrides,
  };
}

function history(overrides: Record<string, unknown> = {}) {
  return {
    status: "ready",
    items: [
      {
        timestamp: "2026-06-17T08:30:00.000Z",
        filename: "inventory.xlsx",
        status: "success",
        rowsImported: 120,
        rowsFailed: 1,
        errorMessage: SECRET,
      },
    ],
    ...overrides,
  };
}

function mockFetch(metricsBody: unknown = metrics(), historyBody: unknown = history()) {
  const fetchMock = vi.fn((url: string) => {
    if (url === METRICS_URL) return Promise.resolve(response(metricsBody));
    if (url === HISTORY_URL) return Promise.resolve(response(historyBody));
    return Promise.resolve(response({ error: "unexpected" }, 404));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
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
    "full question",
    "full answer",
    "errorMessage",
    "stack",
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

describe("admin chatbot Activity UI", () => {
  it("renders metrics cards, top codes, top warehouses, recent activity, and imports", async () => {
    mockFetch();
    const { container } = render(<ActivityTab />);

    expect(await screen.findByText("Questions today")).toBeTruthy();
    expect(screen.getByText("Questions this week")).toBeTruthy();
    expect(screen.getByText("Active sellers")).toBeTruthy();
    expect(screen.getByText("AI responses")).toBeTruthy();
    expect(screen.getByText("Fallback responses")).toBeTruthy();
    expect(screen.getAllByText("4").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("11")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();

    expect(screen.getByText("Top product codes")).toBeTruthy();
    expect(screen.getAllByText("P-100").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("P-200")).toBeTruthy();
    expect(screen.getByText("Top warehouses")).toBeTruthy();
    expect(screen.getAllByText("RUH").length).toBeGreaterThanOrEqual(1);

    expect(screen.getByText("Recent seller activity")).toBeTruthy();
    expect(screen.getByText("S-001")).toBeTruthy();
    expect(screen.getByText("Seller One")).toBeTruthy();
    expect(screen.getByText("RIYADH")).toBeTruthy();
    expect(screen.getByText("ai:availability")).toBeTruthy();

    expect(screen.getByText("Recent inventory imports")).toBeTruthy();
    expect(screen.getByText("inventory.xlsx")).toBeTruthy();
    expect(screen.getByText("success")).toBeTruthy();
    expect(screen.getByText("120")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
    expectNoLeak(container);
  });

  it("shows missing seller safely", async () => {
    mockFetch(
      metrics({
        recentActivity: [
          {
            timestamp: "2026-06-17T09:00:00.000Z",
            externalActorId: "3d-seller:missing",
            productCode: "P-404",
            warehouse: null,
            intent: "deterministic:price",
            seller: {
              sellerCode: null,
              sellerName: null,
              showroomCode: null,
              available: false,
            },
          },
        ],
      }),
    );
    const { container } = render(<ActivityTab />);

    expect(await screen.findByText("Unavailable seller")).toBeTruthy();
    expect(screen.getByText("P-404")).toBeTruthy();
    expect(screen.getByText("deterministic:price")).toBeTruthy();
    expectNoLeak(container);
  });

  it("renders loading, empty, and degraded states", async () => {
    let resolveMetrics!: (value: Response) => void;
    let resolveHistory!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url === METRICS_URL) {
          return new Promise<Response>((resolve) => {
            resolveMetrics = resolve;
          });
        }
        if (url === HISTORY_URL) {
          return new Promise<Response>((resolve) => {
            resolveHistory = resolve;
          });
        }
        return Promise.resolve(response({}));
      }),
    );
    const { container } = render(<ActivityTab />);

    expect(await screen.findByText("Loading activity...")).toBeTruthy();

    resolveMetrics(
      response(
        metrics({
          status: "degraded",
          questionsToday: 0,
          questionsThisWeek: 0,
          distinctExternalSellers: 0,
          topProductCodes: [],
          topWarehouses: [],
          aiVsFallback: { ai: 0, fallback: 0 },
          recentActivity: [],
        }),
      ),
    );
    resolveHistory(response(history({ status: "degraded", items: [] })));

    expect(await screen.findByText("Some activity data is temporarily unavailable.")).toBeTruthy();
    expect(screen.getByText("No product activity yet.")).toBeTruthy();
    expect(screen.getByText("No warehouse activity yet.")).toBeTruthy();
    expect(screen.getByText("No recent seller activity.")).toBeTruthy();
    expect(screen.getByText("No recent imports.")).toBeTruthy();
    expectNoLeak(container);
  });

  it("supports manual refresh without continuous polling", async () => {
    const metricsResponses = [
      metrics({ questionsToday: 13 }),
      metrics({ questionsToday: 14 }),
    ];
    const historyResponses = [history(), history({ items: [] })];
    const fetchMock = vi.fn((url: string) => {
      if (url === METRICS_URL) return Promise.resolve(response(metricsResponses.shift()));
      if (url === HISTORY_URL) return Promise.resolve(response(historyResponses.shift()));
      return Promise.resolve(response({ error: "unexpected" }, 404));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ActivityTab />);

    expect(await screen.findByText("13")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(screen.getByText("14")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.map((call) => call[0]).sort()).toEqual([
      HISTORY_URL,
      HISTORY_URL,
      METRICS_URL,
      METRICS_URL,
    ]);
  });

  it("renders safe error state without leaking upstream details", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === METRICS_URL) {
        return Promise.resolve(
          response(
            { error: "Chatbot metrics are temporarily unavailable.", detail: `${FASTAPI_URL} ${JWT}` },
            502,
          ),
        );
      }
      if (url === HISTORY_URL) return Promise.resolve(response(history()));
      return Promise.resolve(response({}));
    });
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<ActivityTab />);

    expect(await screen.findByText("Chatbot metrics are temporarily unavailable.")).toBeTruthy();
    expect(screen.getByText("No recent seller activity.")).toBeTruthy();
    expectNoLeak(container);
  });
});
