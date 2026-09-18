-- Organizer wristband labels, walk-in tally, VIP Car photo.
--
-- 1. One ticket type per organizer label. The `code` is the serial's letter,
--    which is also the band colour: B blue, Y yellow, O orange, R red, P pink, G green.
-- 2. Walk-in sales become a plain add/minus tally (no buyer details, no tickets),
--    recorded in walkin_sales and subtracted from the wristband pool.
-- 3. VIP Car Display tickets carry a photo of the car.

-- ------------------------------------------------------------------ ticket types
alter table ticket_types
  add column if not exists sell_online boolean not null default true,
  add column if not exists walkin_price_centavos integer check (walkin_price_centavos >= 0);

comment on column ticket_types.sell_online is 'Shown on the public order form. Walk-in-only labels are false.';
comment on column ticket_types.walkin_price_centavos is 'Price used by the walk-in tally; falls back to price_centavos when null.';

update ticket_types set code = 'B', name = 'Child (12 yrs old & below)', band_color = 'Blue stripes', sort_order = 1,
  description = 'General admission for children 12 years old and below. Blue stripes wristband - the same band is used for walk-in kids.'
  where code = 'EBC';
update ticket_types set code = 'R', name = 'VIP Car Display', band_color = 'Red stripes', sort_order = 4,
  description = 'Display your car. Includes event t-shirt, VIP passes and car pass. A photo of the car, plate number and car model are required.'
  where code = 'VIPC';
update ticket_types set code = 'P', name = 'Early Bird Adult', band_color = 'Pink stripes', sort_order = 5,
  description = 'General admission wristband.'
  where code = 'EBA';
update ticket_types set code = 'G', name = 'VIP Standing', band_color = 'Green', sort_order = 6
  where code = 'VIPS';

-- Walk-in-only labels. Price 0 means "not set yet"; the tally refuses to add until an admin sets it.
insert into ticket_types (event_id, code, name, description, price_centavos, band_color, sell_online, sort_order)
select e.id, v.code, v.name, v.description, 0, v.band_color, false, v.sort_order
from events e,
(values
  ('Y', 'Adult Walk-in', 'Sold at the gate only. Yellow stripes wristband.', 'Yellow stripes', 2),
  ('O', 'Adult Walk-in', 'Sold at the gate only. Orange stripes wristband.', 'Orange stripes', 3)
) as v(code, name, description, band_color, sort_order)
where e.active
on conflict (event_id, code) do nothing;

-- ------------------------------------------------------------------ car photo
alter table tickets add column if not exists vehicle_photo_path text;
comment on column tickets.vehicle_photo_path is 'Object path in the private vehicle-photos bucket.';

insert into storage.buckets (id, name, public) values ('vehicle-photos', 'vehicle-photos', false)
on conflict (id) do nothing;

create or replace function issue_order_tickets(
  p_order_id uuid,
  p_actor uuid,
  p_payment_method payment_method,
  p_payment_reference text,
  p_tokens text[]
) returns setof tickets
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order orders%rowtype;
  v_item order_items%rowtype;
  v_num ticket_numbers%rowtype;
  v_ticket tickets%rowtype;
  v_i integer;
  v_tok integer := 1;
  v_att jsonb;
begin
  select * into v_order from orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.status = 'paid' then raise exception 'Order already paid'; end if;
  if v_order.status in ('rejected','cancelled') then raise exception 'Order is %', v_order.status; end if;

  for v_item in select * from order_items where order_id = p_order_id loop
    perform pg_advisory_xact_lock(hashtext(v_item.ticket_type_id::text));
    for v_i in 1..v_item.qty loop
      select * into v_num from ticket_numbers
        where ticket_type_id = v_item.ticket_type_id and status = 'available'
        order by seq for update skip locked limit 1;
      if not found then raise exception 'No wristband numbers left for this ticket type'; end if;

      v_att := coalesce(v_item.attendees -> (v_i - 1), '{}'::jsonb);

      insert into tickets (order_id, ticket_type_id, ticket_number_id, number, qr_token,
                           holder_name, shirt_size, vehicle_plate, vehicle_model, vehicle_photo_path)
      values (p_order_id, v_item.ticket_type_id, v_num.id, v_num.number, p_tokens[v_tok],
              coalesce(v_att->>'holder_name', v_order.buyer_name),
              v_att->>'shirt_size', v_att->>'vehicle_plate', v_att->>'vehicle_model', v_att->>'vehicle_photo_path')
      returning * into v_ticket;

      update ticket_numbers set status = 'assigned' where id = v_num.id;
      v_tok := v_tok + 1;
      return next v_ticket;
    end loop;
  end loop;

  update orders set
    status = 'paid',
    paid_at = now(),
    payment_method = coalesce(p_payment_method, payment_method),
    payment_reference = coalesce(p_payment_reference, payment_reference),
    verified_by = p_actor,
    verified_at = now(),
    receipt_no = nextval('receipt_no_seq')
  where id = p_order_id;

  insert into audit_log (actor, action, entity, entity_id) values (p_actor, 'order.issued', 'order', p_order_id::text);
  return;
end $$;
revoke execute on function public.issue_order_tickets(uuid, uuid, payment_method, text, text[]) from public, anon, authenticated;

