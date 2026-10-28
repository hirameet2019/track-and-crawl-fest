"use client";

import { useRef, useState, useTransition } from "react";
import { createOnlineOrder, type CreateOrderInput } from "@/app/actions/orders";
import { COURIERS, type Courier } from "@/lib/shipping";
import type { PaymentChannel } from "@/config/event";
import { useRules, useText } from "@/components/RulesProvider";
import { RichText } from "@/components/RichText";
import { regVars } from "@/lib/site-text";
import { cap, fillText } from "@/lib/rules-types";
import { shrinkImage } from "@/lib/image";
import { php } from "@/lib/money";
import { fmtCutoff, hoursUntilCutoff, isTypeClosed } from "@/lib/cutoff";
import type { TicketTypeRow } from "@/lib/supabase/types";
import type { PublicAvailability } from "@/lib/queries";
import { BandSwatch } from "@/components/BandSwatch";
import { bandSwatchStyle } from "@/lib/bands";
import { vehicleWords } from "@/lib/vehicle";
import { Reveal } from "@/components/Reveal";
import { ShirtSizeChartButton, ShirtSizeHint } from "@/components/ShirtSizeChart";
import { emailProblem, emailsMatch, mobileProblem, normalizeEmail, normalizeMobile, suggestEmail } from "@/lib/contact";
import { OrderReviewModal, type ReviewLine } from "@/components/OrderReviewModal";

/** A passenger riding with a VIP Car Display car: becomes a VIP Pass ticket linked to the plate. */
type Companion = { holder_name: string; shirt_size: string; included?: boolean };
type Attendee = {
  holder_name: string;
  shirt_size: string;
  vehicle_plate: string;
  vehicle_model: string;
  vehicle_photo: File | null;
  photo_preview: string | null;
  companions: Companion[];
};
const emptyAttendee = (included = 0): Attendee => ({
  holder_name: "", shirt_size: "", vehicle_plate: "", vehicle_model: "", vehicle_photo: null, photo_preview: null,
  // The car package comes with free VIP Pass companions; their slots are always present.
  companions: Array.from({ length: included }, () => ({ holder_name: "", shirt_size: "", included: true })),
});

/**
 * Car photo picker for VIP Car Display. Two hidden file inputs: one with
 * `capture` so phones open the camera straight away, one without so the buyer
 * can pick an existing photo from the gallery. Desktop browsers ignore
 * `capture` and show the normal file dialog for both.
 */
function CarPhotoField({ preview, fileName, onPick, noun = "car", hint }: { preview: string | null; fileName: string | null; onPick: (file: File | null) => void; noun?: string; hint: string }) {
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
          <img src={preview} alt={`Selected ${noun} photo`} className="h-full w-full object-cover" />
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
          <RichText text={hint} />
        </p>
      </div>
    </div>
  );
}

