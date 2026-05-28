"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { ReasonGroupCount } from "@/lib/admin/render-errors-queries";

// ─── Color map ────────────────────────────────────────────────────────────────

const COLOR_MAP: Record<string, { badge: string; active: string; ring: string }> = {
  amber:  { badge: "bg-amber-50 text-amber-700",   active: "bg-amber-100 text-amber-800 ring-2 ring-amber-400",  ring: "ring-1 ring-amber-200" },
  orange: { badge: "bg-orange-50 text-orange-700", active: "bg-orange-100 text-orange-800 ring-2 ring-orange-400", ring: "ring-1 ring-orange-200" },
  red:    { badge: "bg-red-50 text-red-700",        active: "bg-red-100 text-red-800 ring-2 ring-red-400",        ring: "ring-1 ring-red-200" },
  purple: { badge: "bg-purple-50 text-purple-700",  active: "bg-purple-100 text-purple-800 ring-2 ring-purple-400", ring: "ring-1 ring-purple-200" },
  violet: { badge: "bg-violet-50 text-violet-700",  active: "bg-violet-100 text-violet-800 ring-2 ring-violet-400", ring: "ring-1 ring-violet-200" },
  blue:   { badge: "bg-blue-50 text-blue-700",      active: "bg-blue-100 text-blue-800 ring-2 ring-blue-400",     ring: "ring-1 ring-blue-200" },
  teal:   { badge: "bg-teal-50 text-teal-700",      active: "bg-teal-100 text-teal-800 ring-2 ring-teal-400",     ring: "ring-1 ring-teal-200" },
  slate:  { badge: "bg-slate-100 text-slate-600",   active: "bg-slate-200 text-slate-800 ring-2 ring-slate-400",  ring: "ring-1 ring-slate-300" },
};

function colorFor(color: string, active: boolean) {
  const c = COLOR_MAP[color] ?? COLOR_MAP.slate;
  return active ? c.active : `${c.badge} ${c.ring}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ReasonFilterCards({
  groups,
  activeGroup,
  totalRecords,
}: {
  groups: ReasonGroupCount[];
  activeGroup: string | null;
  totalRecords: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function navigate(reasonGroup: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (reasonGroup) {
      params.set("reasonGroup", reasonGroup);
    } else {
      params.delete("reasonGroup");
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">تجميع الأخطاء حسب السبب</h2>
          <p className="text-[11px] text-slate-400">Errors by Reason — click to filter the table</p>
        </div>
        {activeGroup && (
          <button
            onClick={() => navigate(null)}
            className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600 hover:bg-slate-200 transition-colors"
          >
            Clear filter ✕
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {/* All card */}
        <button
          onClick={() => navigate(null)}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-left transition-all hover:shadow-sm ${
            !activeGroup
              ? "border-slate-400 bg-slate-800 text-white ring-2 ring-slate-400"
              : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
          }`}
        >
          <span className="text-xs font-medium">All Errors</span>
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
            !activeGroup ? "bg-white/20 text-white" : "bg-slate-200 text-slate-700"
          }`}>
            {totalRecords}
          </span>
        </button>

        {groups.map((g) => {
          const isActive = activeGroup === g.key;
          return (
            <button
              key={g.key}
              onClick={() => navigate(g.key)}
              className={`flex flex-col rounded-lg border px-3 py-2 text-left transition-all hover:shadow-sm ${colorFor(g.color, isActive)}`}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold">{g.label}</span>
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                  isActive ? "bg-white/30" : "bg-white/70"
                }`}>
                  {g.count}
                </span>
              </div>
              <div className="mt-0.5 flex items-baseline gap-2">
                <span className="text-[10px] opacity-70">{g.pct}%</span>
                <span className="text-[10px] opacity-60" dir="rtl">{g.labelAr}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
