import type { Shipping } from "@/lib/shipping";

/**
 * Hand-maintained row/enum types used across the app. The generated schema types
 * from the live project live in ./database.types.ts. Regenerate those with
 *   npx supabase gen types typescript --project-id <id> > src/lib/supabase/database.types.ts
 * the row shapes below match the migration.
 */
export type OrderStatus =
  | "pending_payment"
  | "awaiting_verification"
  | "paid"
  | "rejected"
  | "expired"
  | "cancelled"
  | "voided";
export type OrderChannel = "online" | "onsite" | "import";
export type PaymentMethod = "gotyme" | "gcash" | "maya" | "cash";
/** Channels a buyer can pay through online (everything except cash at the gate). */
export type OnlinePaymentMethod = Exclude<PaymentMethod, "cash">;
/** What an order can record: the four above, or "other" for a channel added in Settings. */
export type OrderPaymentMethod = PaymentMethod | "other";
export type TicketStatus = "issued" | "redeemed" | "void";
export type NumberStatus = "available" | "assigned" | "void";
export type StaffRole = "admin" | "staff" | "gate" | "scanner";

export interface EventRow {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  venue: string | null;
  starts_at: string | null;
  sales_open_at: string | null;
  sales_close_at: string | null;
  org_name: string;
  org_tin: string | null;
  org_address: string | null;
  org_vat_registered: boolean;
  receipt_label: string;
  gotyme_qr_url: string | null;
  gotyme_account_name: string | null;
  gcash_qr_url: string | null;
  gcash_account_name: string | null;
  maya_qr_url: string | null;
  maya_account_name: string | null;
  refund_policy: string | null;
  /** "Need help?" contact shown to buyers; hidden while null. */
  support_contact_label: string | null;
  support_contact_url: string | null;
  active: boolean;
  created_at: string;
}

export interface TicketTypeRow {
  id: string;
  event_id: string;
  code: string;
  name: string;
  description: string | null;
  price_centavos: number;
  band_color: string | null;
  includes_shirt: boolean;
  includes_lanyard: boolean;
  includes_sticker: boolean;
  includes_car_pass: boolean;
  requires_vehicle: boolean;
  is_child: boolean;
  sort_order: number;
  active: boolean;
  /** Shown on the public order form. Walk-in-only labels are false. */
  sell_online: boolean;
  /** Tally price; null falls back to price_centavos. */
  walkin_price_centavos: number | null;
  /** Online sales stop at this instant; null = no cut-off. Set from Admin > Settings. */
  sales_close_at: string | null;
  /** Max direct online tickets of this type (companions excluded); null = wristband pool only. */
  online_cap: number | null;
  /** Free VIP Pass companions bundled with one ticket of this type (VIP Car Display = 2). */
  included_companions: number;
  /** Handed out on the Drifters tab (competing drivers' families), not the Walk-in tab. */
  drifter_family: boolean;
  /** Bands per drifter at no charge before the gate price applies. */
  free_allowance: number;
  /** Shared drifter sign-up link (/drifters/<slug>); null while closed. */
  drifter_signup_slug: string | null;
  /** Shown on the Walk-in tab and accepted at the gate. */
  sell_at_gate: boolean;
  /** Name the gate desk sees on the Walk-in tab; null uses `name`. */
  walkin_name: string | null;
  /** A gate sale records the person's name (a car label also records the plate). */
  gate_needs_name: boolean;
  /** Online orders give a shipping address and the shirt ships instead of being handed over. */
  ships_shirt: boolean;
  /** Left out of the Dashboard, Walk-in, Orders and Verify; its data is kept (Settings > Tickets). */
  hidden_in_admin: boolean;
  /** Takes its wristband numbers from this ticket type's stack (VIP Pass without shirt on the VIP Pass's bands). */
  pool_type_id: string | null;
}

export interface TicketNumberRow {
  id: string;
  ticket_type_id: string;
  number: string;
  seq: number;
  status: NumberStatus;
  void_reason: string | null;
  created_at: string;
}

export interface StaffRow {
  id: string;
  full_name: string;
  role: StaffRole;
  active: boolean;
  /** May open Numbers, Audit and Settings and use their actions (on top of the admin role). */
  system_access: boolean;
  /** May open Scan and use the scan actions (false hides the Scan tab for this account). */
  can_scan: boolean;
  created_at: string;
}

