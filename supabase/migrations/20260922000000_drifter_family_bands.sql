-- Drifter family wristbands (2026-09-22, organizer request).
--
-- Competing drivers ("drifters") bring family with them. They get their own
-- wristband label - PLAIN RED, no stripes, so a marshal cannot confuse it with the
-- striped red VIP Car Display band - counted on its own tab so the drifters stay
-- isolated from public walk-in and online sales.
--
-- Each drifter's family gets `free_allowance` bands at no cost (4). Anything past
-- that is charged at the label's gate price (P150, editable by an admin).
-- Entries are recorded per drifter name so staff can see who took how many.
--
-- The tally rides on walkin_sales - same pool deduction, same revenue plumbing -
-- with two new columns: `drifter_name` (who it went to) and `free_qty` (how many of
-- the row's bands were inside the free allowance, so revenue skips them).

alter table ticket_types
  -- true = this label is handed out on the Drifters tab, not the Walk-in tab
  add column if not exists drifter_family boolean not null default false,
  -- bands per drifter at no charge before the gate price applies
  add column if not exists free_allowance integer not null default 0;

alter table walkin_sales
  add column if not exists drifter_name text,
  add column if not exists free_qty integer not null default 0;

create index if not exists walkin_sales_drifter_idx
  on walkin_sales (ticket_type_id, lower(drifter_name)) where drifter_name is not null;

-- ------------------------------------------------------------------ the label
insert into ticket_types (event_id, code, name, description, price_centavos, walkin_price_centavos,
                          band_color, includes_shirt, includes_lanyard, includes_sticker, includes_car_pass,
                          requires_vehicle, is_child, sort_order, active, sell_online, drifter_family, free_allowance)
select e.id, 'D', 'Drifter Family',
       'Wristbands for the family of a competing drifter. Four per drifter are free; extra bands are charged at the gate price.',
       15000, 15000, 'Plain Red', false, false, false, false, false, false, 7, true, false, true, 4
from events e
where e.active and not exists (select 1 from ticket_types t where t.event_id = e.id and t.code = 'D');

-- ------------------------------------------------------------------ availability
-- Same view as 20260920040000 plus drifter_family / free_allowance, and walk-in
-- revenue now skips the bands given away inside a drifter's free allowance.
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
  p.pool_available - r.reserved - w.walkin_sold as pool_sellable,
  tt.drifter_family,
  tt.free_allowance,
  w.free_bands
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
  select coalesce(sum(ws.qty), 0)::bigint                                       as walkin_sold,
         coalesce(sum(ws.free_qty), 0)::bigint                                  as free_bands,
         coalesce(sum((ws.qty - ws.free_qty) * ws.unit_price_centavos), 0)::bigint as walkin_revenue_centavos
  from walkin_sales ws where ws.ticket_type_id = tt.id
) w;

alter view public.v_ticket_type_availability set (security_invoker = on);
revoke select on public.v_ticket_type_availability from anon;

-- ------------------------------------------------------------------ per-drifter roll-up
drop view if exists v_drifter_bands;
create view v_drifter_bands with (security_invoker = on) as
select
  ws.ticket_type_id,
  tt.event_id,
  lower(ws.drifter_name)                                                     as drifter_key,
  min(ws.drifter_name)                                                       as drifter_name,
  sum(ws.qty)::integer                                                       as bands,
  sum(ws.free_qty)::integer                                                  as free_bands,
  (sum(ws.qty) - sum(ws.free_qty))::integer                                  as paid_bands,
  sum((ws.qty - ws.free_qty) * ws.unit_price_centavos)::bigint               as amount_centavos,
  min(ws.created_at)                                                         as first_at,
  max(ws.created_at)                                                         as last_at
from walkin_sales ws
join ticket_types tt on tt.id = ws.ticket_type_id
where ws.drifter_name is not null
group by ws.ticket_type_id, tt.event_id, lower(ws.drifter_name)
having sum(ws.qty) <> 0;
revoke select on public.v_drifter_bands from anon;

