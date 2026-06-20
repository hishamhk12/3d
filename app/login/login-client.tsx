"use client";

// Login-type selector. Customer preserves the existing customer entry
// (navigates to /room-preview). Seller posts to the seller login API and, on
// success, redirects to /seller/chat.
import { useState } from "react";
import { useRouter } from "next/navigation";

export type LoginMode = "default" | "customer" | "seller";
type Tab = "customer" | "seller";

// Approved design-system primitives (shared visual language with the
// role-selection screen): charcoal pill button with enlarged Arabic text, and
// a clean white input. Kept local to avoid cross-module coupling.
const LOGIN_PILL =
  "flex h-14 w-full items-center justify-center rounded-[32px] text-lg font-bold text-white " +
  "transition-all duration-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-[#192126]/45 focus-visible:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed";
const CHARCOAL_STYLE = { background: "#192126", boxShadow: "0 10px 26px rgba(25,33,38,0.28)" } as const;
const LOGIN_INPUT =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base text-slate-900 " +
  "focus:border-[var(--brand-cyan)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-cyan)]/25";

export function LoginClient({ mode }: { mode: LoginMode }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("customer");
  const [sellerCode, setSellerCode] = useState("");
  const [showroomCode, setShowroomCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const activeTab: Tab = mode === "seller" ? "seller" : mode === "customer" ? "customer" : tab;
  const showSwitcher = mode === "default";

  async function onSellerSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/seller/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sellerCode, showroomCode, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        router.push(data?.redirectTo ?? "/seller/chat");
        return;
      }
      setError(data?.error ?? "تعذر تسجيل الدخول. حاول مرة أخرى.");
    } catch {
      setError("تعذر الاتصال بالخادم. تحقق من اتصالك وحاول مرة أخرى.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div dir="rtl" className="flex min-h-screen items-center justify-center bg-white px-5">
      <div className="w-full max-w-sm">
        <h1 className="mb-7 text-center font-display text-2xl font-extrabold text-[#192126]">
          {mode === "seller" ? "تسجيل دخول البائع" : "تسجيل الدخول"}
        </h1>

        {showSwitcher ? (
          <div className="mb-6 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setTab("customer")}
              className={`rounded-xl px-3 py-2.5 text-base font-bold transition ${
                activeTab === "customer" ? "bg-white text-[#192126] shadow-sm" : "text-slate-500"
              }`}
            >
              عميل
            </button>
            <button
              type="button"
              onClick={() => setTab("seller")}
              className={`rounded-xl px-3 py-2.5 text-base font-bold transition ${
                activeTab === "seller" ? "bg-white text-[#192126] shadow-sm" : "text-slate-500"
              }`}
            >
              بائع
            </button>
          </div>
        ) : null}

        {activeTab === "customer" ? (
          <div className="space-y-5 text-center">
            <p className="text-base text-slate-600">تابع كعميل لاستخدام معاينة الغرفة كالمعتاد.</p>
            <button
              type="button"
              onClick={() => router.push("/room-preview")}
              className={LOGIN_PILL}
              style={CHARCOAL_STYLE}
            >
              المتابعة كعميل
            </button>
          </div>
        ) : (
          <form onSubmit={onSellerSubmit} className="space-y-4">
            {error ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            ) : null}

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="sellerCode">
                رمز البائع
              </label>
              <input
                id="sellerCode"
                name="sellerCode"
                value={sellerCode}
                onChange={(e) => setSellerCode(e.target.value)}
                autoComplete="username"
                required
                className={LOGIN_INPUT}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="showroomCode">
                رمز المعرض
              </label>
              <input
                id="showroomCode"
                name="showroomCode"
                value={showroomCode}
                onChange={(e) => setShowroomCode(e.target.value)}
                required
                className={LOGIN_INPUT}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="password">
                كلمة المرور
              </label>
              <input
                id="password"
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                className={LOGIN_INPUT}
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className={`${LOGIN_PILL} mt-1`}
              style={CHARCOAL_STYLE}
            >
              {submitting ? "جارٍ الدخول..." : "تسجيل الدخول"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
