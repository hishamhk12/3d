import { describe, expect, it, vi } from "vitest";

// The real manifest now spans 4 categories / 130+ SKUs (PARQUET + WALLPAPER +
// 30 CARPET_TILE + 50 WALL_CLADDING). getQrPrintLabels() resolves every SKU
// through PDC_LOOKUP_CONCURRENCY-sized batches plus per-label logging, which
// comfortably clears the default 5s test timeout under normal load but not
// always in a slower CI/sandbox environment — raised once for the whole file
// rather than guessing a timeout per test.
vi.setConfig({ testTimeout: 20_000 });

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

function manifestCount(category: "PARQUET" | "WALLPAPER" | "CARPET_TILE" | "WALL_CLADDING") {
  return QR_PRODUCT_MANIFEST.filter((p) => p.category === category).length;
}

describe("QR manifest category counts", () => {
  it("has a non-zero PARQUET count and a non-zero WALLPAPER count, exactly 30 CARPET_TILE codes, and exactly 50 WALL_CLADDING codes", () => {
    expect(manifestCount("PARQUET")).toBeGreaterThan(0);
    expect(manifestCount("WALLPAPER")).toBeGreaterThan(0);
    expect(manifestCount("CARPET_TILE")).toBe(30);
    expect(manifestCount("WALL_CLADDING")).toBe(50);
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

  it("category=WALL_CLADDING returns all 50 wall-cladding SKUs in the manifest, with availability attached", async () => {
    const labels = await getQrPrintLabels("WALL_CLADDING");
    expect(labels).toHaveLength(50);
    expect(labels.every((l) => l.category === "WALL_CLADDING")).toBe(true);
    expect(labels.every((l) => l.availability === "regular" || l.availability === "clearance")).toBe(true);
    expect(labels.filter((l) => l.availability === "regular")).toHaveLength(30);
    expect(labels.filter((l) => l.availability === "clearance")).toHaveLength(20);
  });

  it("no category filter returns the sum of every category (PARQUET + WALLPAPER + CARPET_TILE + WALL_CLADDING)", async () => {
    const labels = await getQrPrintLabels();
    expect(labels).toHaveLength(
      manifestCount("PARQUET") +
        manifestCount("WALLPAPER") +
        manifestCount("CARPET_TILE") +
        manifestCount("WALL_CLADDING"),
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
  it("produces exactly the five required hrefs, in order: الكل, باركيه, ورق جدران, بلاطات موكيت, كسوات الجدران", () => {
    const tabs = buildQrPrintTabLinks(null);

    expect(tabs.map((t) => t.href)).toEqual([
      "/qr-print",
      "/qr-print?category=PARQUET",
      "/qr-print?category=WALLPAPER",
      "/qr-print?category=CARPET_TILE",
      "/qr-print?category=WALL_CLADDING",
    ]);
    expect(tabs.map((t) => t.labelAr)).toEqual([
      "الكل",
      "باركيه",
      "ورق جدران",
      "بلاطات موكيت",
      "كسوات الجدران",
    ]);
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

  it("marks only 'كسوات الجدران' active for category=WALL_CLADDING", () => {
    const tabs = buildQrPrintTabLinks("WALL_CLADDING");
    expect(tabs.find((t) => t.href === "/qr-print?category=WALL_CLADDING")?.active).toBe(true);
    expect(tabs.filter((t) => t.active)).toHaveLength(1);
  });
});

describe("groupQrPrintLabelsByCategory — 'all' view", () => {
  it("includes sections for all four categories and does not hide CARPET_TILE or WALL_CLADDING", async () => {
    const labels = await getQrPrintLabels();
    const groups = groupQrPrintLabelsByCategory(labels, null);

    expect(groups.map((g) => g.category)).toEqual(["PARQUET", "WALLPAPER", "CARPET_TILE", "WALL_CLADDING"]);
    expect(groups.find((g) => g.category === "PARQUET")?.labels).toHaveLength(manifestCount("PARQUET"));
    expect(groups.find((g) => g.category === "WALLPAPER")?.labels).toHaveLength(manifestCount("WALLPAPER"));
    expect(groups.find((g) => g.category === "CARPET_TILE")?.labels).toHaveLength(30);
    expect(groups.find((g) => g.category === "WALL_CLADDING")?.labels).toHaveLength(50);
  });

  it("a filtered (single-category) view produces exactly one group", async () => {
    const labels = await getQrPrintLabels("CARPET_TILE");
    const groups = groupQrPrintLabelsByCategory(labels, "CARPET_TILE");

    expect(groups).toHaveLength(1);
    expect(groups[0]?.category).toBe("CARPET_TILE");
    expect(groups[0]?.labels).toHaveLength(30);
  });

  it("a filtered WALL_CLADDING view produces exactly one group of 50", async () => {
    const labels = await getQrPrintLabels("WALL_CLADDING");
    const groups = groupQrPrintLabelsByCategory(labels, "WALL_CLADDING");

    expect(groups).toHaveLength(1);
    expect(groups[0]?.category).toBe("WALL_CLADDING");
    expect(groups[0]?.labels).toHaveLength(50);
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
      availability: null,
    }));

    const groups = groupQrPrintLabelsByCategory(unavailableLabels, null);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.category).toBe("CARPET_TILE");
    expect(groups[0]?.labels).toHaveLength(5);
  });
});
