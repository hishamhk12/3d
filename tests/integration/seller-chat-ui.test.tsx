// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

// Scoped CSS + next/image + next/navigation are environment concerns — stub them.
vi.mock("@/components/seller/chat/seller-chat.css", () => ({}));
vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...(props as Record<string, never>)} />;
  },
}));
const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

import SellerChatExperience from "@/components/seller/chat/SellerChatExperience";

const SELLER = { sellerName: "بائع تجريبي", showroomCode: "RIYADH" };

function chatResponse(extra: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      answer: "المتوفر للبيع 45 قطعة في الرياض.\n- CRPT050.006",
      cards: [
        {
          productCode: "CRPT050.006",
          productName: "50X50 Navigator بيج",
          category: "موكيت",
          design: "نافي",
          size: "50X50",
          classification: "دوري",
          warehouse: "Riyadh",
          quantityAvailable: 45,
          reservedQuantity: 0,
          availableToSell: 45,
          incomingQuantity: 0,
          expectedArrivalDate: null,
          status: "available",
        },
      ],
      mode: "deterministic",
      intent: "warehouse_stock_lookup",
      productCode: "CRPT050.006",
      warehouse: "Riyadh",
      ...extra,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SellerChatExperience — welcome + shell", () => {
  it("renders the RTL phone shell, hero robot, welcome copy, and 3 suggestions", () => {
    const { container } = render(<SellerChatExperience {...SELLER} />);
    const scope = container.querySelector(".seller-chat-scope");
    expect(scope).toBeTruthy();
    expect(scope!.getAttribute("dir")).toBe("rtl");
    expect(container.querySelector(".sc-shell")).toBeTruthy();
    expect(container.querySelector("img")).toBeTruthy(); // hero robot
    expect(screen.getByText("مرحباً بك في مساعد المخزون")).toBeTruthy();
    // exactly 3 welcome suggestion pills
    const pills = container.querySelectorAll(".sc-pill.max-w-\\[88\\%\\]");
    expect(pills.length).toBe(3);
  });

  it("no longer renders the mode chips (Creative/Balanced/Precise)", () => {
    render(<SellerChatExperience {...SELLER} />);
    expect(screen.queryByRole("button", { name: "متوازن" })).toBeNull();
    expect(screen.queryByRole("button", { name: "إبداعي" })).toBeNull();
    expect(screen.queryByRole("button", { name: "دقيق" })).toBeNull();
  });

  it("shows a single top back button and no logout control", () => {
    render(<SellerChatExperience {...SELLER} />);
    expect(screen.getByRole("button", { name: "رجوع" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "تسجيل الخروج" })).toBeNull();
  });
});

