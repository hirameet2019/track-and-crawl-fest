"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveEvent, getTicketTypes, isSalesOpen } from "@/lib/queries";
import { MAX_QTY_PER_TYPE, PAYMENT_WINDOW_MINUTES, SHIRT_SIZES } from "@/config/event";
import { IMAGE_MIME, MAX_UPLOAD_BYTES } from "@/lib/image";
import { MOBILE_RE, normalizeMobile } from "@/lib/contact";
import { audit } from "@/lib/audit";

export type ActionResult = { ok: true; warning?: string } | { ok: false; error: string };

const attendeeSchema = z.object({
  holder_name: z.string().trim().min(2, "Enter the holder's full name for each ticket").max(80),
  shirt_size: z.enum(SHIRT_SIZES).optional(),
  vehicle_plate: z.string().trim().max(20).optional(),
  vehicle_model: z.string().trim().max(60).optional(),
  // Set server-side after upload; anything the client sends here is discarded.
  vehicle_photo_path: z.string().optional(),
});

const createOrderSchema = z.object({
  buyer_name: z.string().trim().min(2, "Enter your full name").max(80),
  buyer_email: z.string().trim().email("Enter a valid email"),
  // Accept "+63 917 123 4567", "0917-123-4567" etc.; store the canonical 09XXXXXXXXX.
  buyer_mobile: z.preprocess(
    (v) => normalizeMobile(String(v ?? "")),
    z.string().regex(MOBILE_RE, "Enter an 11-digit PH mobile number starting with 09, like 09171234567"),
  ),
  items: z
    .array(
      z.object({
        ticket_type_id: z.string().uuid(),
        qty: z.number().int().min(1).max(MAX_QTY_PER_TYPE),
        attendees: z.array(attendeeSchema),
      }),
    )
    .min(1, "Select at least one ticket"),
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
  for (const [ii, item] of parsed.data.items.entries()) {
    const tt = types.find((t) => t.id === item.ticket_type_id);
    if (!tt) return { ok: false, error: "Unknown ticket type" };
    if (item.attendees.length !== item.qty) return { ok: false, error: `Fill in details for each ${tt.name} ticket` };
    for (const [i, a] of item.attendees.entries()) {
      a.vehicle_photo_path = undefined;
      if (!a.holder_name) return { ok: false, error: `Enter the holder's full name for each ${tt.name} ticket` };
      if (tt.includes_shirt && !a.shirt_size) return { ok: false, error: `Choose a shirt size for each ${tt.name} ticket` };
      if (tt.requires_vehicle) {
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
    p_buyer_email: parsed.data.buyer_email.toLowerCase(),
    p_buyer_mobile: parsed.data.buyer_mobile,
    p_items: parsed.data.items,
    p_expires_minutes: PAYMENT_WINDOW_MINUTES,
  });
  if (error || !orderId) return { ok: false, error: error?.message ?? "Could not create order" };
  await audit(admin, {
    actor: null,
    action: "order.created",
    entity: "order",
    entity_id: orderId,
    data: { buyer: parsed.data.buyer_name, items: parsed.data.items.reduce((n, i) => n + i.qty, 0), total_centavos: parsed.data.items.reduce((n, i) => n + i.qty * (types.find((t) => t.id === i.ticket_type_id)?.price_centavos ?? 0), 0) },
  });

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
  if (order.status === "expired") return { ok: false, error: "This order expired. Please place a new order." };
  if (order.status !== "pending_payment" && order.status !== "awaiting_verification")
    return { ok: false, error: `This order is already ${order.status.replace("_", " ")}` };

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