export function OrderForm({ types, availability, channel }: { types: TicketTypeRow[]; availability: PublicAvailability[]; channel: PaymentChannel }) {
  // Limits, hold time and shirt sizes from Admin > Settings.
  const { maxQtyPerType: MAX_QTY_PER_TYPE, maxCompanionsPerCar: MAX_COMPANIONS_PER_CAR, paymentDeadline, paymentWindowMinutes: PAYMENT_WINDOW_MINUTES, shirtChart, buyerForm: bf, page, terms: T } = useRules();
  const payNote = paymentDeadline ? page.payNote : page.payNoteOpen;
  const tx = useText();
  const reg = regVars(T);
  const processing = tx("form.shirtProcessing");
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  const fill = (text: string) => fillText(text, { pay: channel.payVia, via: channel.via, minutes: PAYMENT_WINDOW_MINUTES });
  const SHIRT_SIZES = shirtChart.map((r) => r.size);
  const SHIRT_SIZE_CHART = Object.fromEntries(shirtChart.map((r) => [r.size, r]));
  const [qty, setQty] = useState<Record<string, number>>({});
  const [attendees, setAttendees] = useState<Record<string, Attendee[]>>({});
  const [buyer, setBuyer] = useState({ buyer_name: "", buyer_email: "", buyer_mobile: "" });
  const [emailConfirm, setEmailConfirm] = useState("");
  // Where a shirt that ships goes (VIP Pass and other ships_shirt labels). The name and
  // mobile follow the buyer's unless someone else receives it.
  const [ship, setShip] = useState({ name: "", mobile: "", address: "", city: "", province: "", zip: "", courier: "LBC" as Courier });
  const [shipToBuyer, setShipToBuyer] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState(false);
  const [pending, start] = useTransition();

  const sellable = (id: string) => Number(availability.find((a) => a.ticket_type_id === id)?.sellable ?? 0);
  /** Wristbands left ignoring the per-type cap; paid companions draw from this. */
  const poolSellable = (id: string) => Number(availability.find((a) => a.ticket_type_id === id)?.pool_sellable ?? sellable(id));
  /**
   * How many of a type a buyer may still add. A VIP Car Display ticket also takes a
   * second wristband from the same pool for its free passenger, so the pool limit is
   * halved for cars while the 40-car cap still applies on its own.
   */
  const addable = (t: TicketTypeRow) => {
    const row = availability.find((a) => a.ticket_type_id === t.id);
    const bandsPerTicket = 1 + (t.requires_vehicle ? t.included_companions : 0);
    const byPool = Math.floor(poolSellable(t.id) / bandsPerTicket);
    const byCap = row?.online_cap == null ? Infinity : Number(row.online_cap) - Number(row.cap_used);
    return Math.max(0, Math.min(byPool, byCap));
  };

  // Passengers ride inside a car ticket (VIP Car Display, with or without shirt). A free
  // one bundled with the package wears that car's own band; extra companions buy a VIP
  // Pass (shirt, green band).
  const carTypes = types.filter((t) => t.requires_vehicle);
  // Companions are only offered while VIP Pass is still on sale.
  const companionType = types.find((t) => t.includes_shirt && !t.requires_vehicle && !isTypeClosed(t)) ?? null;
  const carAttendees = carTypes.flatMap((t) => attendees[t.id] ?? []);
  const companionCount = carAttendees.reduce((n, a) => n + a.companions.length, 0);
  /** Companions beyond the free ones bundled with the car package. */
  const paidCompanionCount = carAttendees.reduce((n, a) => n + a.companions.filter((c) => !c.included).length, 0);
  const companionPrice = companionType?.price_centavos ?? 0;
  /** VIP Pass wristbands still free after direct VIP Pass tickets and paid companions. */
  const companionsLeft = companionType ? poolSellable(companionType.id) - (qty[companionType.id] ?? 0) - paidCompanionCount : 0;

  // A sum over a handful of ticket types; the React Compiler memoizes it.
  const total = types.reduce((sum, t) => sum + (qty[t.id] ?? 0) * t.price_centavos, 0) + paidCompanionCount * companionPrice;
  const count = Object.values(qty).reduce((a, b) => a + b, 0) + companionCount;
  const anySelected = count > 0;
  // Live contact checks: the server validates again, but a wrong digit or a
  // "gmail.cim" typo is much cheaper to catch while the buyer is still typing.
  const mobileIssue = mobileProblem(buyer.buyer_mobile);
  const emailIssue = emailProblem(buyer.buyer_email);
  const emailSuggestion = emailIssue ? null : suggestEmail(buyer.buyer_email);
  const emailMismatch = emailConfirm.trim() !== "" && !emailsMatch(buyer.buyer_email, emailConfirm);

  function setQuantity(t: TicketTypeRow, n: number) {
    const max = isTypeClosed(t) ? 0 : Math.min(MAX_QTY_PER_TYPE, addable(t));
    const clamped = Math.max(0, Math.min(max, n));
    setQty((q) => ({ ...q, [t.id]: clamped }));
    setAttendees((a) => {
      const list = [...(a[t.id] ?? [])];
      while (list.length < clamped) list.push(emptyAttendee(t.requires_vehicle && companionType ? t.included_companions : 0));
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

  function setCompanions(typeId: string, i: number, list: Companion[]) {
    updateAttendee(typeId, i, { companions: list });
  }

  function setPhoto(typeId: string, i: number, file: File | null) {
    const prev = attendees[typeId]?.[i]?.photo_preview;
    if (prev) URL.revokeObjectURL(prev);
    updateAttendee(typeId, i, { vehicle_photo: file, photo_preview: file ? URL.createObjectURL(file) : null });
  }

  const selectedTypes = types.filter((t) => (qty[t.id] ?? 0) > 0);
  /** The order holds a shirt that ships: a selected label with ships_shirt, or paid companions of one. */
  const needsShipping = selectedTypes.some((t) => t.ships_shirt) || (!!companionType?.ships_shirt && paidCompanionCount > 0);
  const shipTo = { ...ship, name: shipToBuyer ? buyer.buyer_name : ship.name, mobile: shipToBuyer ? buyer.buyer_mobile : ship.mobile };
  const shipMobileIssue = needsShipping && !shipToBuyer ? mobileProblem(ship.mobile) : null;
  const reviewLines: ReviewLine[] = selectedTypes.map((t) => ({ type: t, qty: qty[t.id], attendees: attendees[t.id] ?? [] }));

  /** Stage 1: the form's own validation has passed; check what HTML cannot, then show the review. */
  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (emailIssue) {
      setError(`Email: ${emailIssue}.`);
      document.getElementById("buyer-email")?.focus();
      return;
    }
    if (!emailsMatch(buyer.buyer_email, emailConfirm)) {
      setError("The two email addresses do not match. Tickets are sent there, so please type it again carefully.");
      document.getElementById("buyer-email-confirm")?.focus();
      return;
    }
    if (mobileIssue) {
      setError(`Mobile number: ${mobileIssue}.`);
      document.getElementById("buyer-mobile")?.focus();
      return;
    }
    for (const t of selectedTypes) {
      if (!t.requires_vehicle) continue;
      for (const [i, a] of (attendees[t.id] ?? []).entries()) {
        if (!a.vehicle_photo) {
          setError(`Add a photo of the ${vehicleWords(t).noun} for ${t.name} ${i + 1}`);
          return;
        }
        if (a.companions.length > 0 && a.vehicle_plate.trim().length < 3) {
          setError(`Enter the plate number of ${t.name} ticket ${i + 1} before adding companions; companions are linked to the car by its plate.`);
          return;
        }
        if (a.companions.length > MAX_COMPANIONS_PER_CAR) {
          setError(`Up to ${MAX_COMPANIONS_PER_CAR} companions per car. Please remove ${a.companions.length - MAX_COMPANIONS_PER_CAR} from ${t.name} ticket ${i + 1}.`);
          return;
        }
        for (const [k, c] of a.companions.entries()) {
          if (c.included) continue; // bundled passengers may be named later
          if (c.holder_name.trim().length < 2 || !c.shirt_size) {
            setError(`Companion ${k + 1} of ${t.name} ticket ${i + 1} needs a full name and a t-shirt size.`);
            return;
          }
        }
      }
    }
    if (needsShipping) {
      const missing =
        shipTo.name.trim().length < 2 ? ["ship-name", "the recipient's full name"]
        : shipMobileIssue ? ["ship-mobile", `the recipient's mobile number (${shipMobileIssue})`]
        : ship.address.trim().length < 5 ? ["ship-address", "the house or unit no., street and barangay"]
        : ship.city.trim().length < 2 ? ["ship-city", "the city or municipality"]
        : ship.province.trim().length < 2 ? ["ship-province", "the province"]
        : !/^\d{4}$/.test(ship.zip.trim()) ? ["ship-zip", "the 4-digit ZIP code"]
        : null;
      if (missing) {
        setError(`Shirt delivery: enter ${missing[1]}.`);
        document.getElementById(missing[0])?.focus();
        return;
      }
    }
    if (companionType && companionsLeft < 0) {
      setError(`Not enough ${companionType.name} ${T.many} are left for the extra companions in this order (${Math.max(0, poolSellable(companionType.id) - (qty[companionType.id] ?? 0))} left).`);
      return;
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
    // Companions become VIP Pass attendees carrying the plate they ride with.
    // Paid companions join the direct VIP Pass line; the free ones bundled with the
    // car package go on their own line, which the server prices at zero.
    if (companionType && companionCount > 0) {
      type Att = CreateOrderInput["items"][number]["attendees"][number];
      const paid: Att[] = [];
      for (const carType of carTypes) {
        const included: Att[] = [];
        for (const a of attendees[carType.id] ?? []) {
          const plate = a.vehicle_plate.trim().toUpperCase();
          a.companions.forEach((c, k) => {
            const name = c.holder_name.trim();
            const att: Att = {
              holder_name: name || `Passenger ${k + 1} (car ${plate})`,
              shirt_size: (c.included ? undefined : c.shirt_size || undefined) as Att["shirt_size"],
              companion_of: plate,
            };
            if (c.included) { att.included = true; included.push(att); } else paid.push(att);
          });
        }
        // The free passenger takes a wristband from the car pool, so it is a second line
        // of that car label that the server prices at zero.
        if (included.length) items.push({ ticket_type_id: carType.id, qty: included.length, attendees: included, unit_price_centavos: 0 });
      }
      if (paid.length) {
        const g = items.find((i) => i.ticket_type_id === companionType.id);
        if (g) { g.attendees.push(...paid); g.qty = g.attendees.length; }
        else items.push({ ticket_type_id: companionType.id, qty: paid.length, attendees: paid });
      }
    }
    start(async () => {
      const fd = new FormData();
      const shipping = needsShipping
        ? { name: shipTo.name.trim(), mobile: normalizeMobile(shipTo.mobile) || shipTo.mobile.trim(), address: ship.address.trim(), city: ship.city.trim(), province: ship.province.trim(), zip: ship.zip.trim(), courier: ship.courier }
        : null;
      fd.set("payload", JSON.stringify({ ...buyer, buyer_email: normalizeEmail(buyer.buyer_email), buyer_mobile: normalizeMobile(buyer.buyer_mobile), items, shipping }));
      for (const t of selected) {
        if (!t.requires_vehicle) continue;
        for (const [i, a] of (attendees[t.id] ?? []).entries()) {
          if (!a.vehicle_photo) {
            setReview(false);
            setError(`Add a photo of the ${vehicleWords(t).noun} for ${t.name} ${i + 1}`);
            return;
          }
          const small = await shrinkImage(a.vehicle_photo);
          if (small.size > 8 * 1024 * 1024) {
            setReview(false);
            setError(`The ${vehicleWords(t).noun} photo for ${t.name} ${i + 1} is too large. Please use a smaller photo.`);
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

  // Poster billing: dearest tier on top; the three dearest prices get the three
  // biggest sizes and every cheaper tier shares the smallest.
  const billed = [...types].sort((a, b) => b.price_centavos - a.price_centavos);
  const priceRank = [...new Set(billed.map((t) => t.price_centavos))];
  const billSize = (t: TicketTypeRow) => (["xl", "lg", "md"] as const)[priceRank.indexOf(t.price_centavos)] ?? "sm";

  return (
    <>
    <form onSubmit={submit} className="space-y-10">
      {/* The tiers are billed like the event poster's lineup: the dearest tier first and
          biggest, each line stepping down a size, so the page reads as the poster continued. */}
      <section aria-labelledby="tiers-title">
        <Reveal as="h2" className="form-step" delay={80}>
          <span id="tiers-title"><span className="form-step-no">1</span> {fill(page.step1Title)}</span>
          {page.step1Sub && <span className="form-step-sub">{fill(page.step1Sub)}</span>}
        </Reveal>
        <div className="mt-2">
          {billed.map((t, idx) => {
            const left = addable(t);
            const closed = isTypeClosed(t);
            const soldOut = closed || left <= 0;
            const hrs = hoursUntilCutoff(t);
            const closingSoon = !closed && hrs !== null && hrs <= 24 * 7;
            const n = qty[t.id] ?? 0;
            const max = Math.min(MAX_QTY_PER_TYPE, left - (t.id === companionType?.id ? paidCompanionCount : 0));
            return (
              <Reveal key={t.id} as="article" delay={140 + idx * 90} from="up" className={`bill-line bill-${billSize(t)} ${n > 0 ? "is-picked" : ""} ${soldOut ? "is-out" : ""}`}>
                <div className="min-w-0">
                  <h3 className="bill-name">{t.name}</h3>
                  {t.band_color && <span aria-hidden className="bill-strap" style={bandSwatchStyle(t.band_color)} />}
                  <div className="bill-tags">
                    <BandSwatch color={t.band_color} size={16} className="bill-tag" />
                    {t.includes_shirt && <span className="bill-tag bill-tag-cyan">{tx("form.tagShirt")}</span>}
                    {t.ships_shirt && <span className="bill-tag bill-tag-violet">{tx("form.tagShips", { time: processing })}</span>}
                    {t.requires_vehicle && <span className="bill-tag bill-tag-amber">{tx("form.tagVehicle", { noun: vehicleWords(t).noun })}</span>}
                    {t.includes_shirt && <ShirtSizeChartButton label={tx("form.sizeChart")} />}
                  </div>
                  {t.description && <p className="bill-desc">{t.description}</p>}
                  {t.requires_vehicle && companionType && (
                    <p className="bill-desc text-emerald-300">
                      {t.included_companions > 0
                        ? <RichText text={tx("form.companionsIncluded", { ...reg, passengers: plural(t.included_companions, "passenger"), price: php(companionPrice), companion: companionType.name })} />
                        : <RichText text={tx("form.companionsPaid", { ...reg, price: php(companionPrice), companion: companionType.name })} />}
                    </p>
                  )}
                  {(closed || soldOut || left <= 20 || t.sales_close_at) && (
                    <p className="bill-status">
                      {closed ? <span className="font-semibold text-rose-400">{tx("form.salesClosed", { date: fmtCutoff(t.sales_close_at!, { withTime: false }) })}</span> : soldOut ? <span className="font-semibold text-rose-400">{tx("form.soldOut")}</span> : left <= 20 ? <span className="font-semibold text-amber-300">{tx("form.onlyLeft", { n: left })}</span> : null}
                      {!closed && t.sales_close_at && <span className={closingSoon ? "font-semibold text-amber-300" : "text-zinc-400"}>{tx("form.salesUntil", { date: fmtCutoff(t.sales_close_at) })}</span>}
                    </p>
                  )}
                </div>
                <div className="bill-buy">
                  <div className="bill-price">{php(t.price_centavos)}</div>
                  <div className="stepper" role="group" aria-label={`${t.name} quantity`}>
                    <button type="button" onClick={() => setQuantity(t, n - 1)} disabled={n === 0} aria-label={`One fewer ${t.name}`}>
                      <svg viewBox="0 0 24 24" aria-hidden><path d="M5 12h14" /></svg>
                    </button>
                    <input inputMode="numeric" value={n} onChange={(e) => setQuantity(t, Number(e.target.value) || 0)} disabled={soldOut} aria-label={`${t.name} quantity`} />
                    <button type="button" onClick={() => setQuantity(t, n + 1)} disabled={soldOut || n >= max} aria-label={`One more ${t.name}`}>
                      <svg viewBox="0 0 24 24" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
                    </button>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </section>

      {anySelected && (
        <section className="enter space-y-3">
          <h2 className="form-step"><span><span className="form-step-no">2</span> {fill(page.step2Title)}</span>{page.step2Sub && <span className="form-step-sub">{fill(page.step2Sub)}</span>}</h2>
          {types.filter((t) => (qty[t.id] ?? 0) > 0).map((t) => (
            <div key={t.id} className="card space-y-4">
              <h3 className="holder-title">{t.name} <span className="text-zinc-400">× {qty[t.id]}</span></h3>
              {(attendees[t.id] ?? []).map((a, i) => (
                <div key={i} className="grid gap-3 rounded-lg border border-white/10 bg-black/30 p-3 sm:grid-cols-2">
                  <div className="sm:col-span-2 text-xs font-semibold text-zinc-500">{tx("form.ticketNo", { ...reg, n: i + 1 })}</div>
                  <div>
                    <label className="label">{t.requires_vehicle ? tx("form.driverName", { person: vehicleWords(t).person, Person: `${vehicleWords(t).person[0].toUpperCase()}${vehicleWords(t).person.slice(1)}` }) : tx("form.holderName")} *</label>
                    <input className="input" value={a.holder_name} onChange={(e) => updateAttendee(t.id, i, { holder_name: e.target.value })} placeholder={(t.requires_vehicle ? tx("form.driverNamePlaceholder", { person: vehicleWords(t).person }) : tx("form.holderNamePlaceholder")) || undefined} required minLength={2} />
                  </div>
                  {t.includes_shirt && (
                    <div>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <label className="label !mb-0" htmlFor={`shirt-${t.id}-${i}`}>{tx("form.shirtSize")} *</label>
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
                        <label className="label">{tx("form.plate")} *</label>
                        <input className="input uppercase" value={a.vehicle_plate} onChange={(e) => updateAttendee(t.id, i, { vehicle_plate: e.target.value.toUpperCase() })} placeholder={tx("form.platePlaceholder") || undefined} required minLength={3} />
                      </div>
                      <div>
                        <label className="label">{tx("form.model")} *</label>
                        <input className="input" value={a.vehicle_model} onChange={(e) => updateAttendee(t.id, i, { vehicle_model: e.target.value })} placeholder={vehicleWords(t).example} required minLength={2} />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="label">{tx("form.photo", { noun: vehicleWords(t).noun })} *</label>
                        <CarPhotoField
                          preview={a.photo_preview}
                          fileName={a.vehicle_photo?.name ?? null}
                          onPick={(file) => setPhoto(t.id, i, file)}
                          noun={vehicleWords(t).noun}
                          hint={tx("form.photoHint", { noun: vehicleWords(t).noun })}
                        />
                      </div>
                      {companionType && (
                        <div className="sm:col-span-2 rounded-lg border border-emerald-400/25 bg-emerald-400/5 p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <div className="text-xs font-semibold uppercase tracking-wide text-emerald-300">{tx("form.passengersTitle")}</div>
                              <p className="mt-0.5 text-xs text-zinc-400">
                                {t.included_companions > 0 && <><RichText text={tx("form.passengersIncluded", { ...reg, passengers: plural(t.included_companions, "passenger"), band: t.band_color ? `**${t.band_color}** band` : T.one })} />{" "}</>}
                                <RichText text={tx("form.passengersPaid", { ...reg, who: t.included_companions > 0 ? "Extra companions" : "Each companion", price: php(companionPrice), companion: companionType.name, plate: a.vehicle_plate.trim() || "…", max: MAX_COMPANIONS_PER_CAR })} />
                              </p>
                            </div>
                            <button
                              type="button"
                              className="btn-secondary text-xs"
                              disabled={companionsLeft <= 0 || a.companions.length >= MAX_COMPANIONS_PER_CAR}
                              onClick={() => setCompanions(t.id, i, [...a.companions, { holder_name: "", shirt_size: "" }])}
                            >
                              {tx("form.addCompanion")}
                            </button>
                          </div>
                          {a.companions.map((c, k) => (
                            <div key={k} className="mt-2 grid items-end gap-2 sm:grid-cols-[1fr_150px_auto]">
                              <div>
                                <label className="label">{c.included ? <>{tx("form.passengerName", { n: k + 1 })} <span className="ml-1 rounded bg-emerald-400/20 px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-emerald-200">{tx("form.includedBadge")}</span></> : <>{tx("form.extraCompanionName", { n: k + 1 })} *</>}</label>
                                <input
                                  className="input"
                                  value={c.holder_name}
                                  onChange={(e) => setCompanions(t.id, i, a.companions.map((x, j) => (j === k ? { ...x, holder_name: e.target.value } : x)))}
                                  placeholder={c.included ? "Passenger's full name (optional for now)" : "Passenger's full name"}
                                  required={!c.included}
                                  minLength={c.included ? undefined : 2}
                                />
                              </div>
                              {c.included ? (
                                <div className="text-xs text-zinc-400 sm:pb-2">{tx("form.passengerNote", { band: t.band_color ? `${t.band_color} ${T.one}` : cap(T.one) })}</div>
                              ) : (
                                <div>
                                  <label className="label">{tx("form.shirtSize")} *</label>
                                  <select className="input" value={c.shirt_size} onChange={(e) => setCompanions(t.id, i, a.companions.map((x, j) => (j === k ? { ...x, shirt_size: e.target.value } : x)))} required>
                                    <option value="">Select size</option>
                                    {SHIRT_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                                  </select>
                                </div>
                              )}
                              {c.included ? (
                                <span className="h-9 px-2 text-xs leading-9 text-emerald-300">{php(0)}</span>
                              ) : (
                                <button type="button" className="btn-secondary h-9 px-3 text-xs" onClick={() => setCompanions(t.id, i, a.companions.filter((_, j) => j !== k))} aria-label={`Remove companion ${k + 1}`}>
                                  Remove
                                </button>
                              )}
                            </div>
                          ))}
                          {a.companions.filter((c) => !c.included).length > 0 && (
                            <div className="mt-2 text-right text-sm text-zinc-300">
                              {a.companions.filter((c) => !c.included).length} extra companion{a.companions.filter((c) => !c.included).length === 1 ? "" : "s"} × {php(companionPrice)} = <b className="text-white">{php(a.companions.filter((c) => !c.included).length * companionPrice)}</b>
                            </div>
                          )}
                          {companionsLeft <= 0 && <p className="mt-2 text-xs text-amber-300">No {companionType.name} {T.many} are left for more companions.</p>}
                          {a.companions.length >= MAX_COMPANIONS_PER_CAR && <p className="mt-2 text-xs text-amber-300">This car already has the maximum of {MAX_COMPANIONS_PER_CAR} companions.</p>}
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          ))}
        </section>
      )}

      <Reveal as="section" className="space-y-3" delay={120}>
        <h2 className="form-step"><span><span className="form-step-no">{anySelected ? 3 : 2}</span> {fill(bf.title)}</span>{bf.subtitle && <span className="form-step-sub">{fill(bf.subtitle)}</span>}</h2>
        <div className="card grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="buyer-name">{bf.nameLabel} *</label>
            <input id="buyer-name" className="input" placeholder={bf.namePlaceholder || undefined} value={buyer.buyer_name} onChange={(e) => setBuyer({ ...buyer, buyer_name: e.target.value })} required />
          </div>
          <div className="sm:col-span-2 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="buyer-email">{bf.emailLabel} *</label>
              <input
                id="buyer-email"
                className={`input ${emailIssue ? "border-amber-400/60" : ""}`}
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder={bf.emailPlaceholder || undefined}
                value={buyer.buyer_email}
                onChange={(e) => setBuyer({ ...buyer, buyer_email: e.target.value })}
                onBlur={() => setBuyer((b) => ({ ...b, buyer_email: normalizeEmail(b.buyer_email) }))}
                required
                aria-invalid={emailIssue ? true : undefined}
                aria-describedby="buyer-email-hint"
              />
              <p id="buyer-email-hint" className={`mt-1 text-xs ${emailIssue || emailSuggestion ? "enter text-amber-300" : "text-zinc-500"}`}>
                {emailIssue ? (
                  emailIssue
                ) : emailSuggestion ? (
                  <>
                    Did you mean{" "}
                    <button type="button" className="font-semibold underline underline-offset-2" onClick={() => setBuyer({ ...buyer, buyer_email: emailSuggestion })}>
                      {emailSuggestion}
                    </button>
                    ?
                  </>
                ) : (
                  bf.emailHint
                )}
              </p>
            </div>
            <div>
              <label className="label" htmlFor="buyer-email-confirm">{bf.confirmLabel} *</label>
              <input
                id="buyer-email-confirm"
                className={`input ${emailMismatch ? "border-rose-400/60" : emailConfirm && !emailMismatch ? "border-emerald-400/50" : ""}`}
                type="email"
                inputMode="email"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder={bf.confirmPlaceholder || undefined}
                value={emailConfirm}
                onChange={(e) => setEmailConfirm(e.target.value)}
                onBlur={() => setEmailConfirm((v) => normalizeEmail(v))}
                required
                aria-invalid={emailMismatch ? true : undefined}
                aria-describedby="buyer-email-confirm-hint"
              />
              <p id="buyer-email-confirm-hint" className={`mt-1 text-xs ${emailMismatch ? "enter text-rose-300" : emailConfirm && !emailIssue ? "text-emerald-300" : "text-zinc-500"}`}>
                {emailMismatch ? "Does not match the email above" : emailConfirm && !emailIssue ? "Emails match" : bf.confirmHint}
              </p>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="buyer-mobile">{bf.mobileLabel} *</label>
            <input
              id="buyer-mobile"
              className="input"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              placeholder={bf.mobilePlaceholder || undefined}
              maxLength={16}
              value={buyer.buyer_mobile}
              onChange={(e) => setBuyer({ ...buyer, buyer_mobile: e.target.value.replace(/[^\d+\s-]/g, "") })}
              onBlur={() => setBuyer((b) => ({ ...b, buyer_mobile: normalizeMobile(b.buyer_mobile) || b.buyer_mobile }))}
              required
              aria-invalid={mobileIssue ? true : undefined}
              aria-describedby="buyer-mobile-hint"
            />
            <p id="buyer-mobile-hint" className={`mt-1 text-xs ${mobileIssue ? "text-amber-300" : "text-zinc-500"}`}>
              {mobileIssue ?? bf.mobileHint}
            </p>
          </div>
        </div>
      </Reveal>

      {needsShipping && (
        <Reveal as="section" className="space-y-3" delay={120}>
          <h2 className="form-step"><span><span className="form-step-no">4</span> {fill(page.shippingTitle)}</span>{page.shippingSub && <span className="form-step-sub">{fill(page.shippingSub)}</span>}</h2>
          <div className="card space-y-3">
            <div className="rounded-lg border border-violet-400/30 bg-violet-400/10 p-3 text-sm text-violet-100">
              {tx("ship.note", { time: processing })}
              {tx("ship.noteTl") && <span className="mt-1 block text-xs text-violet-200/80">{tx("ship.noteTl")}</span>}
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-cyan-400" checked={shipToBuyer} onChange={(e) => setShipToBuyer(e.target.checked)} />
              {tx("ship.toMe", { name: buyer.buyer_name.trim() || "the name above", mobile: buyer.buyer_mobile.trim() || "the mobile above" })}
            </label>
            {!shipToBuyer && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="ship-name">{tx("ship.recipientName")} *</label>
                  <input id="ship-name" className="input" autoComplete="shipping name" value={ship.name} onChange={(e) => setShip({ ...ship, name: e.target.value })} />
                </div>
                <div>
                  <label className="label" htmlFor="ship-mobile">{tx("ship.recipientMobile")} *</label>
                  <input id="ship-mobile" className="input" type="tel" inputMode="numeric" autoComplete="shipping tel-national" placeholder="09171234567" maxLength={16}
                    value={ship.mobile} onChange={(e) => setShip({ ...ship, mobile: e.target.value.replace(/[^\d+\s-]/g, "") })}
                    aria-describedby="ship-mobile-hint" />
                  <p id="ship-mobile-hint" className={`mt-1 text-xs ${shipMobileIssue ? "text-amber-300" : "text-zinc-500"}`}>{shipMobileIssue ?? tx("ship.courierCalls")}</p>
                </div>
              </div>
            )}
            <div>
              <label className="label" htmlFor="ship-address">{tx("ship.address")} *</label>
              <input id="ship-address" className="input" autoComplete="shipping street-address" placeholder={tx("ship.addressPlaceholder") || undefined}
                value={ship.address} onChange={(e) => setShip({ ...ship, address: e.target.value })} />
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7rem]">
              <div>
                <label className="label" htmlFor="ship-city">{tx("ship.city")} *</label>
                <input id="ship-city" className="input" autoComplete="shipping address-level2" value={ship.city} onChange={(e) => setShip({ ...ship, city: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="ship-province">{tx("ship.province")} *</label>
                <input id="ship-province" className="input" autoComplete="shipping address-level1" value={ship.province} onChange={(e) => setShip({ ...ship, province: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="ship-zip">{tx("ship.zip")} *</label>
                <input id="ship-zip" className="input" inputMode="numeric" autoComplete="shipping postal-code" maxLength={4} placeholder="3018"
                  value={ship.zip} onChange={(e) => setShip({ ...ship, zip: e.target.value.replace(/\D/g, "") })} />
              </div>
            </div>
            <div>
              <span className="label">{tx("ship.courier")} *</span>
              <div className="mt-1 inline-flex rounded-lg border border-white/15 bg-black/30 p-0.5" role="radiogroup" aria-label={tx("ship.courier")}>
                {COURIERS.map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={ship.courier === c} onClick={() => setShip({ ...ship, courier: c })}
                    className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${ship.courier === c ? "bg-gradient-to-r from-cyan-300 to-green-300 text-zinc-950" : "text-zinc-300 hover:bg-white/10"}`}>
                    {c}
                  </button>
                ))}
              </div>
              {tx("ship.feeNote") && <p className="mt-1 text-xs text-zinc-500">{tx("ship.feeNote")}</p>}
            </div>
          </div>
        </Reveal>
      )}

      {error && <p className="enter rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <Reveal from="zoom" delay={200} className="total-bar">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-xs font-semibold text-zinc-400">{tx("form.total")}</div>
            <div className="total-amount">{php(total)}</div>
            {anySelected && <div className="text-xs text-zinc-400">{tx("form.count", { n: count, items: count === 1 ? T.one : T.many })}</div>}
          </div>
          <button className="btn-neon" disabled={!anySelected || pending}>
            {pending ? "Reserving..." : fill(page.submitButton)}
          </button>
        </div>
        {(payNote || page.payNoteTl) && (
          <p className="mt-3 text-xs text-zinc-400">{fill(payNote)}{payNote && page.payNoteTl && " "}{page.payNoteTl && <span className="text-zinc-500">{fill(page.payNoteTl)}</span>}</p>
        )}
      </Reveal>
    </form>
    {review && (
      <OrderReviewModal
        channel={channel}
        lines={reviewLines}
        companionPrice={companionPrice}
        companionLabel={companionType?.name ?? "Companion"}
        companionBand={companionType?.band_color ?? null}
        buyer={{ ...buyer, buyer_mobile: normalizeMobile(buyer.buyer_mobile) || buyer.buyer_mobile }}
        shipping={needsShipping ? { ...shipTo, mobile: normalizeMobile(shipTo.mobile) || shipTo.mobile } : null}
        total={total}
        pending={pending}
        onClose={() => !pending && setReview(false)}
        onConfirm={confirm}
      />
    )}
    </>
  );
}
