"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveEvent, getOrderBundle, getTicketTypes, isSalesOpen } from "@/lib/queries";
import { fmtCutoff, isTypeClosed } from "@/lib/cutoff";
import { sendOrderReceivedEmail } from "@/lib/email";
import { getRules } from "@/lib/rules";
import { IMAGE_MIME, MAX_UPLOAD_BYTES } from "@/lib/image";
import { MOBILE_RE, emailProblem, normalizeEmail, normalizeMobile } from "@/lib/contact";
import { audit } from "@/lib/audit";
import { COURIERS } from "@/lib/shipping";

export type ActionResult = { ok: true; warning?: string } | { ok: false; error: string };

const attendeeSchema = z.object({
  holder_name: z.string().trim().min(2, "Enter the holder's full name for each ticket").max(80),
  // Checked against the sizes offered in Settings inside createOnlineOrder.
  shirt_size: z.string().trim().max(8).optional(),
  vehicle_plate: z.string().trim().max(20).optional(),
  vehicle_model: z.string().trim().max(60).optional(),
  // Set server-side after upload; anything the client sends here is discarded.
  vehicle_photo_path: z.string().optional(),
  // VIP Pass ticket bought from inside a VIP Car Display ticket: the car's plate.
  companion_of: z.string().trim().max(20).optional(),
  // Free companion bundled with the car package; the server re-derives the price.
  included: z.boolean().optional(),
});

/** Where a shipped shirt goes (labels with ships_shirt). */
const shippingSchema = z.object({
  name: z.string().trim().min(2, "Shipping: enter the recipient's full name").max(80),
  mobile: z.preprocess(
    (v) => normalizeMobile(String(v ?? "")),
    z.string().regex(MOBILE_RE, "Shipping: enter an 11-digit PH mobile number for the courier, like 09171234567"),
  ),
  address: z.string().trim().min(5, "Shipping: enter the house or unit no., street and barangay").max(200),
  city: z.string().trim().min(2, "Shipping: enter the city or municipality").max(80),
  province: z.string().trim().min(2, "Shipping: enter the province").max(80),
  zip: z.string().trim().regex(/^\d{4}$/, "Shipping: enter the 4-digit ZIP code"),
  courier: z.enum(COURIERS, { message: "Shipping: choose LBC or J&T Express" }),
});

/** Plates compare without spaces or case: "NBC 8821" == "nbc8821". */
const plateKey = (p: string | undefined | null) => (p ?? "").replace(/\s+/g, "").toUpperCase();

