"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveRulesSection } from "@/app/actions/setup";
import { AssetField } from "@/components/AssetField";
import { Group, NumberField, SaveBar, changed, type SaveMsg } from "@/components/settings/SaveBar";
import type { Rules, ShirtRow } from "@/lib/rules-types";

/** Order limits and the shirt sizes offered, with their measurements. */
export function OrderingForm({ rules }: { rules: Rules }) {
  const router = useRouter();
  const pick = (r: Rules) => ({
    maxQtyPerType: r.maxQtyPerType,
    maxCompanionsPerCar: r.maxCompanionsPerCar,
    shirtChart: r.shirtChart,
    shirtChartImage: r.shirtChartImage,
  });
  const initial = pick(rules);
  const [f, setF] = useState(initial);
  const [msg, setMsg] = useState<SaveMsg>(null);
  const [pending, start] = useTransition();
  const dirty = changed(f, initial);

  const setRow = (i: number, patch: Partial<ShirtRow>) => setF((p) => ({ ...p, shirtChart: p.shirtChart.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const move = (i: number, d: -1 | 1) =>
    setF((p) => {
      const rows = [...p.shirtChart];
      [rows[i], rows[i + d]] = [rows[i + d], rows[i]];
      return { ...p, shirtChart: rows };
    });

  const save = () =>
    start(async () => {
      setMsg(null);
      const r = await saveRulesSection(f);
      setMsg(r.ok ? { kind: "ok", text: "Saved. The order form uses these on the next load." } : { kind: "err", text: r.error });
      if (r.ok) router.refresh();
    });

  return (
    <div className="card space-y-5">
      <Group title="Limits per order">
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField label="Tickets of one type" min={1} max={50} value={f.maxQtyPerType} onChange={(v) => setF((p) => ({ ...p, maxQtyPerType: v }))} hint="Companions riding on a car do not count." />
          <NumberField label="Passengers per car" min={0} max={30} value={f.maxCompanionsPerCar} onChange={(v) => setF((p) => ({ ...p, maxCompanionsPerCar: v }))} hint="Free and paid companions together." />
        </div>
      </Group>

      <Group title="Shirt sizes" hint="Offered in this order wherever a ticket includes a shirt. Measurements in inches. Sizes already ordered are kept even if you remove them here.">
        {/* relative: keeps the sr-only header cell inside this scroll box on phones */}
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[30rem] text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-400">
                <th className="pb-2 pr-2 font-medium">Size</th>
                <th className="pb-2 pr-2 font-medium">Width</th>
                <th className="pb-2 pr-2 font-medium">Length</th>
                <th className="pb-2 pr-2 font-medium">Sleeve</th>
                <th className="pb-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {f.shirtChart.map((r, i) => (
                <tr key={i}>
                  <td className="py-1 pr-2"><input className="input h-8 w-20 font-semibold uppercase" maxLength={8} value={r.size} onChange={(e) => setRow(i, { size: e.target.value.toUpperCase() })} aria-label={`Size ${i + 1}`} /></td>
                  {(["width", "length", "sleeve"] as const).map((k) => (
                    <td key={k} className="py-1 pr-2">
                      <input className="input h-8 w-20 tabular-nums" type="number" step="0.5" min={0} value={r[k]} onChange={(e) => setRow(i, { [k]: Number(e.target.value) })} aria-label={`${r.size} ${k}`} />
                    </td>
                  ))}
                  <td className="py-1">
                    <div className="flex justify-end gap-1">
                      <button type="button" className="btn-secondary h-8 px-2 text-xs" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${r.size} up`}>&uarr;</button>
                      <button type="button" className="btn-secondary h-8 px-2 text-xs" disabled={i === f.shirtChart.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${r.size} down`}>&darr;</button>
                      <button type="button" className="btn-secondary h-8 px-2 text-xs" disabled={f.shirtChart.length === 1} onClick={() => setF((p) => ({ ...p, shirtChart: p.shirtChart.filter((_, j) => j !== i) }))}>Remove</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className="btn-secondary text-sm" disabled={f.shirtChart.length >= 20} onClick={() => setF((p) => ({ ...p, shirtChart: [...p.shirtChart, { size: "", width: 0, length: 0, sleeve: 0 }] }))}>
          + Add size
        </button>
        <AssetField label="Supplier's chart image" value={f.shirtChartImage ?? ""} onChange={(v) => setF((p) => ({ ...p, shirtChartImage: v || null }))} onClear={() => setF((p) => ({ ...p, shirtChartImage: null }))} defaultLabel="No image" hint="Shown above the table in the size-chart popup. The table alone is fine too." />
      </Group>

      <SaveBar label="Save ordering" dirty={dirty} pending={pending} msg={msg} onSave={save} onDiscard={() => { setF(initial); setMsg(null); }} />
    </div>
  );
}
