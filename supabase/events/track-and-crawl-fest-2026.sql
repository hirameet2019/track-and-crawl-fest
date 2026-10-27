-- Track & Crawl Fest 2026: first event row, the Car Registration type (P500, plate +
-- make/model + car photo) and 300 entry numbers C001-C300. One statement, because
-- `supabase db query` refuses several. Run once after `supabase db push`.
-- Organizer, receipt details, payment QR and refund policy: fill in Admin > Settings.

with ev as (
  insert into events (slug, name, tagline, venue, starts_at, sales_open_at, sales_close_at, org_name, org_vat_registered, receipt_label, active)
  values ('track-and-crawl-fest-2026', 'Track & Crawl Fest 2026', 'Big cars. Small rigs. Same passion.', 'Tarlac Circuit Hill, Tarlac, Philippines',
          '2026-11-07 07:00+08', now(), null, 'Track & Crawl Fest 2026', false, 'ACKNOWLEDGMENT RECEIPT', true)
  returning id
), tt as (
  insert into ticket_types (event_id, code, name, description, price_centavos, walkin_price_centavos, band_color,
    sell_online, sell_at_gate, walkin_name, gate_needs_name, includes_shirt, includes_lanyard, includes_sticker, includes_car_pass,
    requires_vehicle, included_companions, is_child, online_cap, drifter_family, free_allowance, sort_order)
  select ev.id, 'C', 'Car Registration', 'Registration for one car. Plate number, make/model and a photo of the car are required.',
         50000, null, null, true, true, null, true, false, false, false, true, true, 0, false, null, false, 0, 1
  from ev
  returning id
)
insert into ticket_numbers (ticket_type_id, number, seq)
select tt.id, 'C' || lpad(g::text, 3, '0'), g from tt cross join generate_series(1, 300) g
