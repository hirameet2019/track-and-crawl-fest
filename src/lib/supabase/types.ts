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
export type TicketStatus = "issued" | "redeemed" | "void";
export type NumberStatus = "available" | "assigned" | "void";
export type StaffRole = "admin" | "staff" | "scanner";

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
  payment_method: PaymentMethod | null;
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
  notes: string | null;
  created_at: string;
}

export interface Attendee {
  holder_name?: string;
  shirt_size?: string;
  vehicle_plate?: string;
  vehicle_model?: string;
  /** Object path in the private vehicle-photos bucket (VIP Car Display). */
  vehicle_photo_path?: string;
  /** Plate of the VIP Car Display car this (VIP Standing) ticket rides with. */
  companion_of?: string;
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
  ticket_number_id: string;
  number: string;
  qr_token: string;
  holder_name: string | null;
  shirt_size: string | null;
  vehicle_plate: string | null;
  vehicle_model: string | null;
  vehicle_photo_path: string | null;
  companion_of: string | null;
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
  /** pool_available - reserved - walkin_sold */
  sellable: number;
  online_revenue_centavos: number;
  walkin_revenue_centavos: number;
  revenue_centavos: number;
  redeemed: number;
}

export interface WalkinSaleRow {
  id: string;
  event_id: string;
  ticket_type_id: string;
  qty: number;
  unit_price_centavos: number;
  payment_method: PaymentMethod;
  sold_by: string | null;
  created_at: string;
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
          p_payment_method: PaymentMethod | null;
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