const createOrderSchema = z.object({
  buyer_name: z.string().trim().min(2, "Enter your full name").max(80),
  buyer_email: z.preprocess(
    (v) => normalizeEmail(String(v ?? "")),
    z
      .string()
      .min(1, "Enter your email")
      .max(120)
      .email("Enter a valid email")
      .superRefine((e, ctx) => {
        const problem = emailProblem(e);
        if (problem) ctx.addIssue({ code: "custom", message: `Email: ${problem}` });
      }),
  ),
  // Accept "+63 917 123 4567", "0917-123-4567" etc.; store the canonical 09XXXXXXXXX.
  buyer_mobile: z.preprocess(
    (v) => normalizeMobile(String(v ?? "")),
    z.string().regex(MOBILE_RE, "Enter an 11-digit PH mobile number starting with 09, like 09171234567"),
  ),
  items: z
    .array(
      z.object({
        ticket_type_id: z.string().uuid(),
        // Direct tickets are capped at MAX_QTY_PER_TYPE below; companions are only limited by the pool.
        qty: z.number().int().min(1).max(500),
        attendees: z.array(attendeeSchema),
        // Ignored from the client; set server-side (0 for included companions).
        unit_price_centavos: z.number().int().min(0).optional(),
      }),
    )
    .min(1, "Select at least one ticket"),
  // Required when the order holds a shirt that ships; dropped otherwise.
  shipping: shippingSchema.optional().nullable(),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

/**
 * Public checkout: creates a pending order and redirects to the payment page.
 * Takes FormData so VIP Car Display photos can ride along:
 *   payload            JSON matching createOrderSchema
 *   photo:<type>:<i>   car photo for attendee i of that ticket type
 */
export async function createOnlineOrder(formData: FormData): Promise<ActionResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("payload") ?? ""));
  } catch {
    return { ok: false, error: "Invalid input" };
  }
  const parsed = createOrderSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const event = await getActiveEvent();
  if (!event) return { ok: false, error: "No active event" };
  if (!isSalesOpen(event)) return { ok: false, error: "Ticket sales are closed" };

  // Validate vehicle/shirt requirements against the ticket types sold online
  const types = await getTicketTypes(event.id, { onlineOnly: true });
  const photos: { item: number; index: number; file: File }[] = [];
  // The cars in this order by plate, with their label; a companion must ride with one of them.
  const carOfPlate = new Map<string, (typeof types)[number]>();
  for (const i of parsed.data.items) {
    const t = types.find((x) => x.id === i.ticket_type_id);
    if (!t?.requires_vehicle) continue;
    for (const a of i.attendees) if (plateKey(a.vehicle_plate)) carOfPlate.set(plateKey(a.vehicle_plate), t);
  }
  const plates = new Set(carOfPlate.keys());
  let companions = 0;
  let includedTotal = 0;
  const companionsPerCar = new Map<string, number>();
  const includedPerCar = new Map<string, number>();
  const { maxQtyPerType: MAX_QTY_PER_TYPE, maxCompanionsPerCar: MAX_COMPANIONS_PER_CAR, paymentWindowMinutes: PAYMENT_WINDOW_MINUTES, shirtChart } = await getRules();
  const sizes = new Set(shirtChart.map((r) => r.size));
  // Free companions come with a car package: included_companions per car of that label
  // (VIP Car Display with shirt has one; the no-shirt car has none).
  const includedAllowance = parsed.data.items.reduce((n, i) => {
    const t = types.find((x) => x.id === i.ticket_type_id);
    return n + (t?.requires_vehicle ? i.attendees.filter((a) => !a.companion_of).length * t.included_companions : 0);
  }, 0);
  for (const [ii, item] of parsed.data.items.entries()) {
    const tt = types.find((t) => t.id === item.ticket_type_id);
    if (!tt) return { ok: false, error: "Unknown ticket type" };
    if (isTypeClosed(tt)) return { ok: false, error: `Online sales for ${tt.name} closed on ${fmtCutoff(tt.sales_close_at!)}. Remove it from your order.` };
    if (item.attendees.length !== item.qty) return { ok: false, error: `Fill in details for each ${tt.name} ticket` };
    const direct = item.attendees.filter((a) => !a.companion_of).length;
    if (direct > MAX_QTY_PER_TYPE) return { ok: false, error: `At most ${MAX_QTY_PER_TYPE} ${tt.name} tickets per order` };
    for (const [i, a] of item.attendees.entries()) {
      a.vehicle_photo_path = undefined;
      if (a.shirt_size && !sizes.has(a.shirt_size)) return { ok: false, error: `Size ${a.shirt_size} is not offered. Pick another size.` };
      if (a.companion_of) {
        // The free passenger wears a wristband from the car's own pool; paid companions buy a VIP Pass.
        const car = carOfPlate.get(plateKey(a.companion_of));
        if (a.included) {
          if (car && (tt.id !== car.id || car.included_companions < 1)) return { ok: false, error: `${car.name} has no included passenger on this line` };
        } else if (!tt.includes_shirt || tt.requires_vehicle) {
          return { ok: false, error: "Companions must be VIP Pass tickets" };
        }
        if (!plates.has(plateKey(a.companion_of))) return { ok: false, error: `Companion ${a.holder_name || i + 1} must belong to a car in this order` };
        a.companion_of = a.companion_of.replace(/\s+/g, " ").trim().toUpperCase();
        companions += 1;
        const perCar = (companionsPerCar.get(plateKey(a.companion_of)) ?? 0) + 1;
        companionsPerCar.set(plateKey(a.companion_of), perCar);
        if (perCar > MAX_COMPANIONS_PER_CAR) return { ok: false, error: `Up to ${MAX_COMPANIONS_PER_CAR} companions per car (${a.companion_of})` };
        if (a.included) {
          const inc = (includedPerCar.get(plateKey(a.companion_of)) ?? 0) + 1;
          includedPerCar.set(plateKey(a.companion_of), inc);
          if (inc > (car?.included_companions ?? 0)) return { ok: false, error: `Only ${car?.included_companions ?? 0} passenger wristband(s) are included per car (${a.companion_of})` };
          includedTotal += 1;
        }
      } else if (a.included) {
        return { ok: false, error: "Included companions must ride with a car in this order" };
      }
      if (!a.holder_name) return { ok: false, error: `Enter the holder's full name for each ${tt.name} ticket` };
      if (tt.includes_shirt && !a.shirt_size && !a.included) return { ok: false, error: `Choose a shirt size for each ${tt.name} ticket` };
      if (tt.requires_vehicle && !a.companion_of) {
        if (!a.vehicle_plate || a.vehicle_plate.length < 3) return { ok: false, error: `Enter the plate number for each ${tt.name} ticket` };
        if (!a.vehicle_model || a.vehicle_model.length < 2) return { ok: false, error: `Enter the car make and model for each ${tt.name} ticket` };
        const file = formData.get(`photo:${tt.id}:${i}`);
        if (!(file instanceof File) || file.size === 0) return { ok: false, error: `Add a photo of the car for each ${tt.name} ticket` };
        if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: "Each car photo must be under 8 MB" };
        if (!IMAGE_MIME.test(file.type)) return { ok: false, error: "Car photos must be images (JPG, PNG, WEBP or HEIC)" };
        photos.push({ item: ii, index: i, file });
      }
    }
  }

  if (includedTotal > includedAllowance) return { ok: false, error: "More included companions than the car package allows" };

  // A shirt that ships needs somewhere to go. The included passenger has no shirt.
  const shipsShirt = parsed.data.items.some(
    (i) => types.find((t) => t.id === i.ticket_type_id)?.ships_shirt && i.attendees.some((a) => !a.included),
  );
  if (shipsShirt && !parsed.data.shipping) return { ok: false, error: "Enter where to ship your shirt (name, mobile, address, ZIP and courier)." };
  const shipping = shipsShirt ? parsed.data.shipping ?? null : null;
  // Price is decided here, never by the client: an item is free only when every attendee is an included companion.
  for (const item of parsed.data.items) {
    const allIncluded = item.attendees.length > 0 && item.attendees.every((a) => a.included && a.companion_of);
    item.unit_price_centavos = allIncluded ? 0 : undefined;
    if (!allIncluded) for (const a of item.attendees) a.included = undefined;
  }

  const admin = createAdminClient();

  // Upload car photos first; the paths travel inside the attendee JSON into order_items
  // and are copied onto the tickets when the order is issued. A failed order leaves at
  // most a few orphan files, which is acceptable.
  if (photos.length > 0) {
    const folder = crypto.randomUUID();
    for (const p of photos) {
      const ext = (p.file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      const path = `${folder}/${p.item}-${p.index}.${ext}`;
      const { error: upErr } = await admin.storage
        .from("vehicle-photos")
        .upload(path, Buffer.from(await p.file.arrayBuffer()), { contentType: p.file.type, upsert: false });
      if (upErr) return { ok: false, error: `Car photo upload failed: ${upErr.message}` };
      parsed.data.items[p.item].attendees[p.index].vehicle_photo_path = path;
    }
  }

  const { data: orderId, error } = await admin.rpc("create_order", {
    p_event_id: event.id,
    p_channel: "online",
    p_buyer_name: parsed.data.buyer_name,
    p_buyer_email: parsed.data.buyer_email,
    p_buyer_mobile: parsed.data.buyer_mobile,
    p_items: parsed.data.items,
    p_expires_minutes: PAYMENT_WINDOW_MINUTES,
  });
  if (error || !orderId) return { ok: false, error: error?.message ?? "Could not create order" };
  // The address goes on the order straight after it is made. Should that fail, the
  // order is cancelled at once (freeing its wristbands) rather than left without one.
  if (shipping) {
    const { error: shipErr } = await admin.from("orders").update({ shipping }).eq("id", orderId);
    if (shipErr) {
      await admin.from("orders").update({ status: "cancelled" }).eq("id", orderId);
      return { ok: false, error: "Could not save the shipping address. Nothing was charged; please try again." };
    }
  }
  await audit(admin, {
    actor: null,
    action: "order.created",
    entity: "order",
    entity_id: orderId,
    data: { buyer: parsed.data.buyer_name, companions, included: includedTotal, items: parsed.data.items.reduce((n, i) => n + i.qty, 0), total_centavos: parsed.data.items.reduce((n, i) => n + i.qty * (i.unit_price_centavos ?? types.find((t) => t.id === i.ticket_type_id)?.price_centavos ?? 0), 0) },
  });

  // A way back to the pay page if the buyer loses the tab while paying. Must never block the order.
  try {
    const bundle = await getOrderBundle(orderId);
    if (bundle) await sendOrderReceivedEmail(bundle);
  } catch (e) {
    console.error(`[order] received-email failed for ${orderId}:`, e instanceof Error ? e.message : e);
  }

  redirect(`/pay/${orderId}`);
}