-- ------------------------------------------------------------------ walk-in tally
create table if not exists walkin_sales (
  id                  uuid primary key default gen_random_uuid(),
  event_id            uuid not null references events(id) on delete cascade,
  ticket_type_id      uuid not null references ticket_types(id) on delete cascade,
  qty                 integer not null check (qty <> 0),      -- positive = sold, negative = correction
  unit_price_centavos integer not null check (unit_price_centavos >= 0),
  payment_method      payment_method not null default 'cash',
  sold_by             uuid references staff(id),
  created_at          timestamptz not null default now()
);
create index if not exists walkin_sales_type_idx on walkin_sales (ticket_type_id, created_at);
create index if not exists walkin_sales_event_idx on walkin_sales (event_id, created_at);

alter table walkin_sales enable row level security;
drop policy if exists "staff read walkin" on walkin_sales;
create policy "staff read walkin" on walkin_sales for select using (is_staff());

-- Availability now also subtracts walk-in wristbands handed out at the gate.
drop view if exists v_ticket_type_availability;
create view v_ticket_type_availability
with (security_invoker = on) as
select
  tt.id as ticket_type_id,
  tt.event_id,
  tt.code, tt.name, tt.price_centavos, tt.walkin_price_centavos, tt.band_color, tt.sort_order, tt.active, tt.sell_online,
  p.pool_total,
  p.pool_available,
  p.voided,
  p.assigned                                    as online_sold,
  w.walkin_sold,
  p.assigned + w.walkin_sold                    as sold,
  r.reserved,
  p.pool_available - r.reserved - w.walkin_sold as sellable,
  o.online_revenue_centavos,
  w.walkin_revenue_centavos,
  o.online_revenue_centavos + w.walkin_revenue_centavos as revenue_centavos,
  (select count(*) from tickets t where t.ticket_type_id = tt.id and t.status = 'redeemed') as redeemed
from ticket_types tt
cross join lateral (
  select count(*)                                   as pool_total,
         count(*) filter (where n.status = 'available') as pool_available,
         count(*) filter (where n.status = 'assigned')  as assigned,
         count(*) filter (where n.status = 'void')      as voided
  from ticket_numbers n where n.ticket_type_id = tt.id
) p
cross join lateral (
  select coalesce(sum(oi.qty), 0) as reserved
  from order_items oi join orders o on o.id = oi.order_id
  where oi.ticket_type_id = tt.id and o.status in ('pending_payment', 'awaiting_verification')
) r
cross join lateral (
  select coalesce(sum(oi.qty * oi.unit_price_centavos), 0) as online_revenue_centavos
  from order_items oi join orders o on o.id = oi.order_id
  where oi.ticket_type_id = tt.id and o.status = 'paid'
) o
cross join lateral (
  select coalesce(sum(ws.qty), 0)                          as walkin_sold,
         coalesce(sum(ws.qty * ws.unit_price_centavos), 0) as walkin_revenue_centavos
  from walkin_sales ws where ws.ticket_type_id = tt.id
) w;
revoke select on public.v_ticket_type_availability from anon;

-- Record a walk-in tally entry under the same per-type lock used by online orders.
create or replace function record_walkin(
  p_ticket_type_id uuid,
  p_qty integer,
  p_actor uuid,
  p_method payment_method
) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_type ticket_types%rowtype;
  v_price integer;
  v_sellable bigint;
  v_count bigint;
begin
  if p_qty is null or p_qty = 0 then raise exception 'Quantity must not be zero'; end if;
  perform pg_advisory_xact_lock(hashtext(p_ticket_type_id::text));

  select * into v_type from ticket_types where id = p_ticket_type_id and active;
  if not found then raise exception 'Unknown or inactive ticket type'; end if;
  v_price := coalesce(v_type.walkin_price_centavos, v_type.price_centavos);

  select coalesce(sum(qty), 0) into v_count from walkin_sales where ticket_type_id = p_ticket_type_id;

  if p_qty > 0 then
    if v_price <= 0 then raise exception 'Set the walk-in price for % (%) first', v_type.name, v_type.band_color; end if;
    select sellable into v_sellable from v_ticket_type_availability where ticket_type_id = p_ticket_type_id;
    if v_sellable < p_qty then
      raise exception 'Only % wristband(s) left for % (%)', greatest(v_sellable, 0), v_type.name, v_type.band_color;
    end if;
  elsif v_count + p_qty < 0 then
    raise exception 'Nothing left to subtract for % (%)', v_type.name, v_type.band_color;
  end if;

  insert into walkin_sales (event_id, ticket_type_id, qty, unit_price_centavos, payment_method, sold_by)
  values (v_type.event_id, p_ticket_type_id, p_qty, v_price, coalesce(p_method, 'cash'), p_actor);

  insert into audit_log (actor, action, entity, entity_id, data)
  values (p_actor, 'walkin.recorded', 'ticket_type', p_ticket_type_id::text,
          jsonb_build_object('qty', p_qty, 'unit_price_centavos', v_price, 'method', coalesce(p_method, 'cash')));

  return (v_count + p_qty)::integer;
end $$;
revoke execute on function public.record_walkin(uuid, integer, uuid, payment_method) from public, anon, authenticated;