-- ------------------------------------------------------------------ record a hand-out
-- Splits the entry into free and paid bands from the drifter's running total, so the
-- 5th band onward is charged and an undo gives the free allowance back.
create or replace function record_drifter_bands(
  p_ticket_type_id uuid,
  p_drifter_name text,
  p_qty integer,
  p_actor uuid,
  p_method payment_method
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_type ticket_types%rowtype;
  v_name text;
  v_existing text;
  v_price integer;
  v_sellable bigint;
  v_before bigint;
  v_after bigint;
  v_free integer;
  v_paid integer;
begin
  if p_qty is null or p_qty = 0 then raise exception 'Quantity must not be zero'; end if;
  v_name := nullif(btrim(regexp_replace(p_drifter_name, '\s+', ' ', 'g')), '');
  if v_name is null then raise exception 'Enter the drifter''s name'; end if;
  if length(v_name) > 80 then raise exception 'That name is too long'; end if;

  perform pg_advisory_xact_lock(hashtext(p_ticket_type_id::text));

  select * into v_type from ticket_types where id = p_ticket_type_id and active;
  if not found then raise exception 'Unknown or inactive ticket type'; end if;
  if not v_type.drifter_family then raise exception '% is not a drifter family label', v_type.name; end if;
  v_price := coalesce(v_type.walkin_price_centavos, v_type.price_centavos);

  -- Keep one spelling per drifter: match on lower(), store the spelling first used.
  select ws.drifter_name into v_existing
  from walkin_sales ws
  where ws.ticket_type_id = p_ticket_type_id and lower(ws.drifter_name) = lower(v_name)
  order by ws.created_at limit 1;
  if v_existing is not null then v_name := v_existing; end if;

  select coalesce(sum(ws.qty), 0) into v_before
  from walkin_sales ws
  where ws.ticket_type_id = p_ticket_type_id and lower(ws.drifter_name) = lower(v_name);

  v_after := v_before + p_qty;
  if v_after < 0 then
    raise exception '% has only % band(s) recorded', v_name, v_before;
  end if;

  if p_qty > 0 then
    select a.sellable into v_sellable from v_ticket_type_availability a where a.ticket_type_id = p_ticket_type_id;
    if v_sellable < p_qty then
      raise exception 'Only % wristband(s) left for % (%)', greatest(v_sellable, 0), v_type.name, v_type.band_color;
    end if;
  end if;

  v_free := (least(v_after, v_type.free_allowance) - least(v_before, v_type.free_allowance))::integer;
  v_paid := p_qty - v_free;

  if v_paid > 0 and v_price <= 0 then
    raise exception 'Set the price for extra % bands first', v_type.name;
  end if;

  insert into walkin_sales (event_id, ticket_type_id, drifter_name, qty, free_qty, unit_price_centavos, payment_method, sold_by)
  values (v_type.event_id, p_ticket_type_id, v_name, p_qty, v_free, v_price, coalesce(p_method, 'cash'), p_actor);

  insert into audit_log (actor, action, entity, entity_id, data)
  values (p_actor, 'drifter.bands', 'ticket_type', p_ticket_type_id::text,
          jsonb_build_object('drifter', v_name, 'qty', p_qty, 'free', v_free, 'paid', v_paid,
                             'unit_price_centavos', v_price, 'method', coalesce(p_method, 'cash')));

  return jsonb_build_object(
    'drifter_name', v_name,
    'total', v_after,
    'free', v_free,
    'paid', v_paid,
    'charge_centavos', greatest(v_paid, 0) * v_price
  );
end $$;
revoke execute on function public.record_drifter_bands(uuid, text, integer, uuid, payment_method) from public, anon, authenticated;

-- The gate tally must not be used for drifter labels: those need a name and the
-- free-allowance split, which only record_drifter_bands does.
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
  if v_type.drifter_family then raise exception 'Record % bands on the Drifters tab', v_type.name; end if;
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
