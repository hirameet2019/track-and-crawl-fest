-- VIP Pass shirts ship to the buyer (2026-10-06). From now on a VIP Pass bought
-- online has its shirt made to order: about two weeks of processing, then sent by
-- LBC or J&T Express to an address the buyer gives at checkout, the shipping fee
-- shouldered by the buyer and not part of the order total. Orders placed before
-- this keep their shirt at the event (they are on the organizer's shirt list).
--
-- ticket_types.ships_shirt marks the labels whose shirt ships; orders.shipping
-- holds where to: {name, mobile, address, city, province, zip, courier}. A ticket
-- ships its shirt when its label ships shirts and its order has a shipping address.

alter table ticket_types add column if not exists ships_shirt boolean not null default false;
comment on column ticket_types.ships_shirt is
  'Online orders of this label give a shipping address; the shirt is shipped instead of handed over at the event.';

alter table orders add column if not exists shipping jsonb;
comment on column orders.shipping is
  'Where the shirt ships: {name, mobile, address, city, province, zip, courier}. Null: no shirt to ship.';

update ticket_types set ships_shirt = true where active and code = 'G';
