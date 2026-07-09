import { describe, expect, it, vi } from "vitest";

// Only PDC is mocked here — listQrProducts() reads the REAL manifest, so
// these tests catch a real regression in category counts/filtering that a
// fully-mocked test could hide.
vi.mock("@/lib/room-preview/product-resolver", () => ({
  resolveProductByCode: vi.fn(async (code: string) => ({
    ok: true,
    product: {
      id: code,
      barcode: code,
      name: code,
      productType: "floor_material",
      category: "PARQUET",
      targetSurface: "floor",
      imageUrl: `https://pdc-cdn.example.com/${code}.jpg`,
      source: "pdc",
    },
  })),
}));

import {
  buildQrPrintTabLinks,
  getQrPrintLabels,
  groupQrPrintLabelsByCategory,
  type QrPrintLabel,
} from "@/lib/room-preview/qr-print-labels";
import { QR_PRODUCT_MANIFEST } from "@/data/room-preview/qr-product-manifest";

function manifestCount(category: "PARQUET" | "WALLPAPER" | "CARPET_TILE") {
  return QR_PRODUCT_MANIFEST.filter((p) => p.category === category).length;
}

describe("QR manifest category counts", () => {
  it("has a non-zero PARQUET count and a non-zero WALLPAPER count, and exactly 30 CARPET_TILE codes", () => {
    expect(manifestCount("PARQUET")).toBeGreaterThan(0);
    expect(manifestCount("WALLPAPER")).toBeGreaterThan(0);
    expect(manifestCount("CARPET_TILE")).toBe(30);
  });
});

describe("getQrPrintLabels — against the real manifest", () => {
  it("category=PARQUET returns every PARQUET SKU in the manifest", async () => {
    const labels = await getQrPrintLabels("PARQUET");
    expect(labels).toHaveLength(manifestCount("PARQUET"));
    expect(labels.every((l) => l.category === "PARQUET")).toBe(true);
  });

  it("category=WALLPAPER returns every WALLPAPER SKU in the manifest", async () => {
    const labels = await getQrPrintLabels("WALLPAPER");
    expect(labels).toHaveLength(manifestCount("WALLPAPER"));
    expect(labels.every((l) => l.category === "WALLPAPER")).toBe(true);
  });

  it("category=CARPET_TILE returns all 30 CRPT SKUs in the manifest", async () => {
    const labels = await getQrPrintLabels("CARPET_TILE");
    expect(labels).toHaveLength(30);
    expect(labels.every((l) => l.category === "CARPET_TILE")).toBe(true);
  });

  it("no category filter returns the sum of every category (PARQUET + WALLPAPER + CARPET_TILE)", async () => {
    const labels = await getQrPrintLabels();
    expect(labels).toHaveLength(
      manifestCount("PARQUET") + manifestCount("WALLPAPER") + manifestCount("CARPET_TILE"),
    );
  });

  it("every /qr-print card keeps a /scan/{sku} QR URL", async () => {
    const labels = await getQrPrintLabels("CARPET_TILE");
    for (const label of labels) {
      expect(label.scanUrl.endsWith(`/scan/${label.productCode}`)).toBe(true);
    }
  });
});

describe("buildQrPrintTabLinks — category tab hrefs and active state", () => {
  it("produces exactly the four required hrefs, in order: الكل, باركيه, ورق جدران, بلاطات موكيت", () => {
    const tabs = buildQrPrintTabLinks(null);

    expect(tabs.map((t) => t.href)).toEqual([
      "/qr-print",
      "/qr-print?category=PARQUET",
      "/qr-print?category=WALLPAPER",
      "/qr-print?category=CARPET_TILE",
    ]);
    expect(tabs.map((t) => t.labelAr)).toEqual(["الكل", "باركيه", "ورق جدران", "بلاطات موكيت"]);
  });

  it("marks only 'الكل' active when there is no category filter", () => {
    const tabs = buildQrPrintTabLinks(null);
    expect(tabs.find((t) => t.href === "/qr-print")?.active).toBe(true);
    expect(tabs.filter((t) => t.active)).toHaveLength(1);
  });

  it("marks only 'باركيه' active for category=PARQUET", () => {
    const tabs = buildQrPrintTabLinks("PARQUET");
    expect(tabs.find((t) => t.href === "/qr-print?category=PARQUET")?.active).toBe(true);
    expect(tabs.filter((t) => t.active)).toHaveLength(1);
  });

  it("marks only 'ورق جدران' active for category=WALLPAPER", () => {
    const tabs = buildQrPrintTabLinks("WALLPAPER");
    expect(tabs.find((t) => t.href === "/qr-print?category=WALLPAPER")?.active).toBe(true);
    expect(tabs.filter((t) => t.active)).toHaveLength(1);
  });

  it("marks only 'بلاطات موكيت' active for category=CARPET_TILE", () => {
    const tabs = buildQrPrintTabLinks("CARPET_TILE");
    expect(tabs.find((t) => t.href === "/qr-print?category=CARPET_TILE")?.active).toBe(true);
    expect(tabs.filter((t) => t.active)).toHaveLength(1);
  });
});

describe("groupQrPrintLabelsByCategory — 'all' view", () => {
  it("includes sections for all three categories and does not hide CARPET_TILE", async () => {
    const labels = await getQrPrintLabels();
    const groups = groupQrPrintLabelsByCategory(labels, null);

    expect(groups.map((g) => g.category)).toEqual(["PARQUET", "WALLPAPER", "CARPET_TILE"]);
    expect(groups.find((g) => g.category === "PARQUET")?.labels).toHaveLength(manifestCount("PARQUET"));
    expect(groups.find((g) => g.category === "WALLPAPER")?.labels).toHaveLength(manifestCount("WALLPAPER"));
    expect(groups.find((g) => g.category === "CARPET_TILE")?.labels).toHaveLength(30);
  });

  it("a filtered (single-category) view produces exactly one group", async () => {
    const labels = await getQrPrintLabels("CARPET_TILE");
    const groups = groupQrPrintLabelsByCategory(labels, "CARPET_TILE");

    expect(groups).toHaveLength(1);
    expect(groups[0]?.category).toBe("CARPET_TILE");
    expect(groups[0]?.labels).toHaveLength(30);
  });

  it("keeps a category's group even when every label in it is unavailable", () => {
    const unavailableLabels: QrPrintLabel[] = Array.from({ length: 5 }, (_, i) => ({
      productCode: `CRPT999.${i}`,
      category: "CARPET_TILE",
      scanUrl: `https://example.com/scan/CRPT999.${i}`,
      qrDataUrl: "data:image/png;base64,x",
      productName: null,
      productImageUrl: null,
      unavailable: true,
    }));

    const groups = groupQrPrintLabelsByCategory(unavailableLabels, null);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.category).toBe("CARPET_TILE");
    expect(groups[0]?.labels).toHaveLength(5);
  });
});
