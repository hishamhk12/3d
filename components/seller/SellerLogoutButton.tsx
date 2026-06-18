"use client";

// Minimal logout control for the seller area. Calls the seller logout API (which
// clears only the seller_session cookie) then navigates to the login selector.
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SellerLogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onLogout() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/seller/auth/logout", { method: "POST" });
    } catch {
      // Best-effort; navigate regardless so the user leaves the protected area.
    } finally {
      router.push("/login?type=seller");
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={onLogout}
      disabled={busy}
      className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
    >
      {busy ? "جارٍ الخروج…" : "تسجيل الخروج"}
    </button>
  );
}
