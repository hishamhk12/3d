"use client";

import { useRef, useState, type DragEvent } from "react";
import { Badge, Button, Spinner } from "@fluentui/react-components";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = [".xlsx", ".csv"] as const;
const PREVIEW_URL = "/api/admin/chatbot/import/preview";
const APPLY_URL = "/api/admin/chatbot/import/apply";
const CANCEL_URL = "/api/admin/chatbot/import/cancel";

type Phase = "idle" | "selected" | "previewing" | "ready" | "applying" | "success" | "error";

interface PreviewResult {
  valid: boolean;
  totalParsedRows?: number;
  totalProducts?: number;
  totalWarehouseRows?: number;
  validationErrors?: unknown[];
  warnings?: unknown[];
  diff?: { added?: number; updated?: number; removed?: number };
  currentRows?: number;
  wouldEmptyInventory?: boolean;
  significantlySmaller?: boolean;
  confirmationAvailable?: boolean;
}

interface ApplyResult {
  status?: string;
  rowsImported?: number;
  rowsFailed?: number;
  totalRows?: number;
  filename?: string;
  errors?: unknown[];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileExtension(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx).toLowerCase() : "";
}

function validateFile(file: File): string | null {
  const ext = fileExtension(file.name);
  if (!SUPPORTED_EXTENSIONS.includes(ext as (typeof SUPPORTED_EXTENSIONS)[number])) {
    return "Only .xlsx and .csv files are supported.";
  }
  if (file.size > MAX_FILE_BYTES) {
    return "File is too large. Maximum size is 10 MB.";
  }
  if (file.size === 0) {
    return "File is empty.";
  }
  return null;
}

function makeForm(file: File): FormData {
  const form = new FormData();
  form.set("file", file, file.name);
  return form;
}

async function postForm<T>(url: string, form?: FormData): Promise<{ ok: boolean; status: number; data: T }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      cache: "no-store",
      body: form,
    });
    const data = (await res.json().catch(() => ({}))) as T;
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: {} as T };
  }
}

function safeError(data: unknown, fallback: string): string {
  const msg = (data as { error?: unknown } | null)?.error;
  return typeof msg === "string" ? msg : fallback;
}

function itemText(item: unknown): string {
  if (typeof item === "string") return item;
  if (item && typeof item === "object") {
    const rec = item as Record<string, unknown>;
    const message = rec.message ?? rec.error ?? rec.detail;
    if (typeof message === "string") return message;
  }
  return "Review this row before importing.";
}

