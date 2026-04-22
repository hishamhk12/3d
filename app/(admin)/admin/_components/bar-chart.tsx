interface BarChartItem {
  label: string;
  value: number;
  /** Optional second value rendered as a stacked/overlay bar (e.g. failures). */
  danger?: number;
}

interface BarChartProps {
  data: BarChartItem[];
  height?: number;
  /** Tailwind bg class for the primary bar. */
  color?: string;
  /** Tailwind bg class for the danger bar overlay. */
  dangerColor?: string;
  unit?: string;
  /** Show the value on hover. Defaults to true. */
  showTooltip?: boolean;
}

/**
 * Pure CSS bar chart — no library, no JS.
 * Bars are flex children whose height is controlled by an inline `height` style.
 * Only the label positions marked with a non-empty string are rendered.
 */
export function BarChart({
  data,
  height = 120,
  color = "bg-indigo-600",
  dangerColor = "bg-red-500",
  unit = "",
  showTooltip = true,
}: BarChartProps) {
  const maxValue = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="w-full select-none">
      {/* Bars */}
      <div className="flex items-end gap-px" style={{ height }}>
        {data.map((d, i) => {
          const pct = Math.max((d.value / maxValue) * 100, d.value > 0 ? 2 : 0);
          const dangerPct =
            d.danger && d.value > 0
              ? Math.max((d.danger / d.value) * pct, d.danger > 0 ? 1 : 0)
              : 0;

          return (
            <div
              key={i}
              className="flex-1 flex flex-col justify-end relative group"
              style={{ height: "100%" }}
            >
              {/* Tooltip */}
              {showTooltip && d.value > 0 && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                  {d.value}
                  {unit}
                  {d.danger ? ` · ${d.danger} failed` : ""}
                </div>
              )}

              {/* Bar */}
              <div className="relative w-full" style={{ height: `${pct}%` }}>
                <div className={`absolute inset-0 rounded-t-sm ${color} opacity-80 group-hover:opacity-100 transition-opacity`} />
                {dangerPct > 0 && (
                  <div
                    className={`absolute bottom-0 inset-x-0 rounded-t-sm ${dangerColor} opacity-90`}
                    style={{ height: `${(dangerPct / pct) * 100}%` }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* X-axis labels */}
      <div className="flex gap-px mt-1.5">
        {data.map((d, i) => (
          <div key={i} className="flex-1 text-center overflow-hidden">
            {d.label && (
              <span className="text-[10px] text-gray-600 leading-none block truncate">
                {d.label}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
