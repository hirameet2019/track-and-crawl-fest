import Link from "next/link";
import { BandSwatch } from "@/components/BandSwatch";

/**
 * Event-day report for the organizer: why the dashboard showed about ₱390,000 on
 * the evening of 10 October 2026 when ₱470,325 had been recorded (the 1,000-row
 * cap, fixed in 74a183f), the verified gate and online figures, and the entries
 * still to confirm. A snapshot taken on 11 October, not live: the Dashboard has
 * the live numbers. Admin only, since it names staff cash and buyers.
 */

type Row = { label: string; band: string; note?: string; price: string; count: string; amount: string; kids?: boolean };

const GATE: Row[] = [
  { label: "Adult Walk-in", band: "Yellow stripes", note: "yellow stripes", price: "₱150", count: "615", amount: "₱92,250" },
  { label: "Adult Walk-in", band: "Orange stripes", note: "orange stripes", price: "₱150", count: "594", amount: "₱89,100" },
  { label: "Kids Walk-in", band: "Blue stripes", note: "blue stripes", price: "₱75", count: "199", amount: "₱14,925", kids: true },
  { label: "VIP Pass (no shirt)", band: "Green", price: "₱500", count: "32", amount: "₱16,000" },
  { label: "VIP Pass", band: "Green", price: "₱850", count: "9", amount: "₱7,650" },
  { label: "VIP Car (no shirt)", band: "Red stripes", price: "₱850", count: "2", amount: "₱1,700" },
  { label: "Drifter family bands", band: "Plain Red", note: "129 of 148 free", price: "₱150", count: "148", amount: "₱2,850" },
];

const ONLINE: Row[] = [
  { label: "Early Bird", band: "Pink stripes", price: "₱150", count: "370", amount: "₱55,500" },
  { label: "Early Bird Kids", band: "Blue stripes", price: "₱75", count: "78", amount: "₱5,850", kids: true },
  { label: "VIP Pass", band: "Green", price: "₱950", count: "148", amount: "₱140,600" },
  { label: "VIP Pass (no shirt)", band: "Green", price: "₱500", count: "27", amount: "₱13,500" },
  { label: "VIP Car Display", band: "Red stripes", note: "+12 free passengers", price: "₱1,850", count: "15 cars", amount: "₱27,750" },
  { label: "VIP Car Display (no shirt)", band: "Red stripes", price: "₱850", count: "1 car", amount: "₱850" },
  { label: "Drifter, Family & Friends", band: "Plain Red", price: "₱150", count: "12", amount: "₱1,800" },
];

const STAFF: { account: string; note?: string; cash: string }[] = [
  { account: "Walk-in 1", cash: "₱98,700" },
  { account: "Walk-in 2", cash: "₱97,725" },
  { account: "Alysa", cash: "₱23,500" },
  { account: "Tin", note: "drifter family bands", cash: "₱1,500" },
];

const CONFIRM: { text: string; amount: string }[] = [
  { text: "₱850 VIP Car (no shirt) recorded on 5 October, 11:46 PM (Alysa). A test?", amount: "₱850" },
  { text: "Two VIP Pass gate sales for \"Cabuhat, Justin\", 10:17 and 10:20 AM. Two buyers, or a double tap?", amount: "₱1,700" },
  {
    text: "Two VIP Pass (no shirt) gate sales 3 seconds apart at 9:36 AM, no names recorded. Two buyers, or a double tap? Together with one Adult Walk-in taken back at 8:21 AM (−₱150), this is the ₱850 under review.",
    amount: "₱1,000",
  },
  { text: "Orders #385, #403 and #426 are paid but have no payment method on record. Check against GoTyme.", amount: "₱4,375" },
  { text: "Order #49 still owes the buyer a refund.", amount: "₱50" },
];

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: "good" | "muted" | "warn" }) {
  const color = tone === "good" ? "text-emerald-300" : tone === "warn" ? "text-orange-300" : "text-zinc-400 line-through decoration-2";
  return (
    <div className={`card ${tone === "good" ? "border-emerald-400/50" : ""}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-1 text-3xl font-bold tabular-nums ${color}`}>{value}</div>
      <div className="text-xs text-zinc-500">{sub}</div>
    </div>
  );
}