describe("SellerChatExperience — ask flow", () => {
  it("sends a question, shows loading, then renders the answer + a single inventory card (no duplicate list)", async () => {
    let resolveFetch: (r: Response) => void = () => {};
    const fetchMock = vi.fn().mockImplementation(
      () => new Promise<Response>((res) => { resolveFetch = res; }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<SellerChatExperience {...SELLER} />);
    const input = screen.getByRole("combobox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "كم باقي من CRPT050.006؟" } });
    fireEvent.submit(input.closest("form")!);

    // user bubble + loading indicator
    expect(await screen.findByText("كم باقي من CRPT050.006؟")).toBeTruthy();
    expect(screen.getByText("جاري البحث…")).toBeTruthy();
    expect(input.disabled).toBe(true);
    expect(screen.getByRole("button", { name: "إرسال" }).querySelector(".animate-spin")).toBeTruthy();

    // request body carries only {question, style}
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/seller/chat");
    expect(JSON.parse(init.body)).toEqual({ question: "كم باقي من CRPT050.006؟", style: "balanced" });

    resolveFetch(chatResponse());
    // answer summary (the "- CRPT050.006" list line is stripped because cards exist)
    const answer = await screen.findByText(/المتوفر للبيع 45 قطعة في الرياض\./);
    expect(answer.textContent).not.toContain("- CRPT050.006");

    // one inventory card with real values
    expect(screen.getByText("CRPT050.006")).toBeTruthy();
    expect(screen.getByText("متاح للبيع")).toBeTruthy();
    expect(screen.getByText("الرياض")).toBeTruthy();
    expect(screen.getByText("متوفر")).toBeTruthy(); // status badge
    await waitFor(() => expect(input.disabled).toBe(false));
  });

  it("submits with Enter, keeps Shift+Enter for a new line, and caps auto-resize", async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatResponse());
    vi.stubGlobal("fetch", fetchMock);

    render(<SellerChatExperience {...SELLER} />);
    const input = screen.getByRole("combobox") as HTMLTextAreaElement;
    Object.defineProperty(input, "scrollHeight", { configurable: true, value: 220 });
    fireEvent.change(input, { target: { value: "سطر أول\nسطر ثان" } });

    expect(input.style.height).toBe("144px");
    expect(input.style.maxHeight).toBe("144px");
    expect(fireEvent.keyDown(input, { key: "Enter", shiftKey: true })).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("redirects to the seller login when the session is expired (401)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "x" }), { status: 401 })),
    );
    render(<SellerChatExperience {...SELLER} />);
    const input = screen.getByRole("combobox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "test" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login?type=seller"));
  });

  it("shows a retryable error state on a server failure and recovers on retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "upstream" }), { status: 502 }))
      .mockResolvedValueOnce(chatResponse());
    vi.stubGlobal("fetch", fetchMock);

    render(<SellerChatExperience {...SELLER} />);
    const input = screen.getByRole("combobox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "كم باقي؟" } });
    fireEvent.submit(input.closest("form")!);

    const retryBtn = await screen.findByRole("button", { name: "إعادة المحاولة" });
    // no upstream detail leaked into the UI
    expect(screen.queryByText(/upstream/)).toBeNull();
    fireEvent.click(retryBtn);
    expect(await screen.findByText(/المتوفر للبيع 45 قطعة/)).toBeTruthy();
  });
});

describe("SellerChatExperience — autocomplete", () => {
  it("renders code suggestions and inserts the code WITHOUT submitting", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith("/api/seller/inventory/code-suggestions")) {
        return Promise.resolve(
          new Response(JSON.stringify([{ code: "CRPT050.006", label: "CRPT050.006" }]), { status: 200 }),
        );
      }
      // chat endpoint — should NOT be called by selecting a suggestion
      return Promise.resolve(chatResponse());
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SellerChatExperience {...SELLER} />);
    const input = screen.getByRole("combobox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "CRPT05" } });

    const option = await screen.findByRole("option", { name: /CRPT050\.006/ });
    expect(input.getAttribute("aria-expanded")).toBe("true");
    fireEvent.mouseDown(option);

    // code inserted; message NOT sent (no user bubble, no chat POST)
    await waitFor(() => expect(input.value).toContain("CRPT050.006"));
    const chatCalls = fetchMock.mock.calls.filter((c) => c[0] === "/api/seller/chat");
    expect(chatCalls.length).toBe(0);
  });

  it("Enter selects the highlighted suggestion instead of sending while the menu is open", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) =>
      url.startsWith("/api/seller/inventory/code-suggestions")
        ? Promise.resolve(new Response(JSON.stringify([{ code: "CRPT050.006", label: "CRPT050.006" }]), { status: 200 }))
        : Promise.resolve(chatResponse()),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<SellerChatExperience {...SELLER} />);
    const input = screen.getByRole("combobox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "CRPT05" } });
    await screen.findByRole("option", { name: /CRPT050\.006/ });

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(input.value).toContain("CRPT050.006"));
    expect(fetchMock.mock.calls.filter((c) => c[0] === "/api/seller/chat").length).toBe(0);
  });
});
