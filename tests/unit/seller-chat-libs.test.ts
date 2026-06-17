import { describe, it, expect, vi, afterEach } from "vitest";
import {
  detectCodeFragment,
  replaceFragment,
  nextHighlight,
  selectAt,
  normalizeDigits,
  fetchCodeSuggestions,
  type ProductSuggestion,
} from "@/lib/seller/chat/code-suggest";
import { summaryText, isListLine } from "@/lib/seller/chat/format";
import { computeStatus } from "@/lib/seller/chat/inventory-types";
import {
  groupInventoryByProduct,
} from "@/components/seller/chat/InventoryProductCard";
import type { InventoryDTO } from "@/lib/seller/chat/inventory-types";

afterEach(() => vi.restoreAllMocks());

describe("code fragment detection / replacement", () => {
  it("detects the code fragment at the caret inside an Arabic sentence", () => {
    const text = "كم باقي من CRPT050";
    const frag = detectCodeFragment(text, text.length);
    expect(frag).not.toBeNull();
    expect(frag!.fragment).toBe("CRPT050");
    expect(text.slice(frag!.start, frag!.end)).toBe("CRPT050");
  });

  it("returns null when there is no meaningful code token", () => {
    expect(detectCodeFragment("كم باقي من", 10)).toBeNull();
  });

  it("normalizes Arabic-Indic digits when detecting", () => {
    const frag = detectCodeFragment("PARK-٥٠");
    expect(frag!.fragment).toBe("PARK-50");
  });

  it("replaces ONLY the detected fragment, preserving the sentence", () => {
    const text = "كم باقي من CRPT05 بجدة؟";
    const frag = detectCodeFragment("كم باقي من CRPT05", "كم باقي من CRPT05".length)!;
    const next = replaceFragment(text, frag.start, frag.end, "CRPT050.006");
    expect(next).toBe("كم باقي من CRPT050.006 بجدة؟");
  });
});

describe("keyboard helpers", () => {
  it("wraps the highlight index on arrow keys", () => {
    expect(nextHighlight(-1, "ArrowDown", 3)).toBe(0);
    expect(nextHighlight(2, "ArrowDown", 3)).toBe(0);
    expect(nextHighlight(0, "ArrowUp", 3)).toBe(2);
    expect(nextHighlight(0, "ArrowDown", 0)).toBe(-1);
  });

  it("selectAt returns the code or null out of range", () => {
    const sugs: ProductSuggestion[] = [{ code: "A", label: "A" }, { code: "B", label: "B" }];
    expect(selectAt(sugs, 1)).toBe("B");
    expect(selectAt(sugs, -1)).toBeNull();
    expect(selectAt(sugs, 5)).toBeNull();
  });
});

describe("normalizeDigits", () => {
  it("converts eastern + persian digits to ASCII", () => {
    expect(normalizeDigits("٥٠")).toBe("50");
    expect(normalizeDigits("۱۲۳")).toBe("123");
  });
});

describe("fetchCodeSuggestions", () => {
  it("returns parsed suggestions on ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify([{ code: "X", label: "X" }]), { status: 200 })),
    );
    const r = await fetchCodeSuggestions("/api/seller/inventory/code-suggestions", "X");
    expect(r.ok).toBe(true);
    expect(r.suggestions[0].code).toBe("X");
    vi.unstubAllGlobals();
  });

  it("never throws — returns ok:false on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")));
    const r = await fetchCodeSuggestions("/api/seller/inventory/code-suggestions", "X");
    expect(r).toEqual({ ok: false, suggestions: [] });
    vi.unstubAllGlobals();
  });
});

describe("summaryText (duplicate-list removal when cards exist)", () => {
  it("drops list lines when cards are present", () => {
    const text = "إجمالي المتوفر 57.\n- CRPT050.006\n- M2";
    expect(summaryText(text, true)).toBe("إجمالي المتوفر 57.");
  });
  it("keeps text unchanged when there are no cards", () => {
    const text = "إجمالي المتوفر 57.\n- CRPT050.006";
    expect(summaryText(text, false)).toBe(text);
  });
  it("isListLine recognizes bullets and numbers", () => {
    expect(isListLine("- a")).toBe(true);
    expect(isListLine("1) b")).toBe(true);
    expect(isListLine("نص عادي")).toBe(false);
  });
});

describe("computeStatus", () => {
  it("applies the system status rule", () => {
    expect(computeStatus(20, 0)).toBe("available");
    expect(computeStatus(5, 0)).toBe("low_stock");
    expect(computeStatus(0, 10)).toBe("incoming");
    expect(computeStatus(0, 0)).toBe("out_of_stock");
  });
});

describe("groupInventoryByProduct", () => {
  const mk = (code: string, warehouse: string, ats: number, incoming = 0): InventoryDTO => ({
    productCode: code,
    productName: `${code} name`,
    category: null,
    design: null,
    size: null,
    classification: null,
    warehouse,
    quantityAvailable: ats,
    reservedQuantity: 0,
    availableToSell: ats,
    incomingQuantity: incoming,
    expectedArrivalDate: null,
    status: "available",
  });

  it("groups warehouse rows under one product, preserving order, deriving status", () => {
    const groups = groupInventoryByProduct([
      mk("CRPT050.006", "Riyadh", 45),
      mk("CRPT050.006", "Jeddah", 12),
      mk("OTHER", "Riyadh", 0, 0),
    ]);
    expect(groups.map((g) => g.productCode)).toEqual(["CRPT050.006", "OTHER"]);
    expect(groups[0].rows).toHaveLength(2);
    expect(groups[0].status).toBe("available"); // 57 total sellable
    expect(groups[1].status).toBe("out_of_stock");
  });
});
