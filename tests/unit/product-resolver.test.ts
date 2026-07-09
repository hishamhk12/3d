import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveProductByCode } from "@/lib/room-preview/product-resolver";
import { PdcError } from "@/lib/room-preview/pdc-client";

vi.mock("@/lib/room-preview/pdc-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/room-preview/pdc-client")>();
  return {
    ...actual,
    fetchPdcProduct: vi.fn(),
  };
});

const { fetchPdcProduct } = vi.mocked(
  await import("@/lib/room-preview/pdc-client"),
);

const PRODUCT_JSON = {
  sku: "PAR006.10",
  product_name_ar: "باركيه",
  product_name_en: "Parquet",
  ecommerce_url: null,
  pdc_page_url: null,
  images: [{ type: "main", url: "https://cdn/main.jpg", width: null, height: null }],
};

describe("resolveProductByCode", () => {
  beforeEach(() => {
    fetchPdcProduct.mockReset();
  });

  it("resolves a supported SKU through PDC with classification applied", async () => {
    fetchPdcProduct.mockResolvedValue(PRODUCT_JSON);

    const result = await resolveProductByCode("PAR006.10");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.product).toMatchObject({
        id: "PAR006.10",
        category: "PARQUET",
        productType: "floor_material",
        targetSurface: "floor",
        imageUrl: "https://cdn/main.jpg",
        source: "pdc",
      });
    }
    expect(fetchPdcProduct).toHaveBeenCalledWith("PAR006.10");
  });

  it("classifies W-prefixed SKUs as wallpaper/walls", async () => {
    fetchPdcProduct.mockResolvedValue({ ...PRODUCT_JSON, sku: "W001" });

    const result = await resolveProductByCode("W001");

    expect(result.ok && result.product.targetSurface).toBe("walls");
    expect(result.ok && result.product.category).toBe("WALLPAPER");
  });

  it("rejects unsupported SKU prefixes before calling PDC", async () => {
    const result = await resolveProductByCode("X001");

    expect(result).toMatchObject({ ok: false, code: "UNSUPPORTED_PRODUCT_CATEGORY", status: 422 });
    expect(fetchPdcProduct).not.toHaveBeenCalled();
  });

  it("rejects empty or malformed codes with INVALID_SKU", async () => {
    expect(await resolveProductByCode("")).toMatchObject({ ok: false, code: "INVALID_SKU", status: 400 });
    expect(await resolveProductByCode("P 001")).toMatchObject({ ok: false, code: "INVALID_SKU", status: 400 });
    expect(fetchPdcProduct).not.toHaveBeenCalled();
  });

  it("maps PDC not_found to PRODUCT_NOT_FOUND 404", async () => {
    fetchPdcProduct.mockRejectedValue(new PdcError("not_found", "missing", 404));
    expect(await resolveProductByCode("P404")).toMatchObject({
      ok: false,
      code: "PRODUCT_NOT_FOUND",
      status: 404,
    });
  });

  it("maps PDC auth failures to PDC_AUTH_ERROR 500", async () => {
    fetchPdcProduct.mockRejectedValue(new PdcError("auth", "bad key", 401));
    expect(await resolveProductByCode("P001")).toMatchObject({
      ok: false,
      code: "PDC_AUTH_ERROR",
      status: 500,
    });
  });

  it("maps PDC unavailability to PDC_UNAVAILABLE 502", async () => {
    fetchPdcProduct.mockRejectedValue(new PdcError("unavailable", "down"));
    expect(await resolveProductByCode("P001")).toMatchObject({
      ok: false,
      code: "PDC_UNAVAILABLE",
      status: 502,
    });
  });

  it("returns PRODUCT_IMAGE_MISSING when PDC has no images for the product", async () => {
    fetchPdcProduct.mockResolvedValue({ ...PRODUCT_JSON, images: [] });
    expect(await resolveProductByCode("P001")).toMatchObject({
      ok: false,
      code: "PRODUCT_IMAGE_MISSING",
      status: 404,
    });
  });
});
