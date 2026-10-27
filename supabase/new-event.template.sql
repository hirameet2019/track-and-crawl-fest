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

-- One row per ticket type. code = the letter that starts its numbers (C001 -> C);
-- the number import matches by it.
insert into ticket_types (
  event_id, code, name, description, price_centavos, walkin_price_centavos, band_color,
  sell_online, sell_at_gate, walkin_name, gate_needs_name,
  includes_shirt, includes_lanyard, includes_sticker, includes_car_pass,
  requires_vehicle, included_companions, is_child,
  online_cap, drifter_family, free_allowance, sort_order
)
select e.id, v.* from events e,
(values
  -- code name                       description                                          price  gate   band  online gate  walkin_name gate_name shirt lany  stick carpass vehicle comp child cap   (unused) sort
  -- A vehicle registration: needs the driver's name, plate, make/model and a photo.
  ('C', '<Car Registration>',        '<Registration for one car. Plate, model and photo.>',   50000, null, null, true,  true, null,       true,     false,false,false,true,   true,   0,   false,null, false, 0,  1),
  ('M', '<Motorcycle Registration>', '<Registration for one motorcycle.>',                    50000, null, null, true,  true, null,       true,     false,false,false,true,   true,   0,   false,null, false, 0,  2),
  -- A plain entry with no vehicle, if the event sells one.
  ('G', '<General Admission>',       '<Entry for one person.>',                               15000, null, null, true,  true, null,       false,    false,false,false,false,  false,  0,   false,null, false, 0,  3)
) as v(code, name, description, price_centavos, walkin_price_centavos, band_color,
       sell_online, sell_at_gate, walkin_name, gate_needs_name,
       includes_shirt, includes_lanyard, includes_sticker, includes_car_pass,
       requires_vehicle, included_companions, is_child,
       online_cap, drifter_family, free_allowance, sort_order)
where e.slug = '<event-slug-2027>';

commit;

-- Registration numbers come next: import a range per type at Admin > Numbers
-- (e.g. prefix C, 1 to 500, pad 3 gives C001 to C500).