export interface OrderRow {
  id: string;
  event_id: string;
  order_no: number;
  channel: OrderChannel;
  status: OrderStatus;
  buyer_name: string;
  buyer_email: string | null;
  buyer_mobile: string | null;
  total_centavos: number;
  payment_method: OrderPaymentMethod | null;
  /** Settings id of the channel paid with; null on orders from before custom channels. */
  payment_channel: string | null;
  /** The channel's name when the proof came in. */
  payment_channel_label: string | null;
  payment_reference: string | null;
  payment_proof_path: string | null;
  proof_submitted_at: string | null;
  expires_at: string | null;
  paid_at: string | null;
  verified_by: string | null;
  verified_at: string | null;
  rejection_reason: string | null;
  sold_by: string | null;
  receipt_no: number | null;
  email_sent_at: string | null;
  /** Stamped when the "your hold is about to expire" email went out; null means not sent. */
  reminder_sent_at: string | null;
  /** Stamped when the "your order was cancelled, the timer ran out" email went out. */
  expiry_notice_sent_at: string | null;
  notes: string | null;
  /** Left over after a conversion: positive = refund owed to the buyer, negative = the buyer owes. */
  balance_centavos: number;
  /** Where the shirt ships, for an order holding a label with ships_shirt; null otherwise. */
  shipping: Shipping | null;
  /** Set once staff have actually moved the money. */
  balance_settled_at: string | null;
  balance_note: string | null;
  created_at: string;
}

export interface Attendee {
  holder_name?: string;
  shirt_size?: string;
  vehicle_plate?: string;
  vehicle_model?: string;
  /** Object path in the private vehicle-photos bucket (VIP Car Display). */
  vehicle_photo_path?: string;
  /** Plate of the VIP Car Display car this (VIP Pass) ticket rides with. */
  companion_of?: string;
  /** Companion bundled free with the car package (counts toward the car's included_companions). */
  included?: boolean;
}

export interface OrderItemRow {
  id: string;
  order_id: string;
  ticket_type_id: string;
  qty: number;
  unit_price_centavos: number;
  attendees: Attendee[];
}

export interface TicketRow {
  id: string;
  order_id: string;
  ticket_type_id: string;
  /** Null only on a ticket converted to another type: the band went back to the pool. */
  ticket_number_id: string | null;
  number: string;
  qr_token: string;
  holder_name: string | null;
  shirt_size: string | null;
  vehicle_plate: string | null;
  vehicle_model: string | null;
  vehicle_photo_path: string | null;
  companion_of: string | null;
  /** VIP Pass bundled free with a VIP Car Display ticket: no shirt in the kit. */
  included: boolean;
  status: TicketStatus;
  redeemed_at: string | null;
  redeemed_by: string | null;
  void_reason: string | null;
  voided_at: string | null;
  voided_by: string | null;
  kit_claimed: Record<string, boolean>;
  created_at: string;
}

export interface AvailabilityRow {
  ticket_type_id: string;
  event_id: string;
  code: string;
  name: string;
  price_centavos: number;
  walkin_price_centavos: number | null;
  band_color: string | null;
  sort_order: number;
  active: boolean;
  sell_online: boolean;
  pool_total: number;
  pool_available: number;
  voided: number;
  /** Wristband numbers assigned to issued tickets (online + any order-based sale). */
  online_sold: number;
  /** Net walk-in tally (adds minus corrections). */
  walkin_sold: number;
  /** online_sold + walkin_sold */
  sold: number;
  reserved: number;
  /** min(pool_sellable, online_cap - cap_used); what a buyer may still add directly */
  sellable: number;
  online_cap: number | null;
  /** Direct (non-companion) tickets in live orders, counted against online_cap */
  cap_used: number;
  /** pool_available - reserved - walkin_sold, ignoring the cap (companions draw from this) */
  pool_sellable: number;
  drifter_family: boolean;
  free_allowance: number;
  /** Bands given away inside a drifter's free allowance (never counted as revenue). */
  free_bands: number;
  /** Set when the label takes its wristbands from another label's stack; pool_* are then that stack's. */
  pool_type_id: string | null;
  online_revenue_centavos: number;
  walkin_revenue_centavos: number;
  revenue_centavos: number;
  redeemed: number;
}

export interface WalkinSaleRow {
  id: string;
  event_id: string;
  ticket_type_id: string;
  /** Bands handed over; a package sale counts the included passengers too. */
  qty: number;
  /** Bands inside qty given at no charge (included passengers, drifter allowance). */
  free_qty: number;
  unit_price_centavos: number;
  payment_method: PaymentMethod;
  sold_by: string | null;
  created_at: string;
  /** Shirt handed over with a gate sale of a label that includes one. */
  shirt_size: string | null;
  /** Gate sale of a car label: the driver's name and the car's plate. */
  holder_name: string | null;
  vehicle_plate: string | null;
}

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

