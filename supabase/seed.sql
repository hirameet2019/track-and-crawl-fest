-- PLACEHOLDER seed data. Replace with organizer-supplied values.
insert into events (slug, name, tagline, venue, starts_at, sales_open_at, sales_close_at,
                    org_name, org_tin, org_address, org_vat_registered, receipt_label,
                    gcash_qr_url, gcash_account_name, maya_qr_url, maya_account_name, refund_policy)
values (
  'drift-2026',
  'PLACEHOLDER Drift Event 2026',
  'Car drift showcase',
  'PLACEHOLDER Venue, City',
  '2026-12-01 14:00+08',
  now(),
  null,                                   -- sales cutoff: to be advised
  'Meet & Drift 3',
  '000-000-000-000',
  'Philippine Arena Helipad Area, Bocaue, Bulacan',   -- organizer address shown under the name on the receipt
  false,
  'ACKNOWLEDGMENT RECEIPT',
  '/placeholders/gcash-qr.png', 'PLACEHOLDER GCash Name',
  '/placeholders/maya-qr.png',  'PLACEHOLDER Maya Name',
  'Refund policy to be announced.'
);

-- One ticket type per organizer wristband label. code = serial letter = band colour.
insert into ticket_types (event_id, code, name, description, price_centavos, walkin_price_centavos, band_color, sell_online,
                          includes_shirt, includes_lanyard, includes_sticker, includes_car_pass, requires_vehicle, is_child, sort_order)
select e.id, v.* from events e,
(values
  ('B', 'Child (12 yrs old & below)', 'General admission for children 12 years old and below. Blue stripes wristband - the same band is used for walk-in kids.', 7500,   null, 'Blue stripes',   true,  false, false, false, false, false, true,  1),
  ('Y', 'Adult Walk-in',              'Sold at the gate only. Yellow stripes wristband.',                                                                       0,      null, 'Yellow stripes', false, false, false, false, false, false, false, 2),
  ('O', 'Adult Walk-in',              'Sold at the gate only. Orange stripes wristband.',                                                                       0,      null, 'Orange stripes', false, false, false, false, false, false, false, 3),
  ('R', 'VIP Car Display',            'Display your car. Includes event t-shirt, VIP passes and car pass. A photo of the car, plate number and car model are required.', 150000, null, 'Red stripes', true, true, true, false, true, true, false, 4),
  ('P', 'Early Bird Adult',           'General admission wristband.',                                                                                           15000,  null, 'Pink stripes',   true,  false, false, false, false, false, false, 5),
  ('G', 'VIP Standing',               'VIP wristband with event t-shirt, ID lanyard and sticker.',                                                              95000,  null, 'Green',          true,  true,  true,  true,  false, false, false, 6)
) as v(code, name, description, price_centavos, walkin_price_centavos, band_color, sell_online, includes_shirt, includes_lanyard, includes_sticker, includes_car_pass, requires_vehicle, is_child, sort_order)
where e.slug = 'drift-2026';

-- Wristband serials come from the organizer's spreadsheet, not from a range:
--   python scripts/wristbands-from-xlsx.py "<Remaining Tickets.xlsx>" --push
-- (or generate SQL with the same script and run supabase/data/wristbands-*.sql).
