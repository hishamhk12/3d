"use client";

// Sellers tab: list/search/filter + create/edit/activate/disable/reset-password/
// force-logout. All identity/normalization/hashing happens SERVER-SIDE; the UI
// only sends safe fields. The server bumps tokenVersion on disable/reset/force-
// logout/showroom-change, so those immediately invalidate active seller sessions.
import { useEffect, useState } from "react";
import { Badge, Button, Spinner } from "@fluentui/react-components";
import Modal from "./Modal";
import { apiGet, apiSend, errorMessage } from "./client-api";
import type { SafeSeller, SafeShowroom } from "@/lib/admin/chatbot/serialize";

type Dialog =
  | { kind: "none" }
  | { kind: "create" }
  | { kind: "edit"; seller: SafeSeller }
  | { kind: "reset"; seller: SafeSeller };

export default function SellersTab() {
  const [sellers, setSellers] = useState<SafeSeller[]>([]);
  const [showrooms, setShowrooms] = useState<SafeShowroom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [showroomId, setShowroomId] = useState("");
  const [status, setStatus] = useState("");

  const [dialog, setDialog] = useState<Dialog>({ kind: "none" });
  const [reloadKey, setReloadKey] = useState(0);

  const reload = () => setReloadKey((k) => k + 1);

  // Showrooms for the filter + create/edit dropdowns (fetched once on mount).
  useEffect(() => {
    let ignore = false;
    (async () => {
      const r = await apiGet<{ showrooms: SafeShowroom[] }>("/api/admin/chatbot/showrooms");
      if (!ignore && r.ok) setShowrooms(r.data.showrooms ?? []);
    })();
    return () => {
      ignore = true;
    };
  }, []);

  // Sellers list (re-fetches on filter change or after a mutation bumps reloadKey).
  useEffect(() => {
    let ignore = false;
    (async () => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (showroomId) params.set("showroomId", showroomId);
      if (status) params.set("status", status);
      const r = await apiGet<{ sellers: SafeSeller[] }>(`/api/admin/chatbot/sellers?${params}`);
      if (ignore) return;
      if (!r.ok) setError(errorMessage(r, "Could not load sellers."));
      else {
        setError(null);
        setSellers(r.data.sellers ?? []);
      }
      setLoading(false);
    })();
    return () => {
      ignore = true;
    };
  }, [q, showroomId, status, reloadKey]);

  async function act(seller: SafeSeller, body: Record<string, unknown>) {
    setBusyId(seller.id);
    const r = await apiSend(`/api/admin/chatbot/sellers/${seller.id}`, "PATCH", body);
    setBusyId(null);
    if (!r.ok) {
      setError(errorMessage(r, "Action failed."));
      return;
    }
    reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by code or name"
          className="h-9 w-56 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-[#115ea3]"
        />
        <select
          value={showroomId}
          onChange={(e) => setShowroomId(e.target.value)}
          className="h-9 rounded-md border border-slate-300 px-2 text-sm outline-none focus:border-[#115ea3]"
        >
          <option value="">All showrooms</option>
          {showrooms.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-9 rounded-md border border-slate-300 px-2 text-sm outline-none focus:border-[#115ea3]"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
        </select>
        <div className="ml-auto">
          <Button appearance="primary" onClick={() => setDialog({ kind: "create" })}>
            New seller
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
              <th className="px-4 py-3 font-medium">Showroom</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center">
                  <Spinner size="tiny" label="Loading..." />
                </td>
              </tr>
            ) : sellers.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  No sellers found.
                </td>
              </tr>
            ) : (
              sellers.map((s) => {
                const busy = busyId === s.id;
                return (
                  <tr key={s.id} className="align-middle hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-mono font-semibold text-slate-900">{s.sellerCode}</td>
                    <td className="px-4 py-3 text-slate-700">{s.name}</td>
                    <td className="px-4 py-3 text-slate-600">{s.showroom?.code ?? "-"}</td>
                    <td className="px-4 py-3">
                      <Badge appearance="tint" color={s.status === "active" ? "success" : "danger"}>
                        {s.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        <Button size="small" appearance="secondary" disabled={busy} onClick={() => setDialog({ kind: "edit", seller: s })}>
                          Edit
                        </Button>
                        {s.status === "active" ? (
                          <Button size="small" appearance="secondary" disabled={busy} onClick={() => act(s, { action: "disable" })}>
                            Disable
                          </Button>
                        ) : (
                          <Button size="small" appearance="secondary" disabled={busy} onClick={() => act(s, { action: "activate" })}>
                            Activate
                          </Button>
                        )}
                        <Button size="small" appearance="secondary" disabled={busy} onClick={() => setDialog({ kind: "reset", seller: s })}>
                          Reset password
                        </Button>
                        <Button size="small" appearance="secondary" disabled={busy} onClick={() => act(s, { action: "force_logout" })}>
                          Force logout
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {dialog.kind === "create" && (
        <CreateSellerDialog
          showrooms={showrooms}
          onClose={() => setDialog({ kind: "none" })}
          onSaved={() => {
            setDialog({ kind: "none" });
            reload();
          }}
        />
      )}
      {dialog.kind === "edit" && (
        <EditSellerDialog
          seller={dialog.seller}
          showrooms={showrooms}
          onClose={() => setDialog({ kind: "none" })}
          onSaved={() => {
            setDialog({ kind: "none" });
            reload();
          }}
        />
      )}
      {dialog.kind === "reset" && (
        <ResetPasswordDialog
          seller={dialog.seller}
          onClose={() => setDialog({ kind: "none" })}
          onSaved={() => {
            setDialog({ kind: "none" });
            reload();
          }}
        />
      )}
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </label>
  );
}

const inputCls = "h-9 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-[#115ea3]";

function CreateSellerDialog({
  showrooms,
  onClose,
  onSaved,
}: {
  showrooms: SafeShowroom[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [sellerCode, setSellerCode] = useState("");
  const [showroomId, setShowroomId] = useState(showrooms[0]?.id ?? "");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"active" | "disabled">("disabled");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setErr(null);
    const r = await apiSend("/api/admin/chatbot/sellers", "POST", {
      name,
      sellerCode,
      showroomId,
      password,
      status,
    });
    setSaving(false);
    if (!r.ok) {
      setErr(errorMessage(r, "Could not create seller."));
      return;
    }
    onSaved();
  }

  return (
    <Modal open title="New seller" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Seller code" hint="Stored normalized (trimmed, uppercased).">
          <input value={sellerCode} onChange={(e) => setSellerCode(e.target.value)} className={`${inputCls} font-mono uppercase`} />
        </Field>
        <Field label="Showroom">
          <select value={showroomId} onChange={(e) => setShowroomId(e.target.value)} className={inputCls}>
            {showrooms.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} - {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Initial password" hint="Hashed server-side; never stored or shown in plaintext.">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} autoComplete="new-password" />
        </Field>
        <Field label="Status">
          <select value={status} onChange={(e) => setStatus(e.target.value as "active" | "disabled")} className={inputCls}>
            <option value="disabled">Disabled (default)</option>
            <option value="active">Active</option>
          </select>
        </Field>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button appearance="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button appearance="primary" onClick={submit} disabled={saving || !name.trim() || !sellerCode.trim() || !showroomId || !password}>
            {saving ? "Creating..." : "Create"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function EditSellerDialog({
  seller,
  showrooms,
  onClose,
  onSaved,
}: {
  seller: SafeSeller;
  showrooms: SafeShowroom[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(seller.name);
  const [showroomId, setShowroomId] = useState(seller.showroom?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setErr(null);
    const body: Record<string, unknown> = { action: "update_profile" };
    if (name !== seller.name) body.name = name;
    if (showroomId && showroomId !== seller.showroom?.id) body.showroomId = showroomId;
    const r = await apiSend(`/api/admin/chatbot/sellers/${seller.id}`, "PATCH", body);
    setSaving(false);
    if (!r.ok) {
      setErr(errorMessage(r, "Could not update seller."));
      return;
    }
    onSaved();
  }

  const changed = name !== seller.name || (showroomId && showroomId !== seller.showroom?.id);

  return (
    <Modal open title={`Edit ${seller.sellerCode}`} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Showroom" hint="Changing the showroom invalidates active seller sessions.">
          <select value={showroomId} onChange={(e) => setShowroomId(e.target.value)} className={inputCls}>
            {showrooms.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} - {s.name}
              </option>
            ))}
          </select>
        </Field>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button appearance="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button appearance="primary" onClick={submit} disabled={saving || !name.trim() || !changed}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ResetPasswordDialog({
  seller,
  onClose,
  onSaved,
}: {
  seller: SafeSeller;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setErr(null);
    const r = await apiSend(`/api/admin/chatbot/sellers/${seller.id}`, "PATCH", {
      action: "reset_password",
      password,
    });
    setSaving(false);
    if (!r.ok) {
      setErr(errorMessage(r, "Could not reset password."));
      return;
    }
    onSaved();
  }

  return (
    <Modal open title={`Reset password - ${seller.sellerCode}`} onClose={onClose}>
      <div className="space-y-3">
        <Field label="New password" hint="Hashed server-side; resetting signs the seller out of all sessions.">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} autoComplete="new-password" />
        </Field>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button appearance="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button appearance="primary" onClick={submit} disabled={saving || !password}>
            {saving ? "Resetting..." : "Reset password"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
