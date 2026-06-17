import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/admin/require-admin", () => ({ requireAdminResponse: vi.fn() }));
vi.mock("@/lib/admin/fastapi-internal", () => ({ internalAdminFetchJson: vi.fn() }));

const cookieGetMock = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: cookieGetMock })),
}));

import { POST as preview } from "@/app/api/admin/chatbot/import/preview/route";
import { POST as apply } from "@/app/api/admin/chatbot/import/apply/route";
import { POST as cancel } from "@/app/api/admin/chatbot/import/cancel/route";
import { requireAdminResponse } from "@/lib/admin/require-admin";
import { internalAdminFetchJson } from "@/lib/admin/fastapi-internal";
import { IMPORT_CONFIRMATION_COOKIE } from "@/lib/admin/chatbot/import-gateway";

const authMock = requireAdminResponse as unknown as ReturnType<typeof vi.fn>;
const upstreamMock = internalAdminFetchJson as unknown as ReturnType<typeof vi.fn>;

const SECRET = "internal-admin-secret-32-bytes-long";
const FASTAPI_URL = "https://fastapi.internal.local";
const JWT = "eyJ.internal.jwt";

function makeFile(
  name = "inventory.xlsx",
  size = 12,
  type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
) {
  return new File([new Uint8Array(size)], name, { type });
}

function formRequest(file: File): Request {
  const form = new FormData();
  form.set("file", file);
  return new Request("http://localhost/api/admin/chatbot/import/preview", {
    method: "POST",
    body: form,
  });
}

function upstreamPreview(token = "confirm-token") {
  upstreamMock.mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      valid: true,
      totalParsedRows: 3,
      totalProducts: 1,
      totalWarehouseRows: 3,
      validationErrors: [],
      diff: { addedRows: 3 },
      warnings: [],
      wouldEmptyInventory: false,
      significantlySmaller: false,
      currentRows: 7,
      fileChecksum: "hidden",
      contentChecksum: "hidden",
      confirmation: { token, expiresAt: "2026-06-17T08:40:00Z" },
    },
  });
}

function upstreamApply() {
  upstreamMock.mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      status: "success",
      mode: "replace",
      filename: "inventory.xlsx",
      totalRows: 1,
      rowsImported: 3,
      rowsFailed: 0,
      errors: [],
      backupId: "backup-1",
    },
  });
}

async function json(res: Response) {
  return res.json() as Promise<Record<string, unknown>>;
}

function expectNoLeak(payload: unknown) {
  const text = JSON.stringify(payload);
  for (const forbidden of [
    SECRET,
    FASTAPI_URL,
    JWT,
    "Authorization",
    "Bearer ",
    "INTERNAL_JWT_SECRET",
    "CHATBOT_FASTAPI_URL",
    "DATABASE_URL",
    "Traceback",
  ]) {
    expect(text).not.toContain(forbidden);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue(null);
  cookieGetMock.mockReturnValue(undefined);
  upstreamPreview();
});

describe("admin chatbot import routes", () => {
  it("requires admin for preview/apply/cancel", async () => {
    authMock.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

    expect((await preview(formRequest(makeFile()))).status).toBe(401);
    expect((await apply(formRequest(makeFile()))).status).toBe(401);
    expect((await cancel()).status).toBe(401);
    expect(upstreamMock).not.toHaveBeenCalled();
  });

  it("rejects unsupported files and oversized files", async () => {
    let res = await preview(formRequest(makeFile("inventory.txt", 10, "text/plain")));
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: "Unsupported import file type" });

    res = await preview(formRequest(makeFile("inventory.xlsx", 10 * 1024 * 1024 + 1)));
    expect(res.status).toBe(413);
    expect(await json(res)).toEqual({ error: "Import file is too large" });
    expect(upstreamMock).not.toHaveBeenCalled();
  });

  it("sanitizes filenames before forwarding preview to FastAPI", async () => {
    const res = await preview(formRequest(makeFile("..\\evil/<script>.xlsx")));
    expect(res.status).toBe(200);

    const body = upstreamMock.mock.calls[0][1].body as FormData;
    const forwarded = body.get("file") as File;
    expect(forwarded.name).toBe("_script_.xlsx");
  });

  it("stores preview token only in an HttpOnly cookie and omits it from JSON", async () => {
    const res = await preview(formRequest(makeFile()));
    const body = await json(res);

    expect(body.confirmationAvailable).toBe(true);
    expect(JSON.stringify(body)).not.toContain("confirm-token");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${IMPORT_CONFIRMATION_COOKIE}=confirm-token`);
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");
    expect(setCookie).toContain("Path=/api/admin/chatbot/import");
    expect(setCookie).toContain("Max-Age=600");
    expectNoLeak(body);
  });

  it("apply requires a confirmation cookie", async () => {
    const res = await apply(formRequest(makeFile()));
    const body = await json(res);

    expect(res.status).toBe(400);
    expect(body.error).toBe("Import confirmation is not available");
    expect(upstreamMock).not.toHaveBeenCalled();
  });

  it("apply forwards the HttpOnly cookie token server-side and clears cookie", async () => {
    cookieGetMock.mockReturnValue({ value: "server-cookie-token" });
    upstreamApply();

    const res = await apply(formRequest(makeFile()));
    const body = await json(res);

    expect(res.status).toBe(200);
    expect(body.rowsImported).toBe(3);
    expect(JSON.stringify(body)).not.toContain("server-cookie-token");
    expect(upstreamMock).toHaveBeenCalledWith(
      "/internal/import/inventory/confirm",
      expect.objectContaining({ method: "POST", timeoutMs: 60_000 }),
    );
    const form = upstreamMock.mock.calls[0][1].body as FormData;
    expect(form.get("token")).toBe("server-cookie-token");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${IMPORT_CONFIRMATION_COOKIE}=`);
    expect(setCookie).toContain("Max-Age=0");
    expectNoLeak(body);
  });

  it("clears cookie after upstream apply failure and does not expose raw errors", async () => {
    cookieGetMock.mockReturnValue({ value: "server-cookie-token" });
    upstreamMock.mockResolvedValue({
      ok: false,
      status: 500,
      error: {
        code: "upstream",
        message: `raw ${FASTAPI_URL} ${SECRET} Authorization Bearer ${JWT} Traceback`,
      },
    });

    const res = await apply(formRequest(makeFile()));
    const body = await json(res);

    expect(res.status).toBe(502);
    expect(body.error).toBe("Could not apply import");
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
    expectNoLeak(body);
  });

  it("cancel clears confirmation cookie", async () => {
    const res = await cancel();
    const body = await json(res);

    expect(body.cancelled).toBe(true);
    expect(res.headers.get("set-cookie")).toContain(`${IMPORT_CONFIRMATION_COOKIE}=`);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("does not expose raw upstream preview errors", async () => {
    upstreamMock.mockResolvedValue({
      ok: false,
      status: 502,
      error: {
        code: "network",
        message: `raw ${FASTAPI_URL} ${SECRET} Authorization Bearer ${JWT}`,
      },
    });

    const res = await preview(formRequest(makeFile()));
    const body = await json(res);

    expect(res.status).toBe(502);
    expect(body.error).toBe("Could not preview import");
    expectNoLeak(body);
  });
});