const proofSchema = z.object({
  order_id: z.string().uuid(),
  payment_method: z.enum(["gotyme", "gcash", "maya"]),
  // InstaPay / bank references mix letters and digits; e-wallets use digits only.
  payment_reference: z.preprocess(
    (v) => String(v ?? "").replace(/\s+/g, "").toUpperCase(),
    z.string().regex(/^[A-Z0-9-]{6,40}$/, "Enter the reference number shown on your payment confirmation (letters and digits only)"),
  ),
});

/** Buyer submits reference number + screenshot. Moves order to awaiting_verification. */
export async function submitPaymentProof(formData: FormData): Promise<ActionResult> {
  const parsed = proofSchema.safeParse({
    order_id: formData.get("order_id"),
    payment_method: formData.get("payment_method"),
    payment_reference: formData.get("payment_reference"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const file = formData.get("screenshot");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Attach your payment screenshot" };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: "Screenshot must be under 8 MB" };
  if (!IMAGE_MIME.test(file.type)) return { ok: false, error: "Screenshot must be an image" };

  const admin = createAdminClient();
  await admin.rpc("expire_stale_orders", {});
  const { data: order } = await admin.from("orders").select("*").eq("id", parsed.data.order_id).maybeSingle();
  if (!order) return { ok: false, error: "Order not found" };
  if (order.status === "expired") {
    // Expiry is final: the wristbands went back to the pool the moment the hold
    // lapsed, so accepting a late upload here would promise stock that may already
    // belong to someone else. A buyer who did pay is sent to the organizer.
    return { ok: false, error: "This order expired, so the wristbands were released. Please place a new order. If you already paid, contact the organizer with your reference number and they will sort it out." };
  } else if (order.status !== "pending_payment" && order.status !== "awaiting_verification") {
    return { ok: false, error: `This order is already ${order.status.replace("_", " ")}` };
  }

  // Reject reference numbers already used on another live order
  const { data: dupe } = await admin
    .from("orders")
    .select("id")
    .eq("payment_method", parsed.data.payment_method)
    .eq("payment_reference", parsed.data.payment_reference)
    .neq("id", order.id)
    .neq("status", "rejected")
    .maybeSingle();
  if (dupe) return { ok: false, error: "This reference number was already submitted for another order" };

  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${order.id}/${Date.now()}.${ext}`;
  const { error: upErr } = await admin.storage
    .from("payment-proofs")
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (upErr) return { ok: false, error: `Upload failed: ${upErr.message}` };

  const { error } = await admin
    .from("orders")
    .update({
      status: "awaiting_verification",
      payment_method: parsed.data.payment_method,
      payment_reference: parsed.data.payment_reference,
      payment_proof_path: path,
      proof_submitted_at: new Date().toISOString(),
      expires_at: null,
    })
    .eq("id", order.id);
  if (error) return { ok: false, error: error.message };
  await audit(admin, { actor: null, action: "order.proof_submitted", entity: "order", entity_id: order.id, data: { method: parsed.data.payment_method, reference: parsed.data.payment_reference } });

  redirect(`/order/${order.id}`);
}
