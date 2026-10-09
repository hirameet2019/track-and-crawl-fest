-- Partial convert (2026-10-09). Admin > Orders > Convert used to swap every live
-- ticket of an order. The organizer asked for the case where only one or two of a
-- group's tickets change (one VIP Pass of three becomes VIP Pass (no shirt), say).
--
-- convert_order takes p_ticket_ids: the tickets to change. Left null it is the
-- whole order, exactly as before (calls from the previous app version keep working).
--
--   * Only the picked tickets are voided and their bands go back to the stack; the
--     rest keep their wristband number and QR code.
--   * A car takes its free passengers with it; a free passenger cannot be picked
--     without its car.
--   * The picked tickets' labels get their order lines rebuilt from the tickets that
--     stay (kept ones, and plainly voided ones, which keep their number and stay on
--     their line), each at the price of the line it came from. Other labels' lines
--     are not touched. Checked on the live data first: for every paid order and
--     label the lines hold exactly the tickets that still have a wristband number,
--     and pricing each ticket from its line reproduces the line amounts.
--   * The balance moves by what the picked tickets were worth minus the new
--     tickets: one VIP Pass (P950) to one VIP Pass (no shirt) (P500) is P450 to refund.
--   * Picked tickets may sit next to tickets already scanned at the gate; only a
--     whole-order convert still refuses an order with a scanned ticket.
--
-- The void deductions (v_order_void_deductions and the online revenue in
-- v_ticket_type_availability) now skip converted tickets (void with no wristband
-- number). They used to reach them only when the order kept a line of that label,
-- which a whole-order convert never left; a partial one does. No converted ticket
-- was being deducted before this migration, so today's figures do not move.

drop function if exists public.convert_order(uuid, uuid, integer, jsonb, uuid, text, text[], jsonb);

