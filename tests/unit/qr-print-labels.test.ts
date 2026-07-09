import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomPreviewProduct } from "@/lib/room-preview/types";

vi.mock("@/lib/room-preview/product-resolver", () => ({
  resolveProductByCode: vi.fn(),
}));

vi.mock("@/lib/room-preview/qr-products", () => ({
  listQrProducts: vi.fn(),
}));

import { getQrPrintLabels } from "@/lib/room-preview/qr-print-labels";
import { resolveProductByCode } from "@/lib/room-preview/product-resolver";
import { listQrProducts } from "@/lib/room-preview/qr-products";

const resolveMock = vi.mocked(resolveProductByCode);
const listMock = vi.mocked(listQrProducts);

function manifestEntry(
  id: string,
  category: "PARQUET" | "WALLPAPER" | "CARPET_TILE",
): RoomPreviewProduct {
  const productType = category === "WALLPAPER" ? "wall_material" : "floor_material";
  const targetSurface = category === "WALLPAPER" ? "walls" : "floor";
  return {
    id,
    barcode: id,
    name: id,
    productType,
    category,
    targetSurface,
    // Local manifest image — must never appear in the printed label output.
    imageUrl: `/qr-products/${category.toLowerCase().replace("_", "-")}/${id}.jpg`,
  };
}

function pdcProduct(id: string): RoomPreviewProduct {
  return {
    ...manifestEntry(id, "PARQUET"),
    name: "Oak Parquet (PDC)",
    imageUrl: `https://pdc-cdn.example.com/products/${id}/main.jpg`,
    source: "pdc",
  };
}

beforeEach(() => {
  resolveMock.mockReset();
  listMock.mockReset();
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://3d-ivory-rho.vercel.app");
  vi.stubEnv("PDC_API_KEY", "pdc_secret_key_value");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getQrPrintLabels", () => {
  it("uses PDC name and image (not the local manifest image) when PDC resolves", async () => {
    listMock.mockReturnValue([manifestEntry("PQC201.001", "PARQUET")]);
    resolveMock.mockResolvedValue({ ok: true, product: pdcProduct("PQC201.001") });

    const labels = await getQrPrintLabels();

    expect(labels).toHaveLength(1);
    expect(resolveMock).toHaveBeenCalledWith("PQC201.001");
    expect(labels[0].unavailable).toBe(false);
    expect(labels[0].productName).toBe("Oak Parquet (PDC)");
    expect(labels[0].productImageUrl).toBe(
      "https://pdc-cdn.example.com/products/PQC201.001/main.jpg",
    );
    expect(labels[0].productImageUrl).not.toContain("/qr-products/");
  });

  it("keeps the QR payload pointing at our /scan/{sku} URL", async () => {
    listMock.mockReturnValue([manifestEntry("PQC201.001", "PARQUET")]);
    resolveMock.mockResolvedValue({ ok: true, product: pdcProduct("PQC201.001") });

    const labels = await getQrPrintLabels();

    expect(labels[0].scanUrl).toBe("https://3d-ivory-rho.vercel.app/scan/PQC201.001");
    expect(labels[0].qrDataUrl.startsWith("data:image/png")).toBe(true);
  });

  it("marks the product unavailable on PDC failure without a local image fallback", async () => {
    listMock.mockReturnValue([manifestEntry("WPT01.1104-1", "WALLPAPER")]);
    resolveMock.mockResolvedValue({
      ok: false,
      code: "PDC_UNAVAILABLE",
      status: 502,
      error: "Product lookup failed. Please try again.",
    });

    const labels = await getQrPrintLabels();

    expect(labels[0].unavailable).toBe(true);
    expect(labels[0].productName).toBeNull();
    expect(labels[0].productImageUrl).toBeNull();
    // QR still prints and still opens our scan page.
    expect(labels[0].scanUrl).toBe("https://3d-ivory-rho.vercel.app/scan/WPT01.1104-1");
  });

  it("builds a CARPET_TILE (CRP) label with category preserved and PDC as the data source", async () => {
    listMock.mockReturnValue([manifestEntry("CRPT050.001", "CARPET_TILE")]);
    resolveMock.mockResolvedValue({
      ok: true,
      product: {
        ...manifestEntry("CRPT050.001", "CARPET_TILE"),
        name: "بلاطات موكيت رمادية (PDC)",
        imageUrl: "https://pdc-cdn.example.com/products/CRPT050.001/main.jpg",
        source: "pdc",
      },
    });

    const labels = await getQrPrintLabels();

    expect(resolveMock).toHaveBeenCalledWith("CRPT050.001");
    expect(labels[0].category).toBe("CARPET_TILE");
    expect(labels[0].unavailable).toBe(false);
    expect(labels[0].productName).toBe("بلاطات موكيت رمادية (PDC)");
    expect(labels[0].productImageUrl).toBe(
      "https://pdc-cdn.example.com/products/CRPT050.001/main.jpg",
    );
    // The QR still opens our own scan page, never a PDC URL directly.
    expect(labels[0].scanUrl).toBe("https://3d-ivory-rho.vercel.app/scan/CRPT050.001");
  });

  it("marks a CRP product unavailable (no local fallback image) when PDC does not have it yet", async () => {
    listMock.mockReturnValue([manifestEntry("CRPT060.303", "CARPET_TILE")]);
    resolveMock.mockResolvedValue({
      ok: false,
      code: "PRODUCT_NOT_FOUND",
      status: 404,
      error: "Product was not found.",
    });

    const labels = await getQrPrintLabels();

    expect(labels[0].category).toBe("CARPET_TILE");
    expect(labels[0].unavailable).toBe(true);
    expect(labels[0].productName).toBeNull();
    expect(labels[0].productImageUrl).toBeNull();
    // QR still prints and still opens our own /scan/{sku} page.
    expect(labels[0].scanUrl).toBe("https://3d-ivory-rho.vercel.app/scan/CRPT060.303");
  });

  it("never leaks the PDC API key into the label payload sent to the page", async () => {
    listMock.mockReturnValue([
      manifestEntry("PQC201.001", "PARQUET"),
      manifestEntry("WPT01.1104-1", "WALLPAPER"),
    ]);
    resolveMock
      .mockResolvedValueOnce({ ok: true, product: pdcProduct("PQC201.001") })
      .mockResolvedValueOnce({
        ok: false,
        code: "PDC_AUTH_ERROR",
        status: 500,
        error: "Product lookup is temporarily unavailable.",
      });

    const labels = await getQrPrintLabels();

    expect(JSON.stringify(labels)).not.toContain("pdc_secret_key_value");
  });
});
