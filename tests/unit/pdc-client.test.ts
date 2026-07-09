import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPdcProductCache,
  fetchPdcProduct,
  isPdcError,
  PdcError,
} from "@/lib/room-preview/pdc-client";

const API_KEY = "pdc_test-key-value";
const BASE_URL = "https://pdc.example.com/api/v1/external/v1";

const PRODUCT_JSON = {
  sku: "PAR006.10",
  product_name_ar: "باركيه",
  product_name_en: "Parquet",
  ecommerce_url: null,
  pdc_page_url: null,
  images: [{ type: "main", url: "https://cdn/main.jpg", width: 2000, height: 2000 }],
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function expectPdcError(promise: Promise<unknown>, kind: PdcError["kind"]) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(PdcError);
  expect(isPdcError(error) && error.kind).toBe(kind);
  return error as PdcError;
}

describe("fetchPdcProduct", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    clearPdcProductCache();
    vi.stubEnv("PDC_API_BASE_URL", BASE_URL);
    vi.stubEnv("PDC_API_KEY", API_KEY);
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("requests the product with the X-Api-Key header and the SKU untouched", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, PRODUCT_JSON));

    const product = await fetchPdcProduct("pAr006.10");

    expect(product.sku).toBe("PAR006.10");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE_URL}/product/?sku=pAr006.10`);
    expect((init?.headers as Record<string, string>)["X-Api-Key"]).toBe(API_KEY);
    expect(init?.method).toBe("GET");
  });

  it("caches successful lookups per SKU", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, PRODUCT_JSON));

    await fetchPdcProduct("PAR006.10");
    await fetchPdcProduct("PAR006.10");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps 400 to bad_request", async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { error: "Missing required query parameter: sku" }));
    await expectPdcError(fetchPdcProduct("P001"), "bad_request");
  });

  it.each([401, 403])("maps %i to auth without leaking the key", async (status) => {
    fetchMock.mockResolvedValue(jsonResponse(status, { error: "Invalid or inactive API key." }));
    const error = await expectPdcError(fetchPdcProduct("P001"), "auth");
    expect(error.message).not.toContain(API_KEY);
  });

  it("maps 404 to not_found", async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: 'Product with SKU "P001" not found.' }));
    await expectPdcError(fetchPdcProduct("P001"), "not_found");
  });

  it("maps 500 to unavailable", async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, {}));
    await expectPdcError(fetchPdcProduct("P001"), "unavailable");
  });

  it("maps a timeout to unavailable", async () => {
    fetchMock.mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"));
    const error = await expectPdcError(fetchPdcProduct("P001"), "unavailable");
    expect(error.message).toContain("timed out");
  });

  it("maps a network failure to unavailable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expectPdcError(fetchPdcProduct("P001"), "unavailable");
  });

  it("maps unparseable JSON to unavailable", async () => {
    fetchMock.mockResolvedValue(new Response("<html>oops</html>", { status: 200 }));
    await expectPdcError(fetchPdcProduct("P001"), "unavailable");
  });

  it("fails as auth when configuration is missing, without calling PDC", async () => {
    vi.stubEnv("PDC_API_KEY", "");
    const error = await expectPdcError(fetchPdcProduct("P001"), "auth");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(error.message).not.toContain(API_KEY);
  });
});
