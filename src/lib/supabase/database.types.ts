// Generated from Supabase project bcrxzihpyoahvfmrayej on 2026-09-11.
// Regenerate after schema changes:
//   npx supabase gen types typescript --project-id bcrxzihpyoahvfmrayej > src/lib/supabase/database.types.ts
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor: string | null
          created_at: string
          data: Json | null
          entity: string
          entity_id: string | null
          id: number
        }
        Insert: {
          action: string
          actor?: string | null
          created_at?: string
          data?: Json | null
          entity: string
          entity_id?: string | null
          id?: number
        }
        Update: {
          action?: string
          actor?: string | null
          created_at?: string
          data?: Json | null
          entity?: string
          entity_id?: string | null
          id?: number
        }
        Relationships: []
      }
      events: {
        Row: {
          active: boolean
          created_at: string
          gcash_account_name: string | null
          gcash_qr_url: string | null
          id: string
          maya_account_name: string | null
          maya_qr_url: string | null
          name: string
          org_address: string | null
          org_name: string
          org_tin: string | null
          org_vat_registered: boolean
          receipt_label: string
          refund_policy: string | null
          sales_close_at: string | null
          sales_open_at: string | null
          slug: string
          starts_at: string | null
          tagline: string | null
          venue: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          gcash_account_name?: string | null
          gcash_qr_url?: string | null
          id?: string
          maya_account_name?: string | null
          maya_qr_url?: string | null
          name: string
          org_address?: string | null
          org_name: string
          org_tin?: string | null
          org_vat_registered?: boolean
          receipt_label?: string
          refund_policy?: string | null
          sales_close_at?: string | null
          sales_open_at?: string | null
          slug: string
          starts_at?: string | null
          tagline?: string | null
          venue?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          gcash_account_name?: string | null
          gcash_qr_url?: string | null
          id?: string
          maya_account_name?: string | null
          maya_qr_url?: string | null
          name?: string
          org_address?: string | null
          org_name?: string
          org_tin?: string | null
          org_vat_registered?: boolean
          receipt_label?: string
          refund_policy?: string | null
          sales_close_at?: string | null
          sales_open_at?: string | null
          slug?: string
          starts_at?: string | null
          tagline?: string | null
          venue?: string | null
        }
        Relationships: []
      }
      order_items: {
        Row: {
          attendees: Json
          id: string
          order_id: string
          qty: number
          ticket_type_id: string
          unit_price_centavos: number
        }
        Insert: {
          attendees?: Json
          id?: string
          order_id: string
          qty: number
          ticket_type_id: string
          unit_price_centavos: number
        }
        Update: {
          attendees?: Json
          id?: string
          order_id?: string
          qty?: number
          ticket_type_id?: string
          unit_price_centavos?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_ticket_type_id_fkey"
            columns: ["ticket_type_id"]
            isOneToOne: false
            referencedRelation: "ticket_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_ticket_type_id_fkey"
            columns: ["ticket_type_id"]
            isOneToOne: false
            referencedRelation: "v_ticket_type_availability"
            referencedColumns: ["ticket_type_id"]
          },
        ]
      }
      orders: {
        Row: {
          buyer_email: string | null
          buyer_mobile: string | null
          buyer_name: string
          channel: Database["public"]["Enums"]["order_channel"]
          created_at: string
          email_sent_at: string | null
          event_id: string
          expires_at: string | null
          id: string
          notes: string | null
          order_no: number
          paid_at: string | null
          payment_method: Database["public"]["Enums"]["payment_method"] | null
          payment_proof_path: string | null
          payment_reference: string | null
          proof_submitted_at: string | null
          receipt_no: number | null
          rejection_reason: string | null
          sold_by: string | null
          status: Database["public"]["Enums"]["order_status"]
          total_centavos: number
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          buyer_email?: string | null
          buyer_mobile?: string | null
          buyer_name: string
          channel?: Database["public"]["Enums"]["order_channel"]
          created_at?: string
          email_sent_at?: string | null
          event_id: string
          expires_at?: string | null
          id?: string
          notes?: string | null
          order_no?: number
          paid_at?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          payment_proof_path?: string | null
          payment_reference?: string | null
          proof_submitted_at?: string | null
          receipt_no?: number | null
          rejection_reason?: string | null
          sold_by?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          total_centavos: number
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          buyer_email?: string | null
          buyer_mobile?: string | null
          buyer_name?: string
          channel?: Database["public"]["Enums"]["order_channel"]
          created_at?: string
          email_sent_at?: string | null
          event_id?: string
          expires_at?: string | null
          id?: string
          notes?: string | null
          order_no?: number
          paid_at?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          payment_proof_path?: string | null
          payment_reference?: string | null
          proof_submitted_at?: string | null
          receipt_no?: number | null
          rejection_reason?: string | null
          sold_by?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          total_centavos?: number
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_sold_by_fkey"
            columns: ["sold_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          active: boolean
          created_at: string
          full_name: string
          id: string
          role: Database["public"]["Enums"]["staff_role"]
        }
        Insert: {
          active?: boolean
          created_at?: string
          full_name: string
          id: string
          role?: Database["public"]["Enums"]["staff_role"]
        }
        Update: {
          active?: boolean
          created_at?: string
          full_name?: string
          id?: string
          role?: Database["public"]["Enums"]["staff_role"]
        }
        Relationships: []
      }
      ticket_numbers: {
        Row: {
          created_at: string
          id: string
          number: string
          seq: number
          status: Database["public"]["Enums"]["number_status"]
          ticket_type_id: string
          void_reason: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          number: string
          seq: number
          status?: Database["public"]["Enums"]["number_status"]
          ticket_type_id: string
          void_reason?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          number?: string
          seq?: number
          status?: Database["public"]["Enums"]["number_status"]
          ticket_type_id?: string
          void_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ticket_numbers_ticket_type_id_fkey"
            columns: ["ticket_type_id"]
            isOneToOne: false
            referencedRelation: "ticket_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_numbers_ticket_type_id_fkey"
            columns: ["ticket_type_id"]
            isOneToOne: false
            referencedRelation: "v_ticket_type_availability"
            referencedColumns: ["ticket_type_id"]
          },
        ]
      }
      ticket_types: {
        Row: {
          active: boolean
          band_color: string | null
          code: string
          description: string | null
          event_id: string
          id: string
          includes_car_pass: boolean
          includes_lanyard: boolean
          includes_shirt: boolean
          includes_sticker: boolean
          is_child: boolean
          name: string
          price_centavos: number
          requires_vehicle: boolean
          sort_order: number
        }
        Insert: {
          active?: boolean
          band_color?: string | null
          code: string
          description?: string | null
          event_id: string
          id?: string
          includes_car_pass?: boolean
          includes_lanyard?: boolean
          includes_shirt?: boolean
          includes_sticker?: boolean
          is_child?: boolean
          name: string
          price_centavos: number
          requires_vehicle?: boolean
          sort_order?: number
        }
        Update: {
          active?: boolean
          band_color?: string | null
          code?: string
          description?: string | null
          event_id?: string
          id?: string
          includes_car_pass?: boolean
          includes_lanyard?: boolean
          includes_shirt?: boolean
          includes_sticker?: boolean
          is_child?: boolean
          name?: string
          price_centavos?: number
          requires_vehicle?: boolean
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "ticket_types_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      tickets: {
        Row: {
          created_at: string
          holder_name: string | null
          id: string
          kit_claimed: Json
          number: string
          order_id: string
          qr_token: string
          redeemed_at: string | null
          redeemed_by: string | null
          shirt_size: string | null
          status: Database["public"]["Enums"]["ticket_status"]
          ticket_number_id: string
          ticket_type_id: string
          vehicle_model: string | null
          vehicle_plate: string | null
        }
        Insert: {
          created_at?: string
          holder_name?: string | null
          id?: string
          kit_claimed?: Json
          number: string
          order_id: string
          qr_token: string
          redeemed_at?: string | null
          redeemed_by?: string | null
          shirt_size?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          ticket_number_id: string
          ticket_type_id: string
          vehicle_model?: string | null
          vehicle_plate?: string | null
        }
        Update: {
          created_at?: string
          holder_name?: string | null
          id?: string
          kit_claimed?: Json
          number?: string
          order_id?: string
          qr_token?: string
          redeemed_at?: string | null
          redeemed_by?: string | null
          shirt_size?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          ticket_number_id?: string
          ticket_type_id?: string
          vehicle_model?: string | null
          vehicle_plate?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tickets_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_redeemed_by_fkey"
            columns: ["redeemed_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_ticket_number_id_fkey"
            columns: ["ticket_number_id"]
            isOneToOne: true
            referencedRelation: "ticket_numbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_ticket_type_id_fkey"
            columns: ["ticket_type_id"]
            isOneToOne: false
            referencedRelation: "ticket_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_ticket_type_id_fkey"
            columns: ["ticket_type_id"]
            isOneToOne: false
            referencedRelation: "v_ticket_type_availability"
            referencedColumns: ["ticket_type_id"]
          },
        ]
      }
    }
    Views: {
      v_ticket_type_availability: {
        Row: {
          active: boolean | null
          band_color: string | null
          code: string | null
          event_id: string | null
          name: string | null
          pool_available: number | null
          pool_total: number | null
          price_centavos: number | null
          redeemed: number | null
          reserved: number | null
          revenue_centavos: number | null
          sellable: number | null
          sold: number | null
          sort_order: number | null
          ticket_type_id: string | null
          voided: number | null
        }
        Insert: {
          active?: boolean | null
          band_color?: string | null
          code?: string | null
          event_id?: string | null
          name?: string | null
          pool_available?: never
          pool_total?: never
          price_centavos?: number | null
          redeemed?: never
          reserved?: never
          revenue_centavos?: never
          sellable?: never
          sold?: never
          sort_order?: number | null
          ticket_type_id?: string | null
          voided?: never
        }
        Update: {
          active?: boolean | null
          band_color?: string | null
          code?: string | null
          event_id?: string | null
          name?: string | null
          pool_available?: never
          pool_total?: never
          price_centavos?: number | null
          redeemed?: never
          reserved?: never
          revenue_centavos?: never
          sellable?: never
          sold?: never
          sort_order?: number | null
          ticket_type_id?: string | null
          voided?: never
        }
        Relationships: [
          {
            foreignKeyName: "ticket_types_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      create_order: {
        Args: {
          p_buyer_email: string
          p_buyer_mobile: string
          p_buyer_name: string
          p_channel: Database["public"]["Enums"]["order_channel"]
          p_event_id: string
          p_expires_minutes: number
          p_items: Json
          p_sold_by?: string
        }
        Returns: string
      }
      expire_stale_orders: { Args: never; Returns: number }
      import_number_range: {
        Args: {
          p_end: number
          p_pad: number
          p_prefix: string
          p_start: number
          p_ticket_type_id: string
        }
        Returns: number
      }
      is_staff: { Args: never; Returns: boolean }
      issue_order_tickets: {
        Args: {
          p_actor: string
          p_order_id: string
          p_payment_method: Database["public"]["Enums"]["payment_method"]
          p_payment_reference: string
          p_tokens: string[]
        }
        Returns: {
          created_at: string
          holder_name: string | null
          id: string
          kit_claimed: Json
          number: string
          order_id: string
          qr_token: string
          redeemed_at: string | null
          redeemed_by: string | null
          shirt_size: string | null
          status: Database["public"]["Enums"]["ticket_status"]
          ticket_number_id: string
          ticket_type_id: string
          vehicle_model: string | null
          vehicle_plate: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "tickets"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      redeem_ticket: {
        Args: { p_actor: string; p_token: string }
        Returns: {
          result: string
          ticket_id: string
        }[]
      }
    }
    Enums: {
      number_status: "available" | "assigned" | "void"
      order_channel: "online" | "onsite" | "import"
      order_status:
        | "pending_payment"
        | "awaiting_verification"
        | "paid"
        | "rejected"
        | "expired"
        | "cancelled"
      payment_method: "gcash" | "maya" | "cash"
      staff_role: "admin" | "staff" | "scanner"
      ticket_status: "issued" | "redeemed" | "void"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

export const Constants = {
  public: {
    Enums: {
      number_status: ["available", "assigned", "void"],
      order_channel: ["online", "onsite", "import"],
      order_status: [
        "pending_payment",
        "awaiting_verification",
        "paid",
        "rejected",
        "expired",
        "cancelled",
      ],
      payment_method: ["gcash", "maya", "cash"],
      staff_role: ["admin", "staff", "scanner"],
      ticket_status: ["issued", "redeemed", "void"],
    },
  },
} as const
