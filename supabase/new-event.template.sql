-- New event: copy this file, replace every <...>, then run it once in the SQL editor
-- (or `npx supabase db query -f <your copy>.sql`). See SETUP-NEW-EVENT.md.
--
-- Use a FRESH Supabase project per event. Several staff screens and the gate
-- scanner do not filter by event yet, so a second event in the same project
-- would mix in the old event's orders and accept its QR codes at the gate.

begin;

-- The app shows the newest row with active = true. Only matters if you ignored
-- the advice above and reused a project.
update events set active = false where active;

insert into events (
  slug, name, tagline, venue, starts_at, sales_open_at, sales_close_at,
  org_name, org_tin, org_address, org_vat_registered, receipt_label,
  gotyme_qr_url, gotyme_account_name,      -- a channel is offered only when its *_qr_url is set
  gcash_qr_url,  gcash_account_name,
  maya_qr_url,   maya_account_name,
  refund_policy, support_contact_label, support_contact_url, active
) values (
  '<event-slug-2027>',                     -- unique, lowercase, no spaces
  '<Event Name>',                          -- browser tab, emails, PDF, alt text all use this
  '<Short tagline>',
  '<Venue, City>',
  '<2027-03-01 14:00+08>',
  now(),
  null,                                    -- overall cut-off; per-type cut-offs are set in Admin > Settings
  '<Organizer legal name>',                -- receipt header
  '<000-000-000-000>',
  '<Organizer address on the receipt>',
  false,
  'ACKNOWLEDGMENT RECEIPT',                -- 'OFFICIAL RECEIPT' only once BIR-registered
  '/payment/<channel>-qr.jpg', '<Account holder name>',
  null, null,
  null, null,
  '<Refund policy text>',
  '<Message us on Facebook>', '<https://m.me/yourpage>',  -- "Need help?" link; keep set while sales are open
  true
);

-- One row per wristband label. code = the letter printed on the band serials
-- (the import script matches serials to types by this letter).
insert into ticket_types (
  event_id, code, name, description, price_centavos, walkin_price_centavos, band_color,
  sell_online, sell_at_gate, walkin_name, gate_needs_name,
  includes_shirt, includes_lanyard, includes_sticker, includes_car_pass,
  requires_vehicle, included_companions, is_child,
  online_cap, drifter_family, free_allowance, sort_order
)
select e.id, v.* from events e,
(values
  -- code name                 description                                  price  gate   band       online gate  walkin_name gate_name shirt lany  stick carpass vehicle comp child cap   drifter free sort
  ('P', '<General Admission>', '<General admission wristband.>',            15000, null, '<Pink>',   true,  true, null,       false,    false,false,false,false,  false,  0,   false,null, false,  0,   1),
  ('B', '<Kids (12 and below)>','<For children 12 and below.>',             7500,  null, '<Blue>',   true,  true, null,       false,    false,false,false,false,  false,  0,   true, null, false,  0,   2),
  ('G', '<VIP Pass>',          '<VIP wristband with shirt and lanyard.>',   95000, null, '<Green>',  true,  true, null,       false,    true, true, true, false,  false,  0,   false,null, false,  0,   3),
  -- A car ticket: needs plate + car photo; included_companions free passes ride on it.
  ('R', '<VIP Car Display>',   '<Display your car. Includes car pass.>',    150000,null, '<Red>',    true,  true, null,       true,     true, true, false,true,   true,   1,   false,null, false,  0,   4),
  -- Gate-only label: sold at the Walk-in tab, never online (price there comes from walkin_price).
  ('Y', '<Adult Walk-in>',     '<Sold at the gate only.>',                  0,     20000,'<Yellow>', false, true, null,       false,    false,false,false,false,  false,  0,   false,null, false,  0,   5)
  -- Drifter family label (Drifters tab, free_allowance free bands per drifter). Delete if not needed;
  -- the Drifters tab hides itself when no type has drifter_family = true.
  -- ,('D', '<Drifter Family>', '<For competing drivers'' families.>',       0,     20000,'<Black>',  false, false,null,       false,    false,false,false,false,  false,  0,   false,null, true,   6,   6)
) as v(code, name, description, price_centavos, walkin_price_centavos, band_color,
       sell_online, sell_at_gate, walkin_name, gate_needs_name,
       includes_shirt, includes_lanyard, includes_sticker, includes_car_pass,
       requires_vehicle, included_companions, is_child,
       online_cap, drifter_family, free_allowance, sort_order)
where e.slug = '<event-slug-2027>';

commit;

-- Wristband serials come next, from the organizer's spreadsheet:
--   python scripts/wristbands-from-xlsx.py "<Remaining Tickets.xlsx>" --push
