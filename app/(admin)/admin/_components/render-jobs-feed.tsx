import Image from "next/image";
import { getAdminRenderJobs } from "@/lib/admin/session-dashboard";

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
  if (result !== null && typeof result === "object" && "imageUrl" in result) {
    const url = (result as Record<string, unknown>).imageUrl;
    if (typeof url === "string" && url) return url;
  }
  return null;
}

function getProductName(input: unknown): string {
  if (input !== null && typeof input === "object" && "product" in input) {
    const product = (input as Record<string, unknown>).product;
    if (typeof product === "object" && product !== null && "name" in product) {
      const name = (product as Record<string, unknown>).name;
      if (typeof name === "string") return name;
    }
  }
  return "-";
}

const JOB_STATUS_STYLES: Record<string, string> = {
  pending: "bg-slate-100 text-slate-600",
  processing: "bg-amber-100 text-amber-700 animate-pulse",
  stuck: "bg-red-100 text-red-700 ring-1 ring-red-200",
  completed: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
};

function JobStatusBadge({ status }: { status: string }) {
  const cls = JOB_STATUS_STYLES[status] ?? "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

export async function RenderJobsFeed() {
  const jobs = await getAdminRenderJobs();

  if (jobs.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
        <p className="text-sm text-slate-500">No render jobs yet.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              {["Job", "Session", "Status", "Product", "Duration", "When", "Result"].map((label) => (
                <th
                  key={label}
                  className={`px-4 py-3 text-xs font-medium uppercase tracking-wider text-slate-500 ${
                    label === "Duration" ? "text-right" : "text-left"
                  }`}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {jobs.map((job) => {
              const resultUrl = getResultImageUrl(job.result);
              return (
                <tr
                  key={job.id}
                  className={`transition-colors hover:bg-slate-50 ${
                    job.status === "failed" || job.isStuck ? "bg-red-50" : ""
                  }`}
                >
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-slate-600">{job.id.slice(0, 8)}...</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-slate-500">{job.sessionId.slice(0, 8)}...</span>
                  </td>
                  <td className="px-4 py-3">
                    <JobStatusBadge status={job.isStuck ? "stuck" : job.status} />
                  </td>
                  <td className="max-w-[160px] px-4 py-3">
                    <span className="block truncate text-xs text-slate-700">{getProductName(job.input)}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-xs tabular-nums text-slate-600">
                      {job.status === "pending" ? "-" : formatDuration(job.durationMs)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="whitespace-nowrap text-xs text-slate-500">{relativeTime(job.createdAt)}</span>
                  </td>
                  <td className="px-4 py-3">
                    {resultUrl ? (
                      <a
                        className="relative block h-12 w-16 shrink-0 overflow-hidden rounded-lg border border-slate-200 transition-colors hover:border-blue-500"
                        href={resultUrl}
                        rel="noopener noreferrer"
                        target="_blank"
                        title="Open full image"
                      >
                        <Image
                          alt="Render result"
                          className="object-cover"
                          fill
                          src={resultUrl}
                          unoptimized
                        />
                      </a>
                    ) : (
                      <span className="text-xs text-slate-400">-</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="border-t border-slate-200 bg-slate-50 px-4 py-2.5">
        <span className="text-xs text-slate-500">Last {jobs.length} render jobs</span>
      </div>
    </div>
  );
}