function SalesTable({ head, rows, total }: { head: [string, string]; rows: Row[]; total: { label: string; count: string; amount: string } }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-zinc-500">
          <tr><th className="py-1">{head[0]}</th><th className="text-right">Price</th><th className="text-right">{head[1]}</th><th className="text-right">Amount</th></tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map((r) => (
            <tr key={`${r.label}-${r.band}`} className={`border-t border-white/10 ${r.kids ? "bg-sky-400/10" : ""}`}>
              <td className="py-2">
                <span className="inline-flex items-center gap-2 whitespace-nowrap">
                  <BandSwatch color={r.band} size={12} label={false} />
                  {r.label}
                  {r.note && <span className="text-xs text-zinc-500">({r.note})</span>}
                </span>
              </td>
              <td className="text-right">{r.price}</td>
              <td className="text-right">{r.count}</td>
              <td className="text-right">{r.amount}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-white/30 font-semibold">
            <td className="py-2">{total.label}</td><td></td><td className="text-right">{total.count}</td><td className="text-right">{total.amount}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function EventDayReport() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <div className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Report · Event day, 10 October 2026</div>
        <h1 className="mt-1 text-2xl font-bold">The ₱390K on the dashboard</h1>
        <p className="mt-2 text-zinc-300">
          The ₱390,000 shown on the evening of 10 October was a counting error on the screen. No money is missing: every sale was recorded,
          and the total is <b className="tabular-nums">₱470,325</b>.
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          A snapshot prepared 11 October 2026. These figures do not update on their own; the <Link prefetch={false} href="/admin" className="underline hover:text-zinc-300">Dashboard</Link> has the live numbers.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label="Real total" value="₱470,325" sub="Online ₱245,850 + gate ₱224,475" tone="good" />
        <Tile label="Shown last night" value="≈ ₱390,000" sub="Changed with each refresh" tone="muted" />
        <Tile label="Not counted on screen" value="≈ ₱80,300" sub="Still recorded in the system" tone="warn" />
      </div>

      <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-sm">
        <div className="text-xs font-semibold uppercase tracking-wide text-emerald-300">Sa madaling salita</div>
        <p className="mt-1 text-zinc-200">
          Walang nawalang pera. Kumpleto ang benta sa system: ₱470,325. Lumampas sa 1,000 ang walk-in entries noong event (1,461 lahat), pero 1,000
          lang ang kayang bilangin ng dashboard sa isang kuha, kaya mas mababa ang lumabas. Naayos na ito bandang 8:10 PM.
        </p>
      </div>

      <section className="card space-y-3">
        <h2 className="font-semibold">What happened</h2>
        <p className="text-sm text-zinc-300">
          The dashboard could only add up <b>1,000 gate entries at a time</b>. At 5:21 PM the gate passed 1,000 entries, and by closing there were 1,461.
          From 5:21 PM until the fix at about 8:10 PM, the dashboard and the Walk-in screen showed totals that were too low. Online orders were never affected.
        </p>
        <div role="img" aria-label="1,000 of 1,461 gate entries were counted; 461 were left off the screen">
          <div className="flex h-6 overflow-hidden rounded border border-white/15">
            <div className="bg-zinc-300" style={{ width: "68.4%" }} />
            <div className="flex-1 border-l-2 border-orange-400" style={{ background: "repeating-linear-gradient(135deg, rgba(251,146,60,0.25) 0 6px, transparent 6px 12px)" }} />
          </div>
          <div className="mt-1 flex flex-wrap justify-between gap-2 text-xs text-zinc-400">
            <span><b className="text-zinc-200">1,000</b> entries counted</span>
            <span><b className="text-orange-300">461</b> not counted on screen (still recorded)</span>
          </div>
        </div>
        <ol className="grid gap-2 text-sm sm:grid-cols-4">
          <li className="border-t-4 border-zinc-500 pt-2"><b className="block">7:29 AM</b>First gate sale.</li>
          <li className="border-t-4 border-orange-400 pt-2"><b className="block text-orange-300">5:21 PM</b>Entry no. 1,001: totals start reading short.</li>
          <li className="border-t-4 border-zinc-500 pt-2"><b className="block">7:08 PM</b>Last gate sale, 1,461 entries.</li>
          <li className="border-t-4 border-emerald-400 pt-2"><b className="block text-emerald-300">About 8:10 PM</b>Fixed: totals read every entry.</li>
        </ol>
        <p className="text-xs text-zinc-500">If anyone wrote down a Walk-in screen total or downloaded the Excel before 8:10 PM, use the figures below instead.</p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Gate sales <span className="text-sm font-normal text-zinc-500">as named on the Walk-in tab · all cash</span></h2>
        <SalesTable head={["Walk-in", "Bands"]} rows={GATE} total={{ label: "Total gate", count: "1,599", amount: "₱224,475" }} />
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Online tickets <span className="text-sm font-normal text-zinc-500">paid through GoTyme · three orders have no payment method on record</span></h2>
        <SalesTable head={["Ticket", "Tickets"]} rows={ONLINE} total={{ label: "Total online", count: "", amount: "₱245,850" }} />
        <p className="rounded-lg border-l-4 border-sky-400 bg-sky-400/10 px-3 py-2 text-sm text-zinc-200">
          <b>Kids Walk-in and Early Bird Kids</b> use the same blue-stripes wristband. Kids Walk-in is the gate sale (199 bands, ₱14,925); Early Bird Kids is
          the online ticket (78, ₱5,850). Together: 277 kids&apos; bands, ₱20,775.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Gate cash by staff, 10 October</h2>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-zinc-500"><tr><th className="py-1">Account</th><th className="text-right">Cash</th></tr></thead>
            <tbody className="tabular-nums">
              {STAFF.map((s) => (
                <tr key={s.account} className="border-t border-white/10">
                  <td className="py-2">{s.account}{s.note && <span className="ml-1 text-xs text-zinc-500">({s.note})</span>}</td>
                  <td className="text-right">{s.cash}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-white/30 font-semibold"><td className="py-2">Staff accounts above</td><td className="text-right">₱221,425</td></tr>
              <tr className="border-t border-white/10 bg-orange-400/10"><td className="py-2">Under review <span className="text-xs text-zinc-500">(see Please confirm)</span></td><td className="text-right">₱850</td></tr>
              <tr className="border-t-2 border-white/30 font-semibold"><td className="py-2">Total, 10 October</td><td className="text-right">₱222,275</td></tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-zinc-500">Take-backs are already subtracted. The other ₱2,200 of the gate total was recorded before event day (₱1,350 drifter family bands on 9 October, ₱850 on 5 October).</p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Please confirm</h2>
        <ul className="space-y-2">
          {CONFIRM.map((c) => (
            <li key={c.text} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-white/10 border-l-4 border-l-amber-400 bg-white/[0.04] px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">{c.text}</span>
              <b className="tabular-nums text-amber-300">{c.amount}</b>
            </li>
          ))}
        </ul>
      </section>

      <section className="card space-y-2 text-sm">
        <h2 className="font-semibold">What changed</h2>
        <p className="text-zinc-300">
          Every total that adds up individual sales now reads them in batches of 1,000 until none are left: the dashboard, the Walk-in desk, the Audit page
          and the Excel and CSV exports. Live since about 8:10 PM on 10 October.
        </p>
        <p className="text-zinc-300"><b>For the next event:</b> test the dashboard and exports with more than 1,000 gate entries before event day.</p>
      </section>
    </div>
  );
}