// Minimal Database shape for supabase-js generics. Kept loose on purpose:
// the service-role client is only used server-side.
export interface Database {
  public: {
    Tables: {
      events: Table<EventRow>;
      ticket_types: Table<TicketTypeRow>;
      ticket_numbers: Table<TicketNumberRow>;
      staff: Table<StaffRow>;
      orders: Table<OrderRow>;
      order_items: Table<OrderItemRow>;
      tickets: Table<TicketRow>;
      walkin_sales: Table<WalkinSaleRow>;
      audit_log: Table<{
        id: number;
        actor: string | null;
        action: string;
        entity: string;
        entity_id: string | null;
        data: unknown;
        created_at: string;
      }>;
    };
    Views: {
      v_ticket_type_availability: { Row: AvailabilityRow; Relationships: [] };
    };
    Functions: {
      expire_stale_orders: { Args: Record<string, never>; Returns: number };
      create_order: {
        Args: {
          p_event_id: string;
          p_channel: OrderChannel;
          p_buyer_name: string;
          p_buyer_email: string | null;
          p_buyer_mobile: string | null;
          p_items: unknown;
          p_expires_minutes: number;
          p_sold_by?: string | null;
        };
        Returns: string;
      };
      issue_order_tickets: {
        Args: {
          p_order_id: string;
          p_actor: string | null;
          p_payment_method: OrderPaymentMethod | null;
          p_payment_reference: string | null;
          p_tokens: string[];
        };
        Returns: TicketRow[];
      };
      import_number_range: {
        Args: {
          p_ticket_type_id: string;
          p_prefix: string;
          p_start: number;
          p_end: number;
          p_pad: number;
        };
        Returns: number;
      };
      record_walkin: {
        Args: { p_ticket_type_id: string; p_qty: number; p_actor: string | null; p_method: PaymentMethod };
        Returns: number;
      };
      redeem_ticket: {
        Args: { p_token: string; p_actor: string | null };
        Returns: { result: string; ticket_id: string | null }[];
      };
      is_staff: { Args: Record<string, never>; Returns: boolean };
    };
    Enums: {
      order_status: OrderStatus;
      order_channel: OrderChannel;
      payment_method: PaymentMethod;
      ticket_status: TicketStatus;
      number_status: NumberStatus;
      staff_role: StaffRole;
    };
    CompositeTypes: Record<string, never>;
  };
}

/** One drifter's running family-band total (view v_drifter_bands). */
export interface DrifterBandRow {
  ticket_type_id: string;
  event_id: string;
  drifter_key: string;
  drifter_name: string;
  /** The team the drifter runs with; null for a privateer or when never recorded. */
  team_name: string | null;
  bands: number;
  free_bands: number;
  paid_bands: number;
  amount_centavos: number;
  first_at: string;
  last_at: string;
}

/** Roles a drifter can give the people on their pre-registered list. */
export const DRIFTER_ROLES = ["Family", "Friend", "Pit crew", "Spotter", "Manager", "Team staff"] as const;
export type DrifterRole = (typeof DRIFTER_ROLES)[number];

/**
 * One competing drifter from the organizer's entry list, with the private link
 * they pre-register through and the list they submitted (if any).
 */
export interface DrifterEntryRow {
  id: string;
  event_id: string;
  ticket_type_id: string;
  drifter_name: string;
  team_name: string | null;
  car_no: string | null;
  token: string;
  active: boolean;
  /** Signed up through the shared link, not added from an entry list: check the competitor pass. */
  self_registered: boolean;
  /** given_at is set on each person as the desk hands their band over. */
  people: { name: string; role: DrifterRole; given_at?: string }[];
  band_count: number | null;
  /** How many people on the list have collected so far; equals band_count when done. */
  bands_given: number;
  /** Given at self sign-up; the personal link is sent here, and resent on request. */
  contact_email: string | null;
  link_sent_at: string | null;
  rules_ack_at: string | null;
  submitted_at: string | null;
  handed_over_at: string | null;
  handed_over_by: string | null;
  /** Collected at hand-over for bands past the free allowance; 0 when all were free. */
  paid_centavos: number;
  payment_method: PaymentMethod | null;
  payment_ref: string | null;
  created_at: string;
}
