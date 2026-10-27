-- Track & Crawl Fest 2026: Motorcycle Registration (P500, rider, plate, make/model and a
-- photo of the motorcycle), with its own 100 entry numbers M001-M100, separate from the
-- 300 car slots. One statement for `supabase db query`. Run once after the car file.
with tt as (
  insert into ticket_types (event_id, code, name, description, price_centavos, walkin_price_centavos, band_color,
    sell_online, sell_at_gate, walkin_name, gate_needs_name, includes_shirt, includes_lanyard, includes_sticker, includes_car_pass,
    requires_vehicle, included_companions, is_child, online_cap, drifter_family, free_allowance, sort_order)
  select e.id, 'M', 'Motorcycle Registration', 'Registration for one motorcycle. Plate number, make/model and a photo of the motorcycle are required.',
         50000, null, null, true, true, null, true, false, false, false, true, true, 0, false, null, false, 0, 2
  from events e where e.slug = 'track-and-crawl-fest-2026'
  returning id
)
insert into ticket_numbers (ticket_type_id, number, seq)
select tt.id, 'M' || lpad(g::text, 3, '0'), g from tt cross join generate_series(1, 100) g
