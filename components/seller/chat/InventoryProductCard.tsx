// Full-width inventory RESULT card for the seller chat. One card per PRODUCT
// (its warehouse rows grouped inside). Ported from the chatbot's InventoryCard +
// StatusBadge, with brand tokens converted to scoped values. Shows ONLY values
// the inventory system returns — null/empty fields are hidden, never fabricated.
import {
  WAREHOUSE_AR,
  STATUS_AR,
  computeStatus,
  type InventoryDTO,
  type InventoryStatus,
} from "@/lib/seller/chat/inventory-types";

export interface ProductGroup {
  productCode: string;
  productName: string;
  size: string | null;
  design: string | null;
  classification: string | null;
  category: string | null;
  status: InventoryStatus;
  rows: InventoryDTO[];
}

/** Group flat product+warehouse rows into one entry per product code, preserving
 *  first-seen order. Header status derives from the product's totals — no values
 *  are invented. */
export function groupInventoryByProduct(items: InventoryDTO[]): ProductGroup[] {
  const order: string[] = [];
  const byCode = new Map<string, InventoryDTO[]>();
  for (const it of items) {
    const arr = byCode.get(it.productCode);
    if (arr) arr.push(it);
    else {
      byCode.set(it.productCode, [it]);
      order.push(it.productCode);
    }
  }
  return order.map((code) => {
    const rows = byCode.get(code)!;
    const base = rows[0];
    const totalSell = rows.reduce((s, r) => s + (r.availableToSell ?? 0), 0);
    const totalIncoming = rows.reduce((s, r) => s + (r.incomingQuantity ?? 0), 0);
    return {
      productCode: code,
      productName: base.productName,
      size: base.size,
      design: base.design,
      classification: base.classification,
      category: base.category,
      status: computeStatus(totalSell, totalIncoming),
      rows,
    };
  });
}

const STATUS_COLORS: Record<InventoryStatus, string> = {
  available: "bg-green-100 text-green-800",
  low_stock: "bg-amber-100 text-amber-800",
  incoming: "bg-[#00afd7]/15 text-[#0090b4]",
  out_of_stock: "bg-red-100 text-red-800",
};

function StatusBadge({ status }: { status: InventoryStatus }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[status]}`}>
      {STATUS_AR[status]}
    </span>
  );
}

function Stat({ value, label, strong }: { value: number; label: string; strong?: boolean }) {
  return (
    <div className="flex flex-col items-center text-center">
      <span
        dir="ltr"
        className={`tabular-nums text-[17px] font-bold leading-none ${strong ? "text-[#003a7d]" : "text-slate-800"}`}
      >
        {value}
      </span>
      <span className="mt-1 text-[11px] leading-tight text-slate-500">{label}</span>
    </div>
  );
}

export function InventoryProductCard({ group, index = 0 }: { group: ProductGroup; index?: number }) {
  const details: { label: string; value: string }[] = [];
  if (group.size && group.size.trim()) details.push({ label: "المقاس", value: group.size });
  if (group.design && group.design.trim()) details.push({ label: "التصميم", value: group.design });
  const cls =
    (group.classification && group.classification.trim()) ||
    (group.category && group.category.trim());
  if (cls) details.push({ label: "التصنيف", value: cls });

  return (
    <div
      dir="rtl"
      className="sc-card sc-card-in sc-shadow-card rounded-[12px] border border-slate-200 bg-white p-4"
      style={{ animationDelay: `calc(var(--sc-stagger-small) * ${index})` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="sc-ltr block text-[15px] font-bold text-[#003a7d]">{group.productCode}</span>
          <p className="mt-0.5 break-words text-[13px] leading-snug text-slate-600">{group.productName}</p>
        </div>
        <span className="shrink-0">
          <StatusBadge status={group.status} />
        </span>
      </div>

      {details.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-slate-500">
          {details.map((d) => (
            <span key={d.label}>
              {d.label}: <b className="font-semibold text-slate-700">{d.value}</b>
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-col gap-3">
        {group.rows.map((r) => (
          <div key={r.warehouse} className="rounded-[10px] border border-slate-100 bg-slate-50 p-2.5">
            <div className="mb-2 text-[13px] font-semibold text-[#003a7d]">
              {WAREHOUSE_AR[r.warehouse] ?? r.warehouse}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Stat value={r.quantityAvailable} label="الكمية" />
              <Stat value={r.reservedQuantity} label="المحجوز" />
              <Stat value={r.availableToSell} label="متاح للبيع" strong />
            </div>
            {(r.incomingQuantity > 0 || r.expectedArrivalDate) && (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                {r.incomingQuantity > 0 && (
                  <span>
                    قادم: <b className="font-semibold text-slate-700">{r.incomingQuantity}</b>
                  </span>
                )}
                {r.expectedArrivalDate && (
                  <span>
                    وصول متوقع: <b className="font-semibold text-slate-700">{r.expectedArrivalDate}</b>
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
