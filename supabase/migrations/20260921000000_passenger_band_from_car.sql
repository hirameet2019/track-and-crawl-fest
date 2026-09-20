-- Organizer decision (2026-09-21): the free passenger that comes with a VIP Car Display
-- ticket now wears a RED VIP Car Display wristband, taken from the car pool, instead of a
-- green VIP Pass band. Paid extra companions (PHP 950, with shirt) stay VIP Pass.
--
-- Only the allowance maths changes here: the free-companion line is itself a VIP Car
-- Display line, so it must not grant a further allowance of its own. Allowance is counted
-- from DIRECT (non-companion) attendees only.

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
  v_direct integer;
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

  -- Free passenger allowance comes from the cars actually bought, never from the
  -- zero-priced passenger line itself.
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_type from ticket_types where id = (v_item->>'ticket_type_id')::uuid and active;
    if not found then raise exception 'Unknown or inactive ticket type'; end if;
    v_direct := case
      when jsonb_typeof(v_item->'attendees') = 'array' and jsonb_array_length(v_item->'attendees') > 0
      then (select count(*) from jsonb_array_elements(v_item->'attendees') a where coalesce(a->>'companion_of','') = '')
      else (v_item->>'qty')::int end;
    v_allowance := v_allowance + v_type.included_companions * v_direct;
  end loop;

  -- Price each item and count the free passengers claimed.
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
    raise exception 'Only % included passenger wristband(s) come with this order', v_allowance;
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

update ticket_types set
  description = 'VIP car display parking, plus a wristband for 1 passenger at no extra cost. Dedicated VIP entrance, VIP viewing tent, 2 VIP lanyards, 2 event decals, 1 event t-shirt for the driver, and a drift demo raffle entry. Limited to 40 cars. Car photo, plate number and model required.'
where code = 'R';
