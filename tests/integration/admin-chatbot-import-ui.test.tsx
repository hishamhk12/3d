// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ImportTab from "@/app/(admin)/admin/chatbot/_components/ImportTab";

const PREVIEW_URL = "/api/admin/chatbot/import/preview";
const APPLY_URL = "/api/admin/chatbot/import/apply";
const CANCEL_URL = "/api/admin/chatbot/import/cancel";
const FASTAPI_URL = "https://fastapi.internal.local";
const JWT = "eyJ.internal.jwt";
const SECRET = "internal-admin-secret-32-bytes-long";

function response(body: unknown, okOrStatus: boolean | number = true, status = 200): Response {
  const httpStatus = typeof okOrStatus === "number" ? okOrStatus : status;
  return new Response(JSON.stringify(body), {
    status: httpStatus,
    headers: { "Content-Type": "application/json" },
  });
}

function preview(overrides: Record<string, unknown> = {}) {
  return {
    valid: true,
    totalParsedRows: 120,
    totalProducts: 45,
    totalWarehouseRows: 110,
    validationErrors: [],
    warnings: ["Check low stock rows"],
    diff: { added: 10, updated: 20, removed: 0 },
    currentRows: 100,
    wouldEmptyInventory: false,
    significantlySmaller: false,
    confirmationAvailable: true,
    confirmation: { token: "SHOULD_NOT_RENDER" },
    token: "SHOULD_NOT_RENDER",
    ...overrides,
  };
}

