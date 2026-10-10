import { LOCALE } from "@/config/site";
import { fetchAll } from "@/lib/fetch-all";
import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { CATEGORY_LABEL, actionMeta, actionsInCategory, describe, type AuditCategory } from "@/lib/audit";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;
const CATEGORIES = Object.keys(CATEGORY_LABEL) as AuditCategory[];

const CAT_TONE: Record<AuditCategory, string> = {
  orders: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  payments: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  tickets: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  walkin: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30",
  numbers: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  staff: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  settings: "bg-zinc-500/20 text-zinc-300 border-zinc-500/30",
  other: "bg-zinc-500/20 text-zinc-300 border-zinc-500/30",
};

type Row = { id: number; created_at: string; actor: string | null; action: string; entity: string; entity_id: string | null; data: Record<string, unknown> | null };

const fmt = (iso: string) => new Date(iso).toLocaleString(LOCALE.locale, { timeZone: LOCALE.timeZone, dateStyle: "medium", timeStyle: "medium" });
const manilaDayStart = () => new Date(`${new Date().toLocaleDateString("en-CA", { timeZone: LOCALE.timeZone })}T00:00:00${LOCALE.utcOffset}`).toISOString();

function entityHref(entity: string, id: string | null): string | null {
  if (!id) return null;
  if (entity === "order") return `/admin/orders/${id}`;
  if (entity === "ticket_type") return `/admin/numbers?type=${id}`;
  if (entity === "app_settings") return "/admin/settings";
  return null;
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string; cat?: string; actor?: string; from?: string; to?: string; page?: string }> }) {
  await requireStaff("admin");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const cat = CATEGORIES.includes(sp.cat as AuditCategory) ? (sp.cat as AuditCategory) : "";
  const actor = sp.actor ?? "";
  const from = sp.from ?? "";
  const to = sp.to ?? "";
  const page = Math.max(1, Number(sp.page) || 1);

  const admin = createAdminClient();
  const dayStart = manilaDayStart();

  let query = admin
    .from("audit_log")
    .select("id, created_at, actor, action, entity, entity_id, data", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (cat) query = query.in("action", actionsInCategory(cat).length ? actionsInCategory(cat) : ["__none__"]);
  if (actor === "system") query = query.is("actor", null);
  else if (actor) query = query.eq("actor", actor);
  if (from) query = query.gte("created_at", new Date(`${from}T00:00:00${LOCALE.utcOffset}`).toISOString());
  if (to) query = query.lte("created_at", new Date(`${to}T23:59:59.999${LOCALE.utcOffset}`).toISOString());
  if (q) {
    // PostgREST cannot cast jsonb in a filter, so search the payload keys we actually write.
    const like = `ilike.%${q.replace(/[,()]/g, " ")}%`;
    query = query.or([`entity_id.${like}`, `action.${like}`, `entity.${like}`, ...["reference", "reason", "email", "buyer", "method", "item", "prefix"].map((k) => `data->>${k}.${like}`)].join(","));
  }

  const [{ data: rows, count }, { data: staff }, { count: today }, todayRows] = await Promise.all([
    query,
    admin.from("staff").select("id, full_name, role").order("full_name"),
    admin.from("audit_log").select("id", { count: "exact", head: true }).gte("created_at", dayStart),
    fetchAll((from, to) => admin.from("audit_log").select("action").gte("created_at", dayStart).order("id").range(from, to)),
  ]);

  const names = new Map((staff ?? []).map((s) => [s.id, s.full_name]));
  const list = (rows ?? []) as Row[];
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const todayBy = { issued: 0, rejected: 0, redeemed: 0, walkin: 0, signins: 0 };
  for (const r of todayRows ?? []) {
    if (r.action === "order.issued") todayBy.issued++;
    else if (r.action === "order.rejected") todayBy.rejected++;
    else if (r.action === "ticket.redeemed") todayBy.redeemed++;
    else if (r.action === "walkin.recorded") todayBy.walkin++;
    else if (r.action === "staff.signed_in") todayBy.signins++;
  }

  const qs = (over: Record<string, string | number>) => {
    const p = new URLSearchParams({ q, cat, actor, from, to, page: String(page), ...Object.fromEntries(Object.entries(over).map(([k, v]) => [k, String(v)])) });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    return `?${p.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Audit log</h1>
          <p className="mt-2 text-sm text-zinc-500">Who did what, and when. Every approval, rejection, gate scan, walk-in tap, wristband import and sign-in is recorded here and cannot be edited from the app.</p>
        </div>
        <a href="/api/admin/export?type=audit" className="btn-secondary">Export CSV</a>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Events today", today ?? 0],
          ["Approvals", todayBy.issued],
          ["Rejections", todayBy.rejected],
          ["Gate scans", todayBy.redeemed],
          ["Walk-in taps", todayBy.walkin],
          ["Sign-ins", todayBy.signins],
        ].map(([label, v]) => (
          <div key={String(label)} className="card p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{label}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums">{v}</div>
          </div>
        ))}
      </div>

      <form className="card flex flex-wrap items-end gap-2 p-3">
        <div className="min-w-56 flex-1">
          <label className="label">Search</label>
          <input name="q" defaultValue={q} className="input" placeholder="Order id, ticket id, reference, reason, email…" />
        </div>
        <div>
          <label className="label">Category</label>
          <select name="cat" defaultValue={cat} className="input w-auto">
            <option value="">All</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Who</label>
          <select name="actor" defaultValue={actor} className="input w-auto">
            <option value="">Anyone</option>
            <option value="system">Buyer / system</option>
            {(staff ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name} ({s.role})</option>)}
          </select>
        </div>
        <div>
          <label className="label">From</label>
          <input name="from" type="date" defaultValue={from} className="input w-auto" />
        </div>
        <div>
          <label className="label">To</label>
          <input name="to" type="date" defaultValue={to} className="input w-auto" />
        </div>
        <button className="btn-primary">Filter</button>
        {(q || cat || actor || from || to) && <Link prefetch={false} href="/admin/audit" className="btn-secondary">Clear</Link>}
      </form>

      <div className="card overflow-x-auto p-0">
        <div className="flex items-center justify-between px-4 py-2 text-xs text-zinc-500">
          <span>{total.toLocaleString()} event{total === 1 ? "" : "s"}{cat || actor || q || from || to ? " match" : ""} · page {page} of {pages}</span>
          <span className="flex gap-2">
            {page > 1 && <Link prefetch={false} href={qs({ page: page - 1 })} className="underline">&larr; Newer</Link>}
            {page < pages && <Link prefetch={false} href={qs({ page: page + 1 })} className="underline">Older &rarr;</Link>}
          </span>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500">
            <tr><th className="p-3">When</th><th>Who</th><th>Event</th><th>What happened</th><th>Record</th><th></th></tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr><td colSpan={6} className="p-6 text-center text-zinc-500">No events match.</td></tr>
            )}
            {list.map((r) => {
              const m = actionMeta(r.action);
              const href = entityHref(r.entity, r.entity_id);
              const who = r.actor ? names.get(r.actor) ?? r.actor.slice(0, 8) : "Buyer / system";
              const summary = describe(r.action, r.data);
              return (
                <tr key={r.id} className="border-t align-top">
                  <td className="whitespace-nowrap p-3 text-xs text-zinc-500">{fmt(r.created_at)}</td>
                  <td className="whitespace-nowrap py-3 pr-3">{who}</td>
                  <td className="py-3 pr-3">
                    <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${CAT_TONE[m.cat]}`}>{m.label}</span>
                    <div className="mt-0.5 font-mono text-[10px] text-zinc-500">{r.action}</div>
                  </td>
                  <td className="py-3 pr-3 text-zinc-300">{summary || <span className="text-zinc-600">—</span>}</td>
                  <td className="py-3 pr-3 font-mono text-xs">
                    {href ? <Link prefetch={false} href={href} className="underline">{r.entity} {r.entity_id?.slice(0, 8)}</Link> : <span className="text-zinc-500">{r.entity} {r.entity_id?.slice(0, 8)}</span>}
                  </td>
                  <td className="py-3 pr-3 text-xs">
                    {r.data && (
                      <details>
                        <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">raw</summary>
                        <pre className="mt-1 max-w-xs overflow-x-auto rounded bg-black/40 p-2 text-[10px] text-zinc-300">{JSON.stringify(r.data, null, 1)}</pre>
                      </details>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
