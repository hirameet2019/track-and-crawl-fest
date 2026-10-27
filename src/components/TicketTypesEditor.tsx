"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveTicketType, type TicketTypeInput } from "@/app/actions/setup";
import { BandSwatch } from "@/components/BandSwatch";
import { php } from "@/lib/money";
import type { TicketTypeRow } from "@/lib/supabase/types";

/** Wristband pool numbers per type, from the availability view. */
export interface TypeStock {
  pool_total: number;
  sold: number;
  /** Code of the label whose wristbands this one uses, when it has none of its own. */
  shares?: string;
}

const toForm = (t: TicketTypeRow): TicketTypeInput => ({
  id: t.id,
  code: t.code,
  name: t.name,
  description: t.description ?? "",
  price: t.price_centavos / 100,
  walkin_price: t.walkin_price_centavos === null ? null : t.walkin_price_centavos / 100,
  band_color: t.band_color ?? "",
  sell_online: t.sell_online,
  sell_at_gate: t.sell_at_gate,
  walkin_name: t.walkin_name ?? "",
  gate_needs_name: t.gate_needs_name,
  includes_shirt: t.includes_shirt,
  ships_shirt: t.ships_shirt,
  hidden_in_admin: t.hidden_in_admin,
  includes_lanyard: t.includes_lanyard,
  includes_sticker: t.includes_sticker,
  includes_car_pass: t.includes_car_pass,
  requires_vehicle: t.requires_vehicle,
  included_companions: t.included_companions,
  is_child: t.is_child,
  online_cap: t.online_cap,
  drifter_family: t.drifter_family,
  free_allowance: t.free_allowance,
  sort_order: t.sort_order,
  active: t.active,
});

const blank = (sort: number): TicketTypeInput => ({
  id: null, code: "", name: "", description: "", price: 0, walkin_price: null, band_color: "",
  sell_online: true, sell_at_gate: true, walkin_name: "", gate_needs_name: false,
  includes_shirt: false, ships_shirt: false, hidden_in_admin: false, includes_lanyard: false, includes_sticker: false, includes_car_pass: false,
  requires_vehicle: false, included_companions: 0, is_child: false, online_cap: null,
  drifter_family: false, free_allowance: 0, sort_order: sort, active: true,
});

/** Blank input → null, otherwise a number (NaN is left for the server to reject). */
const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

function Check({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-sm" title={hint}>
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}{hint && <span className="block text-[11px] text-zinc-500">{hint}</span>}</span>
    </label>
  );
}