function xlsx(name = "inventory.xlsx", text = "xlsx-data"): File {
  return new File([text], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function csv(name = "inventory.csv"): File {
  return new File(["sku,warehouse,qty"], name, { type: "text/csv" });
}

function choose(file: File) {
  const input = document.querySelector("input[type='file']") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

function getFormFile(call: unknown[]): File | null {
  const init = call[1] as RequestInit;
  return (init.body as FormData).get("file") as File | null;
}

function fetchCalls(fetchMock: ReturnType<typeof vi.fn>): Array<[string, RequestInit]> {
  return fetchMock.mock.calls as Array<[string, RequestInit]>;
}

function expectNoLeak(container: HTMLElement) {
  const text = container.textContent ?? "";
  for (const forbidden of [
    FASTAPI_URL,
    JWT,
    SECRET,
    "Authorization",
    "Bearer ",
    "INTERNAL_JWT_SECRET",
    "CHATBOT_FASTAPI_URL",
    "SHOULD_NOT_RENDER",
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

describe("admin chatbot inventory import UI", () => {
  it("shows selected file name and size", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<ImportTab />);

    choose(xlsx("stock.xlsx", "1234567890"));

    expect(screen.getByText("stock.xlsx")).toBeTruthy();
    expect(screen.getByText("10 B")).toBeTruthy();
  });

  it("rejects unsupported files before upload", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<ImportTab />);

    choose(new File(["x"], "inventory.txt", { type: "text/plain" }));

    expect(screen.getByRole("alert").textContent).toContain("Only .xlsx and .csv files are supported.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects oversized files before upload", () => {
    const fetchMock = vi.fn();
    const file = xlsx("large.xlsx");
    Object.defineProperty(file, "size", { value: 10 * 1024 * 1024 + 1 });
    vi.stubGlobal("fetch", fetchMock);
    render(<ImportTab />);

    choose(file);

    expect(screen.getByRole("alert").textContent).toContain("File is too large.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends preview request and shows loading state", async () => {
    let resolvePreview!: (value: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolvePreview = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ImportTab />);

    choose(xlsx());
    fireEvent.click(screen.getByRole("button", { name: "Preview import" }));

    expect(await screen.findByText("Previewing import...")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calls = fetchCalls(fetchMock);
    expect(calls[0][0]).toBe(PREVIEW_URL);
    expect(getFormFile(calls[0])?.name).toBe("inventory.xlsx");

    resolvePreview(response(preview()));
    expect(await screen.findByText("Preview results")).toBeTruthy();
  });

  it("renders preview data and never renders the confirmation token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(preview())));
    const { container } = render(<ImportTab />);

    choose(csv());
    fireEvent.click(screen.getByRole("button", { name: "Preview import" }));

    expect(await screen.findByText("Preview results")).toBeTruthy();
    expect(screen.getByText("Parsed rows")).toBeTruthy();
    expect(screen.getByText("120")).toBeTruthy();
    expect(screen.getByText("Products")).toBeTruthy();
    expect(screen.getByText("45")).toBeTruthy();
    expect(screen.getByText("Warehouse rows")).toBeTruthy();
    expect(screen.getByText("110")).toBeTruthy();
    expect(screen.getByText("Current rows")).toBeTruthy();
    expect(screen.getByText("100")).toBeTruthy();
    expect(screen.getByText("Added")).toBeTruthy();
    expect(screen.getByText("Updated")).toBeTruthy();
    expect(screen.getByText("Removed")).toBeTruthy();
    expect(screen.getByText("Check low stock rows")).toBeTruthy();
    expectNoLeak(container);
  });

  it("disables confirm when preview is invalid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response(preview({ valid: false, validationErrors: ["Missing product code"], confirmationAvailable: false })),
      ),
    );
    render(<ImportTab />);

    choose(xlsx());
    fireEvent.click(screen.getByRole("button", { name: "Preview import" }));

    expect(await screen.findByText("Invalid")).toBeTruthy();
    expect(screen.getByText("Missing product code")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm import" })).toHaveProperty("disabled", true);
  });

  it("shows destructive warning and requires explicit confirmation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response(
          preview({
            diff: { added: 0, updated: 1, removed: 9 },
            wouldEmptyInventory: true,
            significantlySmaller: true,
          }),
        ),
      ),
    );
    render(<ImportTab />);

    choose(xlsx());
    fireEvent.click(screen.getByRole("button", { name: "Preview import" }));

    expect(await screen.findByText("Destructive replacement warning")).toBeTruthy();
    expect(screen.getByText("This import would empty the current inventory.")).toBeTruthy();
    const confirm = screen.getByRole("button", { name: "Confirm import" });
    expect(confirm).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("checkbox"));
    expect(confirm).toHaveProperty("disabled", false);
  });

  it("re-sends the same selected file on apply and does not forward a token from JavaScript", async () => {
    const file = xlsx("same-file.xlsx", "same");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(preview()))
      .mockResolvedValueOnce(response({ status: "success", rowsImported: 120, rowsFailed: 0 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ImportTab />);

    choose(file);
    fireEvent.click(screen.getByRole("button", { name: "Preview import" }));
    await screen.findByText("Preview results");
    fireEvent.click(screen.getByRole("button", { name: "Confirm import" }));

    expect(await screen.findByText("Import completed")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const calls = fetchCalls(fetchMock);
    expect(calls[1][0]).toBe(APPLY_URL);
    const applyBody = calls[1][1].body as FormData;
    expect(applyBody.get("file")).toBe(file);
    expect(applyBody.get("token")).toBeNull();
  });

  it("prevents duplicate preview clicks while loading", async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    render(<ImportTab />);

    choose(xlsx());
    const previewButton = screen.getByRole("button", { name: "Preview import" });
    fireEvent.click(previewButton);
    fireEvent.click(previewButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("calls cancel route and clears preview state", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(preview())).mockResolvedValueOnce(response({ cancelled: true }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ImportTab />);

    choose(xlsx());
    fireEvent.click(screen.getByRole("button", { name: "Preview import" }));
    await screen.findByText("Preview results");
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel" }).at(-1)!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchCalls(fetchMock)[1][0]).toBe(CANCEL_URL);
    await waitFor(() => expect(screen.queryByText("Preview results")).toBeNull());
  });

  it("cancels stale preview when selecting a new file", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(preview())).mockResolvedValueOnce(response({ cancelled: true }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ImportTab />);

    choose(xlsx("old.xlsx"));
    fireEvent.click(screen.getByRole("button", { name: "Preview import" }));
    await screen.findByText("Preview results");
    choose(xlsx("new.xlsx"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchCalls(fetchMock)[1][0]).toBe(CANCEL_URL);
    expect(await screen.findByText("new.xlsx")).toBeTruthy();
    expect(screen.queryByText("Preview results")).toBeNull();
  });

  it("renders success state and clears selected file after apply", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(preview()))
      .mockResolvedValueOnce(response({ status: "success", rowsImported: 118, rowsFailed: 2 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ImportTab />);

    choose(xlsx("done.xlsx"));
    fireEvent.click(screen.getByRole("button", { name: "Preview import" }));
    await screen.findByText("Preview results");
    fireEvent.click(screen.getByRole("button", { name: "Confirm import" }));

    expect(await screen.findByText("Import completed")).toBeTruthy();
    expect(screen.getByText("118 rows imported, 2 failed.")).toBeTruthy();
    expect(screen.queryByText("done.xlsx")).toBeNull();
  });

  it("renders safe error state without secret leakage", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response(
        {
          error: "Could not preview import.",
          detail: `${FASTAPI_URL} ${JWT} ${SECRET}`,
        },
        false,
        502,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<ImportTab />);

    choose(xlsx());
    fireEvent.click(screen.getByRole("button", { name: "Preview import" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Could not preview import.");
    expectNoLeak(container);
  });
});