create function public.convert_order(
  p_order_id       uuid,
  p_target_type_id uuid,
  p_qty            integer,
  p_attendees      jsonb,
  p_actor          uuid,
  p_reason         text,
  p_tokens         text[],
  p_shipping       jsonb default null,
  p_ticket_ids     uuid[] default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order     orders%rowtype;
  v_type      ticket_types%rowtype;
  v_avail     record;
  v_t         record;
  v_num       ticket_numbers%rowtype;
  v_old       jsonb;
  v_old_total integer;
  v_new_total integer;
  v_reason    text;
  v_att       jsonb;
  v_i         integer;
  v_k         integer;
  v_inc       integer;
  v_bands     integer;
  v_tok       integer := 1;
  v_plate     text;
  v_cars      jsonb := '[]'::jsonb;
  v_riders    jsonb := '[]'::jsonb;
  v_line      record;
  v_pick      uuid[];
  v_out       integer;
  v_add       integer;
  v_kept      integer;
  v_rebuild   jsonb;
begin
  v_reason := nullif(btrim(p_reason), '');
  if v_reason is null or length(v_reason) < 3 then raise exception 'Give a short reason (the buyer will see it)'; end if;
  if p_qty is null or p_qty < 1 or p_qty > 50 then raise exception 'Quantity must be between 1 and 50'; end if;

  select * into v_order from orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.status <> 'paid' then
    raise exception 'Order is %; only a paid order can be converted', v_order.status;
  end if;

  -- The tickets that change: the ones picked, or every live ticket (the whole order).
  if p_ticket_ids is null then
    if exists (select 1 from tickets where order_id = p_order_id and status = 'redeemed') then
      raise exception 'A ticket in this order was already scanned at the gate, so it cannot be converted';
    end if;
    select array_agg(id) into v_pick from tickets where order_id = p_order_id and status = 'issued';
  else
    select array_agg(distinct x) into v_pick from unnest(p_ticket_ids) x;
    if exists (select 1 from unnest(v_pick) x
                where not exists (select 1 from tickets t where t.id = x and t.order_id = p_order_id and t.status = 'issued')) then
      raise exception 'Pick only live tickets of this order: one was already scanned at the gate, voided or converted';
    end if;
    -- A car takes its free passengers along ...
    select v_pick || coalesce(array_agg(distinct p.id), '{}'::uuid[]) into v_pick
      from tickets c
      join tickets p on p.order_id = c.order_id and p.ticket_type_id = c.ticket_type_id and p.included and p.status = 'issued'
                    and regexp_replace(upper(coalesce(p.companion_of, '')), '[^A-Z0-9]', '', 'g') = regexp_replace(upper(c.vehicle_plate), '[^A-Z0-9]', '', 'g')
     where c.id = any(v_pick) and not c.included and c.vehicle_plate is not null and not (p.id = any(v_pick));
    -- ... and a free passenger never moves without its car.
    if exists (select 1 from tickets p
                where p.id = any(v_pick) and p.included
                  and not exists (select 1 from tickets c
                                   where c.id = any(v_pick) and not c.included and c.vehicle_plate is not null
                                     and regexp_replace(upper(c.vehicle_plate), '[^A-Z0-9]', '', 'g') = regexp_replace(upper(coalesce(p.companion_of, '')), '[^A-Z0-9]', '', 'g'))) then
      raise exception 'A free passenger moves with its car: pick the car''s ticket instead';
    end if;
  end if;
  if coalesce(cardinality(v_pick), 0) = 0 then raise exception 'This order has no live ticket to convert'; end if;

  select * into v_type from ticket_types where id = p_target_type_id and active;
  if not found then raise exception 'Unknown or inactive ticket type'; end if;
  if v_type.event_id <> v_order.event_id then raise exception 'That ticket type belongs to a different event'; end if;
  if v_type.price_centavos <= 0 then
    raise exception '% (%) has no ticket price - it is sold by tally on the Walk-in tab, so it cannot sit on an order', v_type.name, v_type.band_color;
  end if;

  -- One ticket per unit, plus the free passengers that ride in each car.
  v_inc   := case when v_type.requires_vehicle then greatest(coalesce(v_type.included_companions, 0), 0) else 0 end;
  v_bands := p_qty * (1 + v_inc);
  if p_tokens is null or coalesce(array_length(p_tokens, 1), 0) < v_bands then raise exception 'Not enough QR tokens supplied'; end if;

  -- Build the ticket lines the way an online order stores them.
  for v_i in 1..p_qty loop
    v_att := coalesce(p_attendees -> (v_i - 1), '{}'::jsonb);
    if v_type.requires_vehicle then
      v_plate := upper(regexp_replace(btrim(coalesce(v_att->>'vehicle_plate', '')), '\s+', ' ', 'g'));
      if v_plate = '' then raise exception 'Enter the plate number of car %', v_i; end if;
      if exists (select 1 from jsonb_array_elements(v_cars) c where replace(c->>'vehicle_plate', ' ', '') = replace(v_plate, ' ', '')) then
        raise exception 'Plate % is entered twice', v_plate;
      end if;
      v_cars := v_cars || jsonb_strip_nulls(jsonb_build_object(
        'holder_name', nullif(btrim(v_att->>'holder_name'), ''),
        'shirt_size', case when v_type.includes_shirt then nullif(btrim(v_att->>'shirt_size'), '') end,
        'vehicle_plate', v_plate,
        'vehicle_model', nullif(btrim(v_att->>'vehicle_model'), '')));
      for v_k in 1..v_inc loop
        v_riders := v_riders || jsonb_strip_nulls(jsonb_build_object(
          'holder_name', nullif(btrim(v_att->'passengers'->>(v_k - 1)), ''),
          'companion_of', v_plate,
          'included', true));
      end loop;
    else
      v_cars := v_cars || jsonb_strip_nulls(jsonb_build_object(
        'holder_name', nullif(btrim(v_att->>'holder_name'), ''),
        'shirt_size', nullif(btrim(v_att->>'shirt_size'), '')));
    end if;
  end loop;

  perform pg_advisory_xact_lock(hashtext(band_pool_of(p_target_type_id)::text));

  select jsonb_agg(jsonb_build_object('number', t.number, 'type', tt.name, 'holder', t.holder_name) order by t.number)
    into v_old
  from tickets t join ticket_types tt on tt.id = t.ticket_type_id
  where t.id = any(v_pick);

  -- What the picked tickets were worth, each at the price of the line it came from.
  select coalesce(sum(line.p), 0) into v_out
    from tickets t
    join lateral (select oi.unit_price_centavos as p from order_items oi
                   where oi.order_id = t.order_id and oi.ticket_type_id = t.ticket_type_id
                   order by ((oi.unit_price_centavos = 0) <> t.included), oi.unit_price_centavos desc, oi.id
                   limit 1) line on true
   where t.id = any(v_pick);

  -- The picked tickets' labels, rebuilt from the tickets that stay on them.
  select coalesce(jsonb_agg(jsonb_build_object('type', g.tt, 'price', g.p, 'attendees', g.atts)), '[]'::jsonb) into v_rebuild
    from (select t.ticket_type_id as tt, line.p,
                 jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                   'holder_name', t.holder_name, 'shirt_size', t.shirt_size,
                   'vehicle_plate', t.vehicle_plate, 'vehicle_model', t.vehicle_model, 'vehicle_photo_path', t.vehicle_photo_path,
                   'companion_of', t.companion_of, 'included', case when t.included then true end))
                   order by t.created_at, t.number) as atts
            from tickets t
            join lateral (select oi.unit_price_centavos as p from order_items oi
                           where oi.order_id = t.order_id and oi.ticket_type_id = t.ticket_type_id
                           order by ((oi.unit_price_centavos = 0) <> t.included), oi.unit_price_centavos desc, oi.id
                           limit 1) line on true
           where t.order_id = p_order_id and t.ticket_number_id is not null and not (t.id = any(v_pick))
             and t.ticket_type_id in (select ticket_type_id from tickets where id = any(v_pick))
           group by t.ticket_type_id, line.p) g;

  select count(*) into v_kept from tickets
   where order_id = p_order_id and status in ('issued', 'redeemed') and not (id = any(v_pick));

  for v_t in select id, ticket_number_id, ticket_type_id from tickets where id = any(v_pick) loop
    perform pg_advisory_xact_lock(hashtext(band_pool_of(v_t.ticket_type_id)::text));
    update ticket_numbers set status = 'available', void_reason = null where id = v_t.ticket_number_id;
    update tickets
       set status = 'void', ticket_number_id = null,
           void_reason = 'Converted to ' || v_type.name || ': ' || v_reason,
           voided_at = now(), voided_by = p_actor
     where id = v_t.id;
  end loop;

  v_old_total := v_order.total_centavos;
  delete from order_items
   where order_id = p_order_id
     and ticket_type_id in (select ticket_type_id from tickets where id = any(v_pick));
  insert into order_items (order_id, ticket_type_id, qty, unit_price_centavos, attendees)
  select p_order_id, (r->>'type')::uuid, jsonb_array_length(r->'attendees'), (r->>'price')::integer, r->'attendees'
    from jsonb_array_elements(v_rebuild) r;

  select * into v_avail from v_ticket_type_availability where ticket_type_id = p_target_type_id;
  if v_avail.sellable < p_qty then
    raise exception 'Only % % wristband(s) are left', greatest(v_avail.sellable, 0), v_type.name;
  end if;
  if v_avail.pool_sellable < v_bands then
    raise exception 'Only % wristband(s) are left for % with its passengers', greatest(v_avail.pool_sellable, 0), v_type.name;
  end if;

  v_add := p_qty * v_type.price_centavos;
  v_new_total := v_old_total - v_out + v_add;
  insert into order_items (order_id, ticket_type_id, qty, unit_price_centavos, attendees)
  values (p_order_id, p_target_type_id, p_qty, v_type.price_centavos, v_cars);
  if v_inc > 0 then
    insert into order_items (order_id, ticket_type_id, qty, unit_price_centavos, attendees)
    values (p_order_id, p_target_type_id, p_qty * v_inc, 0, v_riders);
  end if;

  -- Cars (or plain tickets) first, then the free passengers, so QR tokens and
  -- band numbers follow the order the lines were written in.
  for v_line in select attendees, n from (values (1, v_cars, p_qty), (2, v_riders, p_qty * v_inc)) as l(ord, attendees, n) where n > 0 order by ord loop
    for v_i in 1..v_line.n loop
      select * into v_num from ticket_numbers
        where ticket_type_id = band_pool_of(p_target_type_id) and status = 'available'
        order by seq for update skip locked limit 1;
      if not found then raise exception 'No wristband numbers left for %', v_type.name; end if;

      v_att := coalesce(v_line.attendees -> (v_i - 1), '{}'::jsonb);
      insert into tickets (order_id, ticket_type_id, ticket_number_id, number, qr_token,
                           holder_name, shirt_size, vehicle_plate, vehicle_model, companion_of, included)
      values (p_order_id, p_target_type_id, v_num.id, v_num.number, p_tokens[v_tok],
              coalesce(v_att->>'holder_name', v_order.buyer_name),
              v_att->>'shirt_size', v_att->>'vehicle_plate', v_att->>'vehicle_model',
              nullif(v_att->>'companion_of', ''),
              coalesce((v_att->>'included')::boolean, false));
      update ticket_numbers set status = 'assigned' where id = v_num.id;
      v_tok := v_tok + 1;
    end loop;
  end loop;

  update orders
     set total_centavos     = v_new_total,
         balance_centavos   = balance_centavos + (v_out - v_add),
         balance_settled_at = null,
         balance_note       = null,
         shipping           = coalesce(p_shipping, shipping)
   where id = p_order_id;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (p_actor, 'order.converted', 'order', p_order_id::text,
          jsonb_build_object(
            'order_no', v_order.order_no,
            'reason', v_reason,
            'from', coalesce(v_old, '[]'::jsonb),
            'kept', v_kept,
            'to_type', v_type.name,
            'to_qty', p_qty,
            'passengers', p_qty * v_inc,
            'old_total_centavos', v_old_total,
            'new_total_centavos', v_new_total,
            'balance_centavos', v_out - v_add));

  return jsonb_build_object(
    'order_no', v_order.order_no,
    'type', v_type.name,
    'qty', p_qty,
    'passengers', p_qty * v_inc,
    'from', coalesce(v_old, '[]'::jsonb),
    'kept', v_kept,
    'old_total_centavos', v_old_total,
    'new_total_centavos', v_new_total,
    'balance_centavos', (select balance_centavos from orders where id = p_order_id));
