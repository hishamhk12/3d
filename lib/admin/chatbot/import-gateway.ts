import "server-only";

import type { NextResponse } from "next/server";

export const IMPORT_CONFIRMATION_COOKIE = "admin_chatbot_import_confirmation";
export const IMPORT_COOKIE_PATH = "/api/admin/chatbot/import";
export const IMPORT_CONFIRMATION_MAX_AGE_SECONDS = 10 * 60;
export const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;

const SUPPORTED_MIME_BY_EXTENSION: Record<string, Set<string>> = {
  ".xlsx": new Set(["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]),
  ".csv": new Set(["text/csv", "application/csv", "application/vnd.ms-excel"]),
};

export type ImportFileValidation =
  | { ok: true; file: File; filename: string }
  | { ok: false; status: number; error: string };

export function sanitizeImportFilename(rawName: string): string {
  const leaf = (rawName || "inventory").split(/[\\/]/).pop() || "inventory";
  const cleaned = leaf
    .normalize("NFKC")
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return cleaned || "inventory";
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
}

export function validateImportFile(formData: FormData): ImportFileValidation {
  const value = formData.get("file");
  if (!(value instanceof File)) {
    return { ok: false, status: 400, error: "Import file is required" };
  }

  const filename = sanitizeImportFilename(value.name);
  const ext = extensionOf(filename);
  const allowedMimes = SUPPORTED_MIME_BY_EXTENSION[ext];
  if (!allowedMimes) {
    return { ok: false, status: 400, error: "Unsupported import file type" };
  }

  if (value.size <= 0) {
    return { ok: false, status: 400, error: "Import file is empty" };
  }
  if (value.size > MAX_IMPORT_FILE_BYTES) {
    return { ok: false, status: 413, error: "Import file is too large" };
  }

  if (!allowedMimes.has(value.type)) {
    return { ok: false, status: 400, error: "Unsupported import file MIME type" };
  }

  return { ok: true, file: value, filename };
}

export function buildUpstreamImportForm(file: File, filename: string, token?: string): FormData {
  const form = new FormData();
  form.set("file", file, filename);
  if (token) form.set("token", token);
  return form;
}

export function setConfirmationCookie(response: NextResponse, token: string): void {
  response.cookies.set(IMPORT_CONFIRMATION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: IMPORT_COOKIE_PATH,
    maxAge: IMPORT_CONFIRMATION_MAX_AGE_SECONDS,
  });
}

export function clearConfirmationCookie(response: NextResponse): void {
  response.cookies.set(IMPORT_CONFIRMATION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: IMPORT_COOKIE_PATH,
    maxAge: 0,
  });
}

type PreviewPayload = {
  valid?: unknown;
  totalParsedRows?: unknown;
  totalProducts?: unknown;
  totalWarehouseRows?: unknown;
  validationErrors?: unknown;
  diff?: unknown;
  warnings?: unknown;
  wouldEmptyInventory?: unknown;
  significantlySmaller?: unknown;
  currentRows?: unknown;
  confirmation?: { token?: unknown } | null;
};

export function safePreviewResponse(data: PreviewPayload) {
  return {
    valid: data.valid === true,
    totalParsedRows: typeof data.totalParsedRows === "number" ? data.totalParsedRows : 0,
    totalProducts: typeof data.totalProducts === "number" ? data.totalProducts : 0,
    totalWarehouseRows: typeof data.totalWarehouseRows === "number" ? data.totalWarehouseRows : 0,
    validationErrors: Array.isArray(data.validationErrors) ? data.validationErrors : [],
    diff: data.diff ?? null,
    warnings: Array.isArray(data.warnings) ? data.warnings : [],
    wouldEmptyInventory: data.wouldEmptyInventory === true,
    significantlySmaller: data.significantlySmaller === true,
    currentRows: typeof data.currentRows === "number" ? data.currentRows : 0,
    confirmationAvailable: typeof data.confirmation?.token === "string" && data.confirmation.token.length > 0,
  };
}

type ApplyPayload = {
  status?: unknown;
  mode?: unknown;
  filename?: unknown;
  totalRows?: unknown;
  rowsImported?: unknown;
  rowsFailed?: unknown;
  errors?: unknown;
  backupId?: unknown;
  error?: unknown;
};

export function safeApplyResponse(data: ApplyPayload) {
  return {
    status: typeof data.status === "string" ? data.status : "unknown",
    mode: typeof data.mode === "string" ? data.mode : "replace",
    filename: typeof data.filename === "string" ? sanitizeImportFilename(data.filename) : null,
    totalRows: typeof data.totalRows === "number" ? data.totalRows : null,
    rowsImported: typeof data.rowsImported === "number" ? data.rowsImported : null,
    rowsFailed: typeof data.rowsFailed === "number" ? data.rowsFailed : null,
    errors: Array.isArray(data.errors) ? data.errors : [],
    backupId: typeof data.backupId === "string" ? data.backupId : null,
    error: typeof data.error === "string" ? "Import confirmation failed" : undefined,
  };
}

export function safeImportError(status = 502): ResponseInit {
  return { status };
}

