-- Match the official poster (2026-09-20):
--   Early Bird P150 / Kids P75: dedicated entrance, free event decal
--   VIP Pass P950, limited to 200
--   VIP Car Display P1,850, limited to 40 cars, includes 2 VIP Pass for passengers
-- online_cap limits DIRECT online tickets of a type (companions excluded);
-- included_companions = free VIP Pass companions bundled with one ticket.

alter table ticket_types
  add column if not exists online_cap integer,
  add column if not exists included_companions integer not null default 0;

update ticket_types set
  price_centavos = 185000,
  online_cap = 40,
  included_companions = 2,
  description = 'VIP car display parking for your car plus 2 VIP Pass for your passengers, included. Dedicated VIP entrance, VIP viewing tent, 1 event t-shirt, 2 VIP lanyards, 2 event decals, and a drift demo raffle entry. Limited to 40 cars. Car photo, plate number and model required.'
where code = 'R';

update ticket_types set
  online_cap = 200,
  description = 'Dedicated VIP entrance, VIP viewing tent, event t-shirt, VIP lanyard ID, event decal, and a drift demo raffle entry. Limited to 200.'
where code = 'G';

update ticket_types set
  includes_sticker = true,
  description = 'General admission wristband with dedicated entrance and a free event decal.'
where code = 'P';

update ticket_types set
  includes_sticker = true,
  description = 'For children 12 years old and below: dedicated entrance and a free event decal. Same blue stripes wristband as walk-in kids.'
where code = 'B';

-- Availability: sellable is now the smaller of the wristband pool and the cap.
-- New columns appended: online_cap, cap_used (direct tickets in live orders), pool_sellable.
create or replace view v_ticket_type_availability as
select
  tt.id as ticket_type_id,
  tt.event_id,
  tt.code, tt.name, tt.price_centavos, tt.walkin_price_centavos, tt.band_color, tt.sort_order, tt.active, tt.sell_online,
  p.pool_total,
  p.pool_available,
  p.voided,
  p.assigned                                   as online_sold,
  w.walkin_sold,
  p.assigned + w.walkin_sold                   as sold,
  r.reserved,
  case when tt.online_cap is null
       then p.pool_available - r.reserved - w.walkin_sold
       else least(p.pool_available - r.reserved - w.walkin_sold, tt.online_cap - c.cap_used) end as sellable,
  o.online_revenue_centavos,
  w.walkin_revenue_centavos,
  o.online_revenue_centavos + w.walkin_revenue_centavos as revenue_centavos,
  (select count(*) from tickets t where t.ticket_type_id = tt.id and t.status = 'redeemed') as redeemed,
  tt.online_cap,
  c.cap_used,
  p.pool_available - r.reserved - w.walkin_sold as pool_sellable
from ticket_types tt
cross join lateral (
  select count(*) as pool_total,
         count(*) filter (where n.status = 'available') as pool_available,
         count(*) filter (where n.status = 'assigned')  as assigned,
         count(*) filter (where n.status = 'void')      as voided
  from ticket_numbers n where n.ticket_type_id = tt.id
) p
cross join lateral (
  select coalesce(sum(oi.qty), 0)::bigint as reserved
  from order_items oi join orders o_1 on o_1.id = oi.order_id
  where oi.ticket_type_id = tt.id and o_1.status in ('pending_payment','awaiting_verification')
) r
cross join lateral (
  -- direct (non-companion) tickets of this type in live orders, counted against online_cap
  select coalesce(sum(
           case when jsonb_typeof(oi.attendees) = 'array' and jsonb_array_length(oi.attendees) > 0
                then (select count(*) from jsonb_array_elements(oi.attendees) a where coalesce(a->>'companion_of','') = '')
                else oi.qty end), 0)::bigint as cap_used
  from order_items oi join orders o_1 on o_1.id = oi.order_id
  where oi.ticket_type_id = tt.id and o_1.status in ('pending_payment','awaiting_verification','paid')
) c
cross join lateral (
  select coalesce(sum(oi.qty * oi.unit_price_centavos), 0)::bigint
         - coalesce((select sum(oi2.unit_price_centavos)
                     from tickets t
                     join order_items oi2 on oi2.order_id = t.order_id and oi2.ticket_type_id = t.ticket_type_id
                     join orders o2 on o2.id = t.order_id
                     where t.ticket_type_id = tt.id and t.status = 'void' and o2.status = 'paid'), 0)::bigint
         as online_revenue_centavos
  from order_items oi join orders o_1 on o_1.id = oi.order_id
  where oi.ticket_type_id = tt.id and o_1.status = 'paid'
) o
cross join lateral (
  select coalesce(sum(ws.qty), 0)::bigint as walkin_sold,
         coalesce(sum(ws.qty * ws.unit_price_centavos), 0)::bigint as walkin_revenue_centavos
  from walkin_sales ws where ws.ticket_type_id = tt.id
) w;