function TypeForm({ initial, stock, onDone }: { initial: TicketTypeInput; stock?: TypeStock; onDone: () => void }) {
  const router = useRouter();
  const [f, setF] = useState<TicketTypeInput>(initial);
  // Unticking clears the colour; the last one typed comes back if it is ticked again.
  const [coloured, setColoured] = useState(!!initial.band_color);
  const [lastColour, setLastColour] = useState(initial.band_color ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof TicketTypeInput>(k: K, v: TicketTypeInput[K]) => setF((p) => ({ ...p, [k]: v }));
  const codeLocked = !!initial.id && (stock?.pool_total ?? 0) > 0;

  function save() {
    setErr(null);
    start(async () => {
      const r = await saveTicketType(f);
      if (!r.ok) { setErr(r.error); return; }
      router.refresh();
      onDone();
    });
  }

  return (
    <div className="space-y-4 rounded-xl border border-cyan-300/30 bg-black/30 p-4">
      <div className="grid gap-3 sm:grid-cols-[6rem_1fr_10rem]">
        <div>
          <label className="label">Code *</label>
          <input className="input h-9 font-mono uppercase" maxLength={3} value={f.code} disabled={codeLocked} onChange={(e) => set("code", e.target.value.toUpperCase())} />
        </div>
        <div><label className="label">Name *</label><input className="input h-9" maxLength={80} value={f.name} onChange={(e) => set("name", e.target.value)} /></div>
        <div>
          <label className="label flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={coloured}
              onChange={(e) => {
                setColoured(e.target.checked);
                if (e.target.checked) set("band_color", lastColour);
                else { setLastColour(f.band_color ?? ""); set("band_color", ""); }
              }}
            />
            Band colour
          </label>
          {coloured ? (
            <input className="input h-9" maxLength={40} value={f.band_color ?? ""} onChange={(e) => set("band_color", e.target.value)} placeholder="Red stripes" aria-label="Band colour" />
          ) : (
            <div className="input flex h-9 items-center text-zinc-500">No colour</div>
          )}
        </div>
      </div>
      <p className="-mt-2 text-[11px] text-zinc-500">
        {codeLocked
          ? `Code is locked: ${stock?.pool_total} wristband serials are loaded under it.`
          : "Code = the letter printed on this type's band serials (R067521 → R). The wristband import matches by it."}
      </p>
      <div><label className="label">Description (shown on the ticket card)</label><textarea className="input min-h-16" maxLength={400} value={f.description ?? ""} onChange={(e) => set("description", e.target.value)} /></div>

      <div className="grid gap-3 sm:grid-cols-4">
        <div>
          <label className="label">Online price (₱)</label>
          <input className="input h-9" type="number" min={0} step="0.01" value={f.price} onChange={(e) => set("price", Number(e.target.value))} />
        </div>
        <div>
          <label className="label">Gate price (₱)</label>
          <input className="input h-9" type="number" min={0} step="0.01" value={f.walkin_price ?? ""} placeholder="Same" onChange={(e) => set("walkin_price", numOrNull(e.target.value))} />
        </div>
        <div>
          <label className="label">Online cap</label>
          <input className="input h-9" type="number" min={0} value={f.online_cap ?? ""} placeholder="No cap" onChange={(e) => set("online_cap", numOrNull(e.target.value))} />
        </div>
        <div>
          <label className="label">Order on page</label>
          <input className="input h-9" type="number" min={0} value={f.sort_order} onChange={(e) => set("sort_order", Number(e.target.value))} />
        </div>
      </div>
      <p className="-mt-2 text-[11px] text-zinc-500">A new price applies to new orders only; orders already placed keep what the buyer saw.</p>

      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
        <div className="space-y-2">
          <div className="text-sm font-semibold text-white/90">Where it is sold</div>
          <Check label="Sold online" checked={f.sell_online} onChange={(v) => set("sell_online", v)} />
          <Check label="Sold at the gate" checked={f.sell_at_gate} onChange={(v) => set("sell_at_gate", v)} hint="Walk-in tab and gate scanner" />
          <Check label="Gate records a name" checked={f.gate_needs_name} onChange={(v) => set("gate_needs_name", v)} />
          <div><label className="label">Name at the gate</label><input className="input h-9" maxLength={80} value={f.walkin_name ?? ""} placeholder="Same as name" onChange={(e) => set("walkin_name", e.target.value)} /></div>
        </div>
        <div className="space-y-2">
          <div className="text-sm font-semibold text-white/90">Includes</div>
          <Check label="T-shirt (asks for a size)" checked={f.includes_shirt} onChange={(v) => set("includes_shirt", v)} />
          {f.includes_shirt && (
            <Check label="Shirt ships by courier" checked={f.ships_shirt} onChange={(v) => set("ships_shirt", v)} hint="Online buyers enter an address; made to order, about two weeks, LBC or J&T, buyer pays shipping" />
          )}
          <Check label="ID lanyard" checked={f.includes_lanyard} onChange={(v) => set("includes_lanyard", v)} />
          <Check label="Sticker / decal" checked={f.includes_sticker} onChange={(v) => set("includes_sticker", v)} />
          <Check label="Car pass" checked={f.includes_car_pass} onChange={(v) => set("includes_car_pass", v)} />
        </div>
        <div className="space-y-2">
          <div className="text-sm font-semibold text-white/90">Special</div>
          <Check label="Needs car details" checked={f.requires_vehicle} onChange={(v) => set("requires_vehicle", v)} hint="Plate, model and car photo" />
          <Check label="Hide from staff pages" checked={f.hidden_in_admin} onChange={(v) => set("hidden_in_admin", v)} hint="Left out of the Dashboard, Walk-in, Orders and Verify. Its orders and sales stay in the system; untick to show them again." />
          <div>
            <label className="label">Free companions per car</label>
            <input className="input h-9" type="number" min={0} max={12} value={f.included_companions} disabled={!f.requires_vehicle} onChange={(e) => set("included_companions", Number(e.target.value))} />
          </div>
          <Check label="Kids ticket" checked={f.is_child} onChange={(v) => set("is_child", v)} />
          <Check label="Drifter family band" checked={f.drifter_family} onChange={(v) => set("drifter_family", v)} hint="Handed out on the Drifters tab" />
          {f.drifter_family && (
            <div>
              <label className="label">Free bands per drifter</label>
              <input className="input h-9" type="number" min={0} max={50} value={f.free_allowance} onChange={(e) => set("free_allowance", Number(e.target.value))} />
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
        <button type="button" className="btn-primary" disabled={pending} onClick={save}>{pending ? "Saving..." : initial.id ? "Save ticket type" : "Add ticket type"}</button>
        <button type="button" className="btn-secondary" disabled={pending} onClick={onDone}>Cancel</button>
        {initial.id && (
          <label className="ml-auto flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!f.active} onChange={(e) => set("active", !e.target.checked)} /> Hide this type (stops selling it everywhere)
          </label>
        )}
      </div>
      {err && <p className="rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-700">{err}</p>}
    </div>
  );
}

/**
 * Admin > Settings > Ticket types. One row per wristband label; Edit opens the
 * form in place. Hidden types stay listed (greyed) so they can be brought back.
 */
export function TicketTypesEditor({ types, stock }: { types: TicketTypeRow[]; stock: Record<string, TypeStock> }) {
  const [open, setOpen] = useState<string | null>(null);
  const nextSort = types.reduce((m, t) => Math.max(m, t.sort_order), 0) + 1;

  return (
    <div className="card space-y-4">
      <div>
        <h2 className="font-semibold">Ticket types</h2>
        <p className="text-sm text-zinc-500">One per wristband label. Load the band serials for a new type at Admin &gt; Numbers.</p>
      </div>
      <ul className="space-y-2">
        {types.map((t) => {
          const st = stock[t.id];
          return (
            <li key={t.id} className={t.active ? "" : "opacity-50"}>
              {open === t.id ? (
                <TypeForm initial={toForm(t)} stock={st} onDone={() => setOpen(null)} />
              ) : (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-white/10 px-3 py-2">
                  <span className="grid h-7 w-7 place-items-center rounded-md bg-white/10 text-sm font-black">{t.code}</span>
                  <span className="font-semibold">{t.name}</span>
                  {t.band_color ? <BandSwatch color={t.band_color} className="text-xs text-zinc-400" /> : <span className="text-xs text-zinc-500">no colour</span>}
                  <span className="text-sm">{t.sell_online ? php(t.price_centavos) : t.sell_at_gate ? "gate only" : t.drifter_family ? "Drifters tab only" : "not on sale"}</span>
                  {!t.active && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px]">hidden</span>}
                  {t.active && t.hidden_in_admin && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px]" title="Left out of the Dashboard, Walk-in, Orders and Verify">not on staff pages</span>}
                  {st && <span className="text-xs text-zinc-500">{st.shares ? `${st.sold} sold · uses the ${st.shares} wristbands` : `${st.sold} sold of ${st.pool_total} bands`}</span>}
                  <button type="button" className="btn-secondary ml-auto px-3 py-1 text-xs" disabled={open !== null} onClick={() => setOpen(t.id)}>Edit</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {open === "new" ? (
        <TypeForm initial={blank(nextSort)} onDone={() => setOpen(null)} />
      ) : (
        <button type="button" className="btn-secondary text-sm" disabled={open !== null} onClick={() => setOpen("new")}>+ Add ticket type</button>
      )}
    </div>
  );
}
