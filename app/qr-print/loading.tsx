// Instant loading UI for /qr-print (and every /qr-print?category=... tab).
//
// ProductQrPrintPage is an async Server Component that calls PDC for every
// SKU in the selected category (up to 84 for "الكل"). Real-world PDC latency
// means a category switch can take many seconds — without this file, Next.js
// shows nothing at all during that wait (the previous page's DOM just sits
// there unchanged), which reads as "the tab button doesn't work." Next.js
// automatically wraps page.tsx in a <Suspense> boundary using this file as
// the fallback, shown immediately on every navigation — including
// searchParams-only navigations between /qr-print category tabs.
export default function QrPrintLoading() {
  return (
    <main className="min-h-screen bg-white px-6 py-8 text-slate-950">
      <section className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-col gap-2 border-b border-slate-200 pb-5">
          <div className="h-8 w-64 animate-pulse rounded bg-slate-200" />
          <div className="h-4 w-96 max-w-full animate-pulse rounded bg-slate-100" />
        </div>

        <div dir="rtl" className="mb-8 flex flex-wrap items-center gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-8 w-20 animate-pulse rounded-full bg-slate-100" />
          ))}
        </div>

        <p dir="rtl" className="mb-6 text-sm font-medium text-slate-500">
          جارٍ تحميل بيانات المنتجات من PDC...
        </p>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="animate-pulse rounded-lg border border-slate-200 bg-white p-4"
            >
              <div className="mx-auto aspect-square w-full max-w-[260px] rounded bg-slate-100" />
              <div className="mx-auto mt-3 h-5 w-20 rounded-full bg-slate-100" />
              <div className="mx-auto mt-3 h-6 w-32 rounded bg-slate-100" />
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
