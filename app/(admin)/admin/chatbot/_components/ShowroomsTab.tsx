"use client";

// Showrooms tab: list/search/create/edit. No deletion (intentional this phase).
// Seller code/showroom code normalization happens SERVER-SIDE; the UI only sends
// raw values. Seller count is shown; a showroom with linked sellers cannot be
// removed because no delete path exists.
import { useEffect, useState } from "react";
import { Button, Spinner } from "@fluentui/react-components";
import Modal from "./Modal";
import { apiGet, apiSend, errorMessage } from "./client-api";
import type { SafeShowroom } from "@/lib/admin/chatbot/serialize";

interface FormState {
  open: boolean;
  mode: "create" | "edit";
  id?: string;
  name: string;
  code: string;
}

const EMPTY_FORM: FormState = { open: false, mode: "create", name: "", code: "" };

export default function ShowroomsTab() {
  const [showrooms, setShowrooms] = useState<SafeShowroom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

    // Fetch inside the effect (setState only after await - no synchronous cascading
  // render). Event handlers bump reloadKey to refresh.
  useEffect(() => {
    let ignore = false;
    (async () => {
      const r = await apiGet<{ showrooms: SafeShowroom[] }>(
        `/api/admin/chatbot/showrooms?q=${encodeURIComponent(q)}`,
      );
      if (ignore) return;
      if (!r.ok) setError(errorMessage(r, "Could not load showrooms."));
      else {
        setError(null);
        setShowrooms(r.data.showrooms ?? []);
      }
      setLoading(false);
    })();
    return () => {
      ignore = true;
    };
  }, [q, reloadKey]);

  async function submit() {
    setSaving(true);
    setFormError(null);
    const payload = { name: form.name, code: form.code };
    const r =
      form.mode === "create"
        ? await apiSend("/api/admin/chatbot/showrooms", "POST", payload)
        : await apiSend(`/api/admin/chatbot/showrooms/${form.id}`, "PATCH", payload);
    setSaving(false);
    if (!r.ok) {
      setFormError(errorMessage(r, "Could not save showroom."));
      return;
    }
    setForm(EMPTY_FORM);
    setReloadKey((k) => k + 1);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by code or name"
          className="h-9 w-64 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-[#115ea3]"
        />
        <div className="ml-auto">
          <Button appearance="primary" onClick={() => setForm({ ...EMPTY_FORM, open: true, mode: "create" })}>
            New showroom
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Code</th>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Sellers</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center">
                  <Spinner size="tiny" label="Loading..." />
                </td>
              </tr>
            ) : showrooms.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                  No showrooms found.
                </td>
              </tr>
            ) : (
              showrooms.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-mono font-semibold text-slate-900">{s.code}</td>
                  <td className="px-4 py-3 text-slate-700">{s.name}</td>
                  <td className="px-4 py-3 text-slate-600">{s.sellerCount}</td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="small"
                      appearance="secondary"
                      onClick={() =>
                        setForm({ open: true, mode: "edit", id: s.id, name: s.name, code: s.code })
                      }
                    >
                      Edit
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={form.open}
        title={form.mode === "create" ? "New showroom" : "Edit showroom"}
        onClose={() => setForm(EMPTY_FORM)}
      >
        <div className="space-y-3">
          <Field label="Name">
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="h-9 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-[#115ea3]"
            />
          </Field>
          <Field label="Code">
            <input
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
              placeholder="e.g. RIYADH"
              className="h-9 w-full rounded-md border border-slate-300 px-3 font-mono text-sm uppercase outline-none focus:border-[#115ea3]"
            />
            <p className="mt-1 text-xs text-slate-400">Stored normalized (trimmed, uppercased).</p>
          </Field>
          {formError && <p className="text-sm text-red-600">{formError}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button appearance="secondary" onClick={() => setForm(EMPTY_FORM)} disabled={saving}>
              Cancel
            </Button>
            <Button appearance="primary" onClick={submit} disabled={saving || !form.name.trim() || !form.code.trim()}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}
