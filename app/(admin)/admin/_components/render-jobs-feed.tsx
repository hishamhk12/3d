import Image from "next/image";
import { getAdminRenderJobs } from "@/lib/admin/session-dashboard";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function getResultImageUrl(result: unknown): string | null {
  if (result !== null && typeof result === "object" && "imageUrl" in (result as object)) {
    const url = (result as Record<string, unknown>).imageUrl;
    if (typeof url === "string" && url) return url;
  }
  return null;
}

function getProductName(input: unknown): string {
  if (
    input !== null &&
    typeof input === "object" &&
    "product" in (input as object)
  ) {
    const product = (input as Record<string, unknown>).product;
    if (typeof product === "object" && product !== null && "name" in product) {
      const name = (product as Record<string, unknown>).name;
      if (typeof name === "string") return name;
    }
  }
  return "—";
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const JOB_STATUS_STYLES: Record<string, string> = {
  pending: "bg-gray-800 text-gray-400",
  processing: "bg-amber-950 text-amber-300 animate-pulse",
  stuck: "bg-red-950 text-red-200 ring-1 ring-red-700/60",
  completed: "bg-green-950 text-green-300",
  failed: "bg-red-950 text-red-300",
};

function JobStatusBadge({ status }: { status: string }) {
  const cls = JOB_STATUS_STYLES[status] ?? "bg-gray-800 text-gray-400";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

// ─── Feed ─────────────────────────────────────────────────────────────────────

export async function RenderJobsFeed() {
  const jobs = await getAdminRenderJobs();

  if (jobs.length === 0) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-6 py-12 text-center">
        <p className="text-sm text-gray-500">No render jobs yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-800 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 bg-gray-900">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Job
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Session
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Product
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Duration
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                When
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Result
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/60 bg-gray-950">
            {jobs.map((job) => (
              <tr
                key={job.id}
                className={`hover:bg-gray-900/60 transition-colors ${
                  job.status === "failed" || job.isStuck ? "bg-red-950/5" : ""
                }`}
              >
                <td className="px-4 py-3">
                  <span className="font-mono text-xs text-gray-400">
                    {job.id.slice(0, 8)}…
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="font-mono text-xs text-gray-600">
                    {job.sessionId.slice(0, 8)}…
                  </span>
                </td>
                <td className="px-4 py-3">
                  <JobStatusBadge status={job.isStuck ? "stuck" : job.status} />
                </td>
                <td className="px-4 py-3 max-w-[160px]">
                  <span className="text-gray-300 truncate block text-xs">
                    {getProductName(job.input)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span
                    className={`tabular-nums text-xs ${
                      job.status === "completed"
                        ? job.durationMs > 30_000
                          ? "text-amber-400"
                          : "text-green-400"
                        : "text-gray-600"
                    }`}
                  >
                    {job.status === "pending" ? "—" : formatDuration(job.durationMs)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-gray-500 text-xs whitespace-nowrap">
                    {relativeTime(job.createdAt)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {(() => {
                    const url = getResultImageUrl(job.result);
                    if (!url) {
                      return (
                        <span className="text-gray-700 text-xs">—</span>
                      );
                    }
                    return (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open full image"
                        className="block w-16 h-12 rounded-lg overflow-hidden border border-gray-700 hover:border-indigo-500 transition-colors relative shrink-0"
                      >
                        <Image
                          src={url}
                          alt="Render result"
                          fill
                          unoptimized
                          className="object-cover"
                        />
                      </a>
                    );
                  })()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2.5 border-t border-gray-800 bg-gray-900/60">
        <span className="text-xs text-gray-600">
          Last {jobs.length} render jobs
        </span>
      </div>
    </div>
  );
}
