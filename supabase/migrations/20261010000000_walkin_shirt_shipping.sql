-- VIP Pass sold at the gate ships its shirt too (2026-10-10). The shirt is made to
-- order like the online ones, so the gate desk takes a delivery address instead of
-- handing a shirt over. Same shape as orders.shipping:
-- {name, mobile, address, city, province, zip, courier}.
--
-- The app writes it onto the sale right after record_walkin returns the sale id, so
-- record_walkin itself is unchanged on event day. Null: nothing ships (every label
-- other than VIP Pass, and gate sales made before this).

alter table walkin_sales add column if not exists shipping jsonb;
comment on column walkin_sales.shipping is
  'Where the shirt of this gate sale ships: {name, mobile, address, city, province, zip, courier}. Null: shirt handed over or no shirt.';