alter view public.v_ticket_type_availability set (security_invoker = on);
revoke select on public.v_ticket_type_availability from anon;

-- create_order: per-item price may be 0 only for VIP Pass companions bundled with a
-- VIP Car Display ticket (attendee.included = true); caps are enforced per type.
create or replace function create_order(
  p_event_id uuid,
  p_channel order_channel,
  p_buyer_name text,
  p_buyer_email text,
  p_buyer_mobile text,
  p_items jsonb,
  p_expires_minutes integer,
  p_sold_by uuid default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order_id uuid;
  v_total integer := 0;
  v_item jsonb;
  v_agg record;
  v_type ticket_types%rowtype;
  v_avail record;
  v_qty integer;
  v_price integer;
  v_included integer;
  v_allowance integer := 0;
  v_included_total integer := 0;
begin
  perform expire_stale_orders();

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'No tickets selected';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    perform pg_advisory_xact_lock(hashtext((v_item->>'ticket_type_id')));
  end loop;

  -- Free companion allowance = sum of included_companions over the tickets that grant them.
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_type from ticket_types where id = (v_item->>'ticket_type_id')::uuid and active;
    if not found then raise exception 'Unknown or inactive ticket type'; end if;
    v_allowance := v_allowance + v_type.included_companions * (v_item->>'qty')::int;
  end loop;

  -- Price each item and count the free companions claimed.
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'qty')::int;
    if v_qty is null or v_qty <= 0 then raise exception 'Invalid quantity'; end if;
    select * into v_type from ticket_types where id = (v_item->>'ticket_type_id')::uuid;
    v_price := coalesce((v_item->>'unit_price_centavos')::int, v_type.price_centavos);
    if v_price <> v_type.price_centavos then
      select count(*) into v_included from jsonb_array_elements(coalesce(v_item->'attendees','[]'::jsonb)) a
        where (a->>'included')::boolean is true and coalesce(a->>'companion_of','') <> '';
      if v_price <> 0 or v_included <> v_qty then
        raise exception 'Invalid price for %', v_type.name;
      end if;
      v_included_total := v_included_total + v_included;
    end if;
    v_total := v_total + v_qty * v_price;
  end loop;
  if v_included_total > v_allowance then
    raise exception 'Only % included VIP Pass companion(s) come with this order', v_allowance;
  end if;

  -- Availability per type: wristband pool for everything, online_cap for direct tickets.
  for v_agg in
    select (i->>'ticket_type_id')::uuid as tid,
           sum((i->>'qty')::int) as qty,
           sum(case when jsonb_typeof(i->'attendees') = 'array' and jsonb_array_length(i->'attendees') > 0
                    then (select count(*) from jsonb_array_elements(i->'attendees') a where coalesce(a->>'companion_of','') = '')
                    else (i->>'qty')::int end) as direct
    from jsonb_array_elements(p_items) i group by 1
  loop
    select * into v_type from ticket_types where id = v_agg.tid;
    select pool_sellable, online_cap, cap_used into v_avail from v_ticket_type_availability where ticket_type_id = v_agg.tid;
    if v_avail.pool_sellable < v_agg.qty then
      raise exception 'Only % left for %', greatest(v_avail.pool_sellable, 0), v_type.name;
    end if;
    if v_avail.online_cap is not null and v_agg.direct > 0 and v_avail.cap_used + v_agg.direct > v_avail.online_cap then
      raise exception 'Only % left for %', greatest(v_avail.online_cap - v_avail.cap_used, 0), v_type.name;
    end if;
  end loop;

  insert into orders (event_id, channel, buyer_name, buyer_email, buyer_mobile, total_centavos, expires_at, sold_by)
  values (p_event_id, p_channel, p_buyer_name, p_buyer_email, p_buyer_mobile, v_total,
          case when p_channel = 'online' then now() + make_interval(mins => p_expires_minutes) end,
          p_sold_by)
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_type from ticket_types where id = (v_item->>'ticket_type_id')::uuid;
    v_price := coalesce((v_item->>'unit_price_centavos')::int, v_type.price_centavos);
    insert into order_items (order_id, ticket_type_id, qty, unit_price_centavos, attendees)
    values (v_order_id, v_type.id, (v_item->>'qty')::int, v_price, coalesce(v_item->'attendees','[]'::jsonb));
  end loop;

  return v_order_id;
end $$;

revoke execute on function public.create_order(uuid, order_channel, text, text, text, jsonb, integer, uuid) from public, anon, authenticated;

-- VIP Car Display also hands out 2 event decals (poster).
update ticket_types set includes_sticker = true where code = 'R';