function count(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function hasDestructiveRisk(preview: PreviewResult | null): boolean {
  if (!preview) return false;
  return Boolean(
    preview.wouldEmptyInventory ||
      preview.significantlySmaller ||
      count(preview.diff?.removed) > 0,
  );
}

function firstFile(files: FileList | null): File | null {
  return files?.[0] ?? files?.item?.(0) ?? null;
}

export default function ImportTab() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [destructiveConfirmed, setDestructiveConfirmed] = useState(false);
  const [inputKey, setInputKey] = useState(0);
  const busyRef = useRef(false);
  const hadPreviewRef = useRef(false);

  const busy = phase === "previewing" || phase === "applying";
  const destructiveRisk = hasDestructiveRisk(preview);
  const canConfirm =
    phase === "ready" &&
    Boolean(file && preview?.valid && preview.confirmationAvailable) &&
    (!destructiveRisk || destructiveConfirmed);

  async function cancelServerState() {
    await postForm(CANCEL_URL);
  }

  function resetLocal(nextPhase: Phase = "idle") {
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    setDestructiveConfirmed(false);
    setPhase(nextPhase);
    setInputKey((k) => k + 1);
    hadPreviewRef.current = false;
  }

  async function selectFile(nextFile: File | null) {
    if (!nextFile) return;
    const stalePreview = hadPreviewRef.current || phase === "ready";
    const validationError = validateFile(nextFile);
    if (stalePreview) {
      await cancelServerState();
      hadPreviewRef.current = false;
    }
    setResult(null);
    setPreview(null);
    setDestructiveConfirmed(false);
    setFile(nextFile);
    if (validationError) {
      setError(validationError);
      setPhase("error");
      return;
    }
    setError(null);
    setPhase("selected");
  }

  async function previewImport() {
    if (!file || busyRef.current) return;
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      setPhase("error");
      return;
    }

    busyRef.current = true;
    setPhase("previewing");
    setError(null);
    const res = await postForm<PreviewResult & { error?: string }>(PREVIEW_URL, makeForm(file));
    busyRef.current = false;
    if (!res.ok) {
      setPreview(null);
      setError(safeError(res.data, "Could not preview import."));
      setPhase("error");
      return;
    }
    setPreview(res.data);
    hadPreviewRef.current = Boolean(res.data.confirmationAvailable);
    setDestructiveConfirmed(false);
    setPhase("ready");
  }

  async function applyImport() {
    if (!file || !canConfirm || busyRef.current) return;
    busyRef.current = true;
    setPhase("applying");
    setError(null);
    const res = await postForm<ApplyResult & { error?: string }>(APPLY_URL, makeForm(file));
    busyRef.current = false;
    if (!res.ok) {
      setError(safeError(res.data, "Could not apply import."));
      setPhase("error");
      setPreview(null);
      hadPreviewRef.current = false;
      return;
    }
    setResult(res.data);
    setFile(null);
    setPreview(null);
    setDestructiveConfirmed(false);
    setPhase("success");
    setInputKey((k) => k + 1);
    hadPreviewRef.current = false;
  }

  async function cancelImport() {
    if (busyRef.current) return;
    busyRef.current = true;
    await cancelServerState();
    busyRef.current = false;
    resetLocal();
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    void selectFile(e.dataTransfer.files.item(0));
  }

  return (
    <div className="space-y-5">
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        className="rounded-xl border border-dashed border-slate-300 bg-white p-6 shadow-sm transition hover:border-[#115ea3]"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Inventory file</h2>
            <p className="mt-1 text-sm text-slate-500">Upload an Excel or CSV file for preview before replacement.</p>
          </div>
          <label className="inline-flex h-9 cursor-pointer items-center justify-center rounded-md bg-[#115ea3] px-4 text-sm font-medium text-white transition hover:bg-[#0f548c]">
            Choose file
            <input
              key={inputKey}
              type="file"
              accept=".xlsx,.csv"
              className="sr-only"
              disabled={busy}
              onChange={(e) => void selectFile(firstFile(e.currentTarget.files))}
            />
          </label>
        </div>
        <p className="mt-3 text-xs text-slate-400">Supported formats: .xlsx, .csv. Maximum size: 10 MB.</p>
      </div>

      {file && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-900">{file.name}</p>
            <p className="text-xs text-slate-500">{formatBytes(file.size)}</p>
          </div>
          <Button appearance="secondary" onClick={previewImport} disabled={busy || !file}>
            {phase === "previewing" ? "Previewing..." : "Preview import"}
          </Button>
          <Button appearance="secondary" onClick={cancelImport} disabled={busy}>
            Cancel
          </Button>
        </div>
      )}

      {phase === "previewing" && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <Spinner size="tiny" label="Previewing import..." />
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      {preview && <PreviewPanel preview={preview} />}

      {preview && destructiveRisk && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Destructive replacement warning</p>
          <p className="mt-1">
            This preview may remove existing inventory rows or replace the inventory with a much smaller file.
          </p>
          <label className="mt-3 flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={destructiveConfirmed}
              onChange={(e) => setDestructiveConfirmed(e.currentTarget.checked)}
            />
            I understand and want to confirm this import.
          </label>
        </div>
      )}

      {preview && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button appearance="secondary" onClick={cancelImport} disabled={busy}>
            Cancel
          </Button>
          <Button appearance="primary" onClick={applyImport} disabled={!canConfirm || busy}>
            {phase === "applying" ? "Applying..." : "Confirm import"}
          </Button>
        </div>
      )}

      {phase === "applying" && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <Spinner size="tiny" label="Applying import..." />
        </div>
      )}

      {phase === "success" && result && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <p className="font-semibold">Import completed</p>
          <p className="mt-1">
            {count(result.rowsImported)} rows imported
            {result.rowsFailed !== undefined ? `, ${count(result.rowsFailed)} failed` : ""}.
          </p>
          <div className="mt-3">
            <Button appearance="secondary" onClick={() => resetLocal()}>
              Start another import
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function PreviewPanel({ preview }: { preview: PreviewResult }) {
  const diff = preview.diff ?? {};
  const validationErrors = preview.validationErrors ?? [];
  const warnings = preview.warnings ?? [];

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900">Preview results</h2>
          <Badge appearance="tint" color={preview.valid ? "success" : "danger"}>
            {preview.valid ? "Valid" : "Invalid"}
          </Badge>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Parsed rows" value={preview.totalParsedRows} />
          <Metric label="Products" value={preview.totalProducts} />
          <Metric label="Warehouse rows" value={preview.totalWarehouseRows} />
          <Metric label="Current rows" value={preview.currentRows} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <DiffCard label="Added" value={diff.added} tone="emerald" />
        <DiffCard label="Updated" value={diff.updated} tone="blue" />
        <DiffCard label="Removed" value={diff.removed} tone="red" />
      </div>

      {(validationErrors.length > 0 || warnings.length > 0 || preview.wouldEmptyInventory || preview.significantlySmaller) && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900">Warnings and validation</h3>
          <div className="mt-3 space-y-3">
            {preview.wouldEmptyInventory && (
              <Notice tone="red" text="This import would empty the current inventory." />
            )}
            {preview.significantlySmaller && (
              <Notice tone="amber" text="This file is significantly smaller than the current inventory." />
            )}
            {validationErrors.length > 0 && (
              <List title="Validation errors" items={validationErrors} tone="red" />
            )}
            {warnings.length > 0 && <List title="Warnings" items={warnings} tone="amber" />}
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900">{value ?? "-"}</p>
    </div>
  );
}

function DiffCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | undefined;
  tone: "emerald" | "blue" | "red";
}) {
  const toneClass =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : tone === "red"
        ? "border-red-200 bg-red-50 text-red-800"
        : "border-sky-200 bg-sky-50 text-sky-800";
  return (
    <div className={`rounded-xl border p-4 shadow-sm ${toneClass}`}>
      <p className="text-xs font-medium uppercase tracking-wide opacity-75">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value ?? 0}</p>
    </div>
  );
}

function Notice({ text, tone }: { text: string; tone: "red" | "amber" }) {
  const cls = tone === "red" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-800";
  return <p className={`rounded-md border px-3 py-2 text-sm ${cls}`}>{text}</p>;
}

function List({ title, items, tone }: { title: string; items: unknown[]; tone: "red" | "amber" }) {
  const titleCls = tone === "red" ? "text-red-700" : "text-amber-800";
  return (
    <div>
      <p className={`text-sm font-medium ${titleCls}`}>{title}</p>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-600">
        {items.map((item, idx) => (
          <li key={idx}>{itemText(item)}</li>
        ))}
      </ul>
    </div>
  );
}