end $$;

revoke execute on function public.convert_order(uuid, uuid, integer, jsonb, uuid, text, text[], jsonb, uuid[]) from public, anon, authenticated;

-- Void deductions skip converted tickets (see the note at the top).
create or replace view v_order_void_deductions as
select
  t.order_id,
  count(*)::integer                              as void_tickets,
  coalesce(sum(line.unit_price_centavos), 0)::bigint as void_centavos
from tickets t
join lateral (
  select oi.unit_price_centavos
  from order_items oi
  where oi.order_id = t.order_id and oi.ticket_type_id = t.ticket_type_id
  -- the line whose free/priced kind matches the ticket first; the rest only break ties
  order by ((oi.unit_price_centavos = 0) <> t.included), oi.unit_price_centavos desc, oi.id
  limit 1
) line on true
where t.status = 'void'
  and t.ticket_number_id is not null  -- a converted ticket left the order with its band
group by t.order_id;

alter view public.v_order_void_deductions set (security_invoker = on);
revoke select on public.v_order_void_deductions from anon;

-- Online revenue nets voided tickets the same way.
create or replace view v_ticket_type_availability with (security_invoker = on) as
 SELECT tt.id AS ticket_type_id,
    tt.event_id,
    tt.code,
    tt.name,
    tt.price_centavos,
    tt.walkin_price_centavos,
    tt.band_color,
    tt.sort_order,
    tt.active,
    tt.sell_online,
    p.pool_total,
    p.pool_available,
    p.voided,
    p.assigned AS online_sold,
    w.walkin_sold,
    p.assigned + w.walkin_sold AS sold,
    r.reserved,
        CASE
            WHEN tt.online_cap IS NULL THEN p.pool_available - sr.reserved - sw.walkin_sold
            ELSE LEAST(p.pool_available - sr.reserved - sw.walkin_sold, tt.online_cap - c.cap_used)
        END AS sellable,
    o.online_revenue_centavos,
    w.walkin_revenue_centavos,
    o.online_revenue_centavos + w.walkin_revenue_centavos AS revenue_centavos,
    ( SELECT count(*) AS count
           FROM tickets t
          WHERE t.ticket_type_id = tt.id AND t.status = 'redeemed'::ticket_status) AS redeemed,
    tt.online_cap,
    c.cap_used,
    p.pool_available - sr.reserved - sw.walkin_sold AS pool_sellable,
    tt.drifter_family,
    tt.free_allowance,
    w.free_bands,
    tt.pool_type_id
   FROM ticket_types tt
     CROSS JOIN LATERAL ( SELECT count(*) AS pool_total,
            count(*) FILTER (WHERE n.status = 'available'::number_status) AS pool_available,
            count(*) FILTER (WHERE n.status = 'assigned'::number_status AND COALESCE(t.ticket_type_id, n.ticket_type_id) = tt.id) AS assigned,
            count(*) FILTER (WHERE n.status = 'void'::number_status AND COALESCE(t.ticket_type_id, n.ticket_type_id) = tt.id) AS voided
           FROM ticket_numbers n
             LEFT JOIN tickets t ON t.ticket_number_id = n.id
          WHERE n.ticket_type_id = COALESCE(tt.pool_type_id, tt.id)) p
     CROSS JOIN LATERAL ( SELECT COALESCE(sum(oi.qty), 0::bigint) AS reserved
           FROM order_items oi
             JOIN orders o_1 ON o_1.id = oi.order_id
          WHERE oi.ticket_type_id = tt.id AND (o_1.status = ANY (ARRAY['pending_payment'::order_status, 'awaiting_verification'::order_status]))) r
     CROSS JOIN LATERAL ( SELECT COALESCE(sum(oi.qty), 0::bigint) AS reserved
           FROM order_items oi
             JOIN orders o_1 ON o_1.id = oi.order_id
             JOIN ticket_types st ON st.id = oi.ticket_type_id
          WHERE COALESCE(st.pool_type_id, st.id) = COALESCE(tt.pool_type_id, tt.id)
            AND (o_1.status = ANY (ARRAY['pending_payment'::order_status, 'awaiting_verification'::order_status]))) sr
     CROSS JOIN LATERAL ( SELECT (COALESCE(sum(
                CASE
                    WHEN jsonb_typeof(oi.attendees) = 'array'::text AND jsonb_array_length(oi.attendees) > 0 THEN ( SELECT count(*) AS count
                       FROM jsonb_array_elements(oi.attendees) a(value)
                      WHERE COALESCE(a.value ->> 'companion_of'::text, ''::text) = ''::text)
                    ELSE oi.qty::bigint
                END), 0::numeric)
              + COALESCE(( SELECT sum(ws.qty - ws.free_qty)
                   FROM walkin_sales ws
                  WHERE ws.ticket_type_id = tt.id), 0::bigint))::bigint AS cap_used
           FROM order_items oi
             JOIN orders o_1 ON o_1.id = oi.order_id
          WHERE oi.ticket_type_id = tt.id AND (o_1.status = ANY (ARRAY['pending_payment'::order_status, 'awaiting_verification'::order_status, 'paid'::order_status]))) c
     CROSS JOIN LATERAL ( SELECT COALESCE(sum(oi.qty * oi.unit_price_centavos), 0::bigint) - COALESCE(( SELECT sum(line.unit_price_centavos) AS sum
                   FROM tickets t
                     JOIN orders o2 ON o2.id = t.order_id
                     JOIN LATERAL ( SELECT oi2.unit_price_centavos
                           FROM order_items oi2
                          WHERE oi2.order_id = t.order_id AND oi2.ticket_type_id = t.ticket_type_id
                          ORDER BY ((oi2.unit_price_centavos = 0) <> t.included), oi2.unit_price_centavos DESC, oi2.id
                         LIMIT 1) line ON true
                  WHERE t.ticket_type_id = tt.id AND t.status = 'void'::ticket_status AND t.ticket_number_id IS NOT NULL AND o2.status = 'paid'::order_status), 0::bigint) AS online_revenue_centavos
           FROM order_items oi
             JOIN orders o_1 ON o_1.id = oi.order_id
          WHERE oi.ticket_type_id = tt.id AND o_1.status = 'paid'::order_status) o
     CROSS JOIN LATERAL ( SELECT COALESCE(sum(ws.qty), 0::bigint) AS walkin_sold,
            COALESCE(sum(ws.free_qty), 0::bigint) AS free_bands,
            COALESCE(sum((ws.qty - ws.free_qty) * ws.unit_price_centavos), 0::bigint) AS walkin_revenue_centavos
           FROM walkin_sales ws
          WHERE ws.ticket_type_id = tt.id) w
     CROSS JOIN LATERAL ( SELECT COALESCE(sum(ws.qty), 0::bigint) AS walkin_sold
           FROM walkin_sales ws
             JOIN ticket_types st ON st.id = ws.ticket_type_id
          WHERE COALESCE(st.pool_type_id, st.id) = COALESCE(tt.pool_type_id, tt.id)) sw;
