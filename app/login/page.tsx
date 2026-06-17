"use client";

// Login-type selector. Customer preserves the EXISTING customer entry (navigates
// to /room-preview, unchanged). Seller shows a credentials form that posts to the
// seller login API and, on success, redirects to /seller/chat.
//
// This page introduces NO customer authentication — the Customer option is a plain
// navigation to the current public entry point.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Tab = "customer" | "seller";

export default function LoginPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("customer");

  // Honor ?type=seller (e.g. arriving from the mobile role screen or a seller
  // redirect) by pre-selecting the Seller tab. Read after mount to avoid any
  // SSR/hydration mismatch; both tabs remain visible and selectable.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("type") === "seller") {
      setTab("seller");
    }
  }, []);
  const [sellerCode, setSellerCode] = useState("");
  const [showroomCode, setShowroomCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
    <div dir="rtl" className="flex min-h-screen items-center justify-center bg-[var(--bg-page)] px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="mb-6 text-center text-xl font-semibold text-slate-900">تسجيل الدخول</h1>

        {/* Login-type selector */}
        <div className="mb-6 grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setTab("customer")}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
              tab === "customer" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
            }`}
          >
            عميل
          </button>
          <button
            type="button"
            onClick={() => setTab("seller")}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
              tab === "seller" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
            }`}
          >
            بائع
          </button>
        </div>

        {tab === "customer" ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-slate-600">
              تابع كعميل لاستخدام معاينة الغرفة كالمعتاد.
            </p>
            <button
              type="button"
              onClick={() => router.push("/room-preview")}
              className="w-full rounded-lg bg-[#115ea3] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#0f548c]"
            >
              المتابعة كعميل
            </button>
          </div>
        ) : (
          <form onSubmit={onSellerSubmit} className="space-y-4">
            {error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
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
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-[#115ea3] focus:outline-none focus:ring-2 focus:ring-[#115ea3]/20"
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
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-[#115ea3] focus:outline-none focus:ring-2 focus:ring-[#115ea3]/20"
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
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-[#115ea3] focus:outline-none focus:ring-2 focus:ring-[#115ea3]/20"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-[#115ea3] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#0f548c] disabled:opacity-60"
            >
              {submitting ? "جارٍ الدخول…" : "تسجيل الدخول"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
