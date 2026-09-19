"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { createOnlineOrder, type CreateOrderInput } from "@/app/actions/orders";
import { MAX_QTY_PER_TYPE, SHIRT_SIZES, SHIRT_SIZE_CHART } from "@/config/event";
import { shrinkImage } from "@/lib/image";
import { php } from "@/lib/money";
import type { AvailabilityRow, TicketTypeRow } from "@/lib/supabase/types";
import { BandSwatch } from "@/components/BandSwatch";
import { Reveal } from "@/components/Reveal";
import { ShirtSizeChartButton, ShirtSizeHint } from "@/components/ShirtSizeChart";
import { mobileProblem, normalizeMobile, suggestEmail } from "@/lib/contact";
import { OrderReviewModal, type ReviewLine } from "@/components/OrderReviewModal";

type Attendee = {
  holder_name: string;
  shirt_size: string;
  vehicle_plate: string;
  vehicle_model: string;
  vehicle_photo: File | null;
  photo_preview: string | null;
};
const emptyAttendee = (): Attendee => ({ holder_name: "", shirt_size: "", vehicle_plate: "", vehicle_model: "", vehicle_photo: null, photo_preview: null });

/**
 * Car photo picker for VIP Car Display. Two hidden file inputs: one with
 * `capture` so phones open the camera straight away, one without so the buyer
 * can pick an existing photo from the gallery. Desktop browsers ignore
 * `capture` and show the normal file dialog for both.
 */
function CarPhotoField({ preview, fileName, onPick }: { preview: string | null; fileName: string | null; onPick: (file: File | null) => void }) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const handle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (file) onPick(file);
    e.target.value = ""; // allow re-picking the same file
  };
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
      <div className="relative h-36 w-full shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/40 sm:h-28 sm:w-44">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Selected car photo" className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center text-center text-xs text-zinc-500">
            <div>
              <svg viewBox="0 0 24 24" className="mx-auto mb-1 h-7 w-7 opacity-60" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                <path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" />
              </svg>
              No photo yet
            </div>
          </div>
        )}
        {preview && <span className="absolute bottom-1 left-1 rounded bg-emerald-400/90 px-1.5 py-0.5 text-[10px] font-bold text-black">Photo added</span>}
      </div>
      <div className="min-w-0 flex-1">
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handle} aria-hidden tabIndex={-1} />
        <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={handle} aria-hidden tabIndex={-1} />
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary flex-1 sm:flex-none" onClick={() => cameraRef.current?.click()}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" />
            </svg>
            {preview ? "Retake photo" : "Take photo"}
          </button>
          <button type="button" className="btn-secondary flex-1 sm:flex-none" onClick={() => galleryRef.current?.click()}>
            {preview ? "Choose another" : "Choose from gallery"}
          </button>
          {preview && (
            <button type="button" className="btn-secondary px-3" onClick={() => onPick(null)} aria-label="Remove photo">Remove</button>
          )}
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          {fileName ? <>Selected: <span className="text-zinc-300">{fileName}</span>. </> : null}
          On your phone, <b>Take photo</b> opens the camera. A clear shot of the whole car you will display; it is compressed automatically before upload.
        </p>
      </div>
    </div>
  );
}

