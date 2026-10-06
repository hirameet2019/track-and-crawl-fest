"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveEventDetails, type EventDetailsInput, type EventFormValues } from "@/app/actions/setup";
import { Group, SaveBar, changed, type SaveMsg } from "@/components/settings/SaveBar";
import { toManilaLocalInput } from "@/lib/cutoff";

const toForm = (e: EventFormValues): EventDetailsInput => ({
  name: e.name,
  tagline: e.tagline ?? "",
  venue: e.venue ?? "",
  starts_at: toManilaLocalInput(e.starts_at),
  sales_open_at: toManilaLocalInput(e.sales_open_at),
  sales_close_at: toManilaLocalInput(e.sales_close_at),
  org_name: e.org_name,
  org_tin: e.org_tin ?? "",
  org_address: e.org_address ?? "",
  org_vat_registered: e.org_vat_registered,
  receipt_label: e.receipt_label === "OFFICIAL RECEIPT" ? "OFFICIAL RECEIPT" : "ACKNOWLEDGMENT RECEIPT",
  refund_policy: e.refund_policy ?? "",
  support_contact_label: e.support_contact_label ?? "",
  support_contact_url: e.support_contact_url ?? "",
});

/**
 * Admin > Settings > Event details: the active events row. Everything here is
 * live for buyers on the next page load: name, date and venue on the sales page,
 * receipt details on the PDF. Payment QR codes are on the Payments tab.
 */
export function EventDetailsForm({ event }: { event: EventFormValues }) {
  const router = useRouter();
  const initial = toForm(event);
  const [f, setF] = useState<EventDetailsInput>(initial);
  const [msg, setMsg] = useState<SaveMsg>(null);
  const [pending, start] = useTransition();
  const dirty = changed(f, initial);
  const set = <K extends keyof EventDetailsInput>(k: K, v: EventDetailsInput[K]) => setF((p) => ({ ...p, [k]: v }));
  const text = (k: keyof EventDetailsInput) => ({ value: String(f[k] ?? ""), onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(k, e.target.value as never) });

  function save() {
    setMsg(null);
    start(async () => {
      const r = await saveEventDetails(f);
      setMsg(r.ok ? { kind: "ok", text: "Saved. Buyers see the change on their next page load." } : { kind: "err", text: r.error });
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className="card space-y-6">
      <Group title="The event">
        <div><label className="label">Event name *</label><input className="input" maxLength={120} {...text("name")} /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label">Tagline</label><input className="input" maxLength={120} placeholder="Shown above the logo" {...text("tagline")} /></div>
          <div><label className="label">Venue</label><input className="input" maxLength={200} {...text("venue")} /></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div><label className="label">Starts (Manila time)</label><input type="datetime-local" className="input" {...text("starts_at")} /></div>
          <div><label className="label">Online sales open</label><input type="datetime-local" className="input" {...text("sales_open_at")} /></div>
          <div><label className="label">Online sales close</label><input type="datetime-local" className="input" {...text("sales_close_at")} /></div>
        </div>
        <p className="text-xs text-zinc-500">Blank open / close means no limit. Each ticket type can also close on its own under Sales schedule.</p>
      </Group>

      <Group title="Receipt">
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label">Organizer name *</label><input className="input" maxLength={200} {...text("org_name")} /></div>
          <div><label className="label">TIN</label><input className="input" maxLength={40} {...text("org_tin")} /></div>
        </div>
        <div><label className="label">Organizer address</label><input className="input" maxLength={300} {...text("org_address")} /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Receipt title</label>
            <select className="input" value={f.receipt_label} onChange={(e) => set("receipt_label", e.target.value as EventDetailsInput["receipt_label"])}>
              <option value="ACKNOWLEDGMENT RECEIPT">Acknowledgment receipt</option>
              <option value="OFFICIAL RECEIPT">Official receipt</option>
            </select>
            <p className="mt-1 text-xs text-zinc-500">Official receipt only once the accountant confirms BIR registration.</p>
          </div>
          <label className="flex items-center gap-2 self-center text-sm">
            <input type="checkbox" checked={f.org_vat_registered} onChange={(e) => set("org_vat_registered", e.target.checked)} /> VAT registered
          </label>
        </div>
        <div><label className="label">Refund policy</label><textarea className="input min-h-20" maxLength={1500} {...text("refund_policy")} /></div>
      </Group>

      <Group title="“Need help?” link">
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label">Label</label><input className="input" maxLength={80} placeholder="Message us on Facebook" {...text("support_contact_label")} /></div>
          <div><label className="label">Link</label><input className="input" maxLength={300} placeholder="https://m.me/yourpage" {...text("support_contact_url")} /></div>
        </div>
        <p className="text-xs text-zinc-500">Shown on the payment and order pages and in emails. Keep it set while sales are open: buyers whose hold expired are sent here.</p>
      </Group>

      <SaveBar label="Save event details" dirty={dirty} pending={pending} msg={msg} onSave={save} onDiscard={() => { setF(initial); setMsg(null); }} />
    </div>
  );
}
