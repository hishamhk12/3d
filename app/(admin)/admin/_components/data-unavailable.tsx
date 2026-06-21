/**
 * Degraded state for a single admin dashboard panel when the database is
 * temporarily unreachable / the connection pool is exhausted. Keeps the admin
 * shell intact and never fabricates data — the panel recovers on the next load.
 */
export function DataUnavailable({ title = "Data temporarily unavailable" }: { title?: string }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-6 py-8 text-center shadow-sm">
      <p className="text-sm font-medium text-amber-800">{title}</p>
      <p className="mt-1 text-xs text-amber-700">
        The database is temporarily unreachable. This panel will recover automatically.
      </p>
    </div>
  );
}
