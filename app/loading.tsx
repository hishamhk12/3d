export default function RootLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#e0d6df]">
      <div className="flex flex-col items-center gap-4">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#003C71] border-t-transparent" />
        <p className="text-sm font-medium text-[#4a4a52]">Loading…</p>
      </div>
    </main>
  );
}