export function OrderForm({ types, availability }: { types: TicketTypeRow[]; availability: AvailabilityRow[] }) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [attendees, setAttendees] = useState<Record<string, Attendee[]>>({});
  const [buyer, setBuyer] = useState({ buyer_name: "", buyer_email: "", buyer_mobile: "" });
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState(false);
  const [pending, start] = useTransition();

  const sellable = (id: string) => Number(availability.find((a) => a.ticket_type_id === id)?.sellable ?? 0);

  const total = useMemo(
    () => types.reduce((sum, t) => sum + (qty[t.id] ?? 0) * t.price_centavos, 0),
    [types, qty],
  );
  const count = Object.values(qty).reduce((a, b) => a + b, 0);
  const anySelected = count > 0;
  // Live contact checks: the server validates again, but a wrong digit or a
  // "gmail.cim" typo is much cheaper to catch while the buyer is still typing.
  const mobileIssue = mobileProblem(buyer.buyer_mobile);
  const emailSuggestion = suggestEmail(buyer.buyer_email);

  function setQuantity(t: TicketTypeRow, n: number) {
    const max = Math.min(MAX_QTY_PER_TYPE, sellable(t.id));
    const clamped = Math.max(0, Math.min(max, n));
    setQty((q) => ({ ...q, [t.id]: clamped }));
    setAttendees((a) => {
      const list = [...(a[t.id] ?? [])];
      while (list.length < clamped) list.push(emptyAttendee());
      return { ...a, [t.id]: list.slice(0, clamped) };
    });
  }

  function updateAttendee(typeId: string, i: number, patch: Partial<Attendee>) {
    setAttendees((a) => {
      const list = [...(a[typeId] ?? [])];
      list[i] = { ...list[i], ...patch };
      return { ...a, [typeId]: list };
    });
  }

  function setPhoto(typeId: string, i: number, file: File | null) {
    const prev = attendees[typeId]?.[i]?.photo_preview;
    if (prev) URL.revokeObjectURL(prev);
    updateAttendee(typeId, i, { vehicle_photo: file, photo_preview: file ? URL.createObjectURL(file) : null });
  }

  const selectedTypes = types.filter((t) => (qty[t.id] ?? 0) > 0);
  const reviewLines: ReviewLine[] = selectedTypes.map((t) => ({ type: t, qty: qty[t.id], attendees: attendees[t.id] ?? [] }));

  /** Stage 1: the form's own validation has passed; check what HTML cannot, then show the review. */
  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mobileIssue) {
      setError(`Mobile number: ${mobileIssue}.`);
      document.getElementById("buyer-mobile")?.focus();
      return;
    }
    for (const t of selectedTypes) {
      if (!t.requires_vehicle) continue;
      for (const [i, a] of (attendees[t.id] ?? []).entries()) {
        if (!a.vehicle_photo) {
          setError(`Add a photo of the car for ${t.name} ticket ${i + 1}`);
          return;
        }
      }
    }
    setReview(true);
  }

  /** Stage 2: buyer confirmed the review; compress photos, reserve, and go to payment. */
  function confirm() {
    setError(null);
    const selected = selectedTypes;
    const items: CreateOrderInput["items"] = selected.map((t) => ({
      ticket_type_id: t.id,
      qty: qty[t.id],
      attendees: (attendees[t.id] ?? []).map((a) => ({
        holder_name: a.holder_name.trim(),
        shirt_size: (a.shirt_size || undefined) as CreateOrderInput["items"][number]["attendees"][number]["shirt_size"],
        vehicle_plate: a.vehicle_plate.trim() || undefined,
        vehicle_model: a.vehicle_model.trim() || undefined,
      })),
    }));
    start(async () => {
      const fd = new FormData();
      fd.set("payload", JSON.stringify({ ...buyer, buyer_mobile: normalizeMobile(buyer.buyer_mobile), items }));
      for (const t of selected) {
        if (!t.requires_vehicle) continue;
        for (const [i, a] of (attendees[t.id] ?? []).entries()) {
          if (!a.vehicle_photo) {
            setReview(false);
            setError(`Add a photo of the car for ${t.name} ticket ${i + 1}`);
            return;
          }
          const small = await shrinkImage(a.vehicle_photo);
          if (small.size > 8 * 1024 * 1024) {
            setReview(false);
            setError(`The car photo for ${t.name} ticket ${i + 1} is too large. Please use a smaller photo.`);
            return;
          }
          fd.set(`photo:${t.id}:${i}`, small);
        }
      }
      const res = await createOnlineOrder(fd);
      if (res && !res.ok) {
        setReview(false);
        setError(res.error);
      }
    });
  }

  return (
    <>
    <form onSubmit={submit} className="space-y-6">
      <section className="space-y-3">
        <Reveal as="h2" className="text-lg font-bold" delay={80}>1. Choose your tickets</Reveal>
        {types.map((t, idx) => {
          const left = sellable(t.id);
          const soldOut = left <= 0;
          const n = qty[t.id] ?? 0;
          return (
            <Reveal key={t.id} delay={160 + idx * 110} from={idx % 2 ? "right" : "left"} className={`card ticket-card flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${soldOut ? "opacity-60" : ""}`}>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{t.name}</h3>
                  <BandSwatch color={t.band_color} className="rounded-full border border-white/15 bg-black/30 px-2 py-0.5 text-[11px] text-zinc-300" />
                </div>
                {t.description && <p className="mt-1 text-sm text-zinc-400">{t.description}</p>}
                {t.includes_shirt && (
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
                    <span className="rounded bg-cyan-400/15 px-1.5 py-0.5 font-semibold text-cyan-300">Includes event t-shirt</span>
                    <ShirtSizeChartButton label="View size chart" />
                  </div>
                )}
                {t.requires_vehicle && (
                  <p className="mt-1 flex flex-wrap gap-1 text-[11px]">
                    {["Car photo", "Plate number", "Car model"].map((x) => (
                      <span key={x} className="rounded bg-amber-400/15 px-1.5 py-0.5 font-semibold text-amber-300">{x} required</span>
                    ))}
                  </p>
                )}
                <p className="mt-1 text-sm">
                  <span className="font-bold">{php(t.price_centavos)}</span>
                  {soldOut ? <span className="ml-2 font-semibold text-red-600">Sold out</span> : left <= 20 ? <span className="ml-2 text-amber-700">Only {left} left</span> : null}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" className="btn-secondary h-9 w-9 px-0" onClick={() => setQuantity(t, n - 1)} disabled={n === 0} aria-label="Decrease">-</button>
                <input className="input w-14 text-center" inputMode="numeric" value={n} onChange={(e) => setQuantity(t, Number(e.target.value) || 0)} disabled={soldOut} aria-label={`${t.name} quantity`} />
                <button type="button" className="btn-secondary h-9 w-9 px-0" onClick={() => setQuantity(t, n + 1)} disabled={soldOut || n >= Math.min(MAX_QTY_PER_TYPE, left)} aria-label="Increase">+</button>
              </div>
            </Reveal>
          );
        })}
      </section>

      {anySelected && (
        <section className="enter space-y-3">
          <h2 className="text-lg font-bold">2. Ticket holder details</h2>
          {types.filter((t) => (qty[t.id] ?? 0) > 0).map((t) => (
            <div key={t.id} className="card space-y-4">
              <h3 className="font-semibold">{t.name} <span className="text-zinc-500">x {qty[t.id]}</span></h3>
              {(attendees[t.id] ?? []).map((a, i) => (
                <div key={i} className="grid gap-3 rounded-lg border border-white/10 bg-black/30 p-3 sm:grid-cols-2">
                  <div className="sm:col-span-2 text-xs font-semibold text-zinc-500">Ticket {i + 1}</div>
                  <div>
                    <label className="label">Holder full name *</label>
                    <input className="input" value={a.holder_name} onChange={(e) => updateAttendee(t.id, i, { holder_name: e.target.value })} placeholder="Name of the person using this ticket" required minLength={2} />
                  </div>
                  {t.includes_shirt && (
                    <div>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <label className="label !mb-0" htmlFor={`shirt-${t.id}-${i}`}>T-shirt size *</label>
                        <ShirtSizeChartButton highlight={a.shirt_size} />
                      </div>
                      <select id={`shirt-${t.id}-${i}`} className="input" value={a.shirt_size} onChange={(e) => updateAttendee(t.id, i, { shirt_size: e.target.value })} required>
                        <option value="">Select size</option>
                        {SHIRT_SIZES.map((s) => (
                          <option key={s} value={s}>
                            {s} · {SHIRT_SIZE_CHART[s].width} x {SHIRT_SIZE_CHART[s].length} in
                          </option>
                        ))}
                      </select>
                      <ShirtSizeHint size={a.shirt_size} />
                    </div>
                  )}
                  {t.requires_vehicle && (
                    <>
                      <div>
                        <label className="label">Plate number *</label>
                        <input className="input uppercase" value={a.vehicle_plate} onChange={(e) => updateAttendee(t.id, i, { vehicle_plate: e.target.value.toUpperCase() })} placeholder="ABC 1234" required minLength={3} />
                      </div>
                      <div>
                        <label className="label">Car make / model *</label>
                        <input className="input" value={a.vehicle_model} onChange={(e) => updateAttendee(t.id, i, { vehicle_model: e.target.value })} placeholder="Nissan Silvia S15" required minLength={2} />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="label">Photo of the car *</label>
                        <CarPhotoField
                          preview={a.photo_preview}
                          fileName={a.vehicle_photo?.name ?? null}
                          onPick={(file) => setPhoto(t.id, i, file)}
                        />
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          ))}
        </section>
      )}

      <Reveal as="section" className="space-y-3" delay={120}>
        <h2 className="text-lg font-bold">{anySelected ? "3." : "2."} Your details</h2>
        <div className="card grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label">Full name *</label>
            <input className="input" value={buyer.buyer_name} onChange={(e) => setBuyer({ ...buyer, buyer_name: e.target.value })} required />
          </div>
          <div>
            <label className="label">Email * (tickets are sent here)</label>
            <input className="input" type="email" inputMode="email" autoComplete="email" value={buyer.buyer_email} onChange={(e) => setBuyer({ ...buyer, buyer_email: e.target.value })} required aria-describedby={emailSuggestion ? "buyer-email-hint" : undefined} />
            {emailSuggestion && (
              <p id="buyer-email-hint" className="enter mt-1 text-xs text-amber-300">
                Did you mean{" "}
                <button type="button" className="font-semibold underline underline-offset-2" onClick={() => setBuyer({ ...buyer, buyer_email: emailSuggestion })}>
                  {emailSuggestion}
                </button>
                ? Tickets are emailed to this address.
              </p>
            )}
          </div>
          <div>
            <label className="label">Mobile number *</label>
            <input
              id="buyer-mobile"
              className="input"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              placeholder="09171234567"
              maxLength={16}
              value={buyer.buyer_mobile}
              onChange={(e) => setBuyer({ ...buyer, buyer_mobile: e.target.value.replace(/[^\d+\s-]/g, "") })}
              onBlur={() => setBuyer((b) => ({ ...b, buyer_mobile: normalizeMobile(b.buyer_mobile) || b.buyer_mobile }))}
              required
              aria-invalid={mobileIssue ? true : undefined}
              aria-describedby="buyer-mobile-hint"
            />
            <p id="buyer-mobile-hint" className={`mt-1 text-xs ${mobileIssue ? "text-amber-300" : "text-zinc-500"}`}>
              {mobileIssue ?? "11 digits starting with 09. +63 works too."}
            </p>
          </div>
        </div>
      </Reveal>

      {error && <p className="enter rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <Reveal from="zoom" delay={200} className="sticky bottom-0 -mx-4 border-t border-white/10 bg-zinc-950/90 p-4 text-white backdrop-blur-md sm:static sm:mx-0 sm:rounded-2xl sm:border sm:border-white/10 sm:bg-white/[0.06]">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-400">Total</div>
            <div className="mt-0.5 text-3xl font-black tabular-nums text-white">{php(total)}</div>
            {anySelected && <div className="text-xs text-zinc-400">{count} ticket{count === 1 ? "" : "s"}</div>}
          </div>
          <button className="btn-neon" disabled={!anySelected || pending}>
            {pending ? "Reserving..." : "Review & continue"}
          </button>
        </div>
        <p className="mt-3 text-xs text-zinc-400">You will have 30 minutes to pay via GoTyme (InstaPay QR) and upload your proof of payment.</p>
      </Reveal>
    </form>
    {review && (
      <OrderReviewModal
        lines={reviewLines}
        buyer={{ ...buyer, buyer_mobile: normalizeMobile(buyer.buyer_mobile) || buyer.buyer_mobile }}
        total={total}
        pending={pending}
        onClose={() => !pending && setReview(false)}
        onConfirm={confirm}
      />
    )}
    </>
  );
}
