-- Conversion into the new and reopened labels (2026-10-08).
--
-- Converting a paid order used to refuse car labels outright ("needs a plate
-- number and car photo, which this form cannot collect"). VIP Car Display and
-- VIP Car Display (no shirt) are now sold online again, so Admin > Orders >
-- Convert collects what a car ticket needs:
--
--   * each car (p_qty of them) carries its plate (required) and model in
--     p_attendees, plus the names of its free passengers in "passengers";
--   * a label with included_companions issues that many free passenger bands
--     per car from the same stack, on their own PHP 0 order line with
--     companion_of = plate and included = true, exactly like an online order;
--   * p_shipping (new, optional) stores where a shipped shirt goes, for labels
--     whose shirt ships (VIP Pass, VIP Car Display). The app requires it when the
--     order has no address yet.
--
-- The car photo stays optional here: staff convert at the desk, where the car
-- itself is in front of them. Everything else is the live definition unchanged,
-- including the shared-stack locks and number picks from vip_no_shirt_shared_bands.
--
-- The old 7-argument function is dropped and recreated with p_shipping defaulted,
-- so calls made by the previous app version keep working during the deploy.

drop function if exists public.convert_order(uuid, uuid, integer, jsonb, uuid, text, text[]);

create function public.convert_order(
  p_order_id       uuid,
  p_target_type_id uuid,
  p_qty            integer,
  p_attendees      jsonb,
  p_actor          uuid,
  p_reason         text,
  p_tokens         text[],
  p_shipping       jsonb default null
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
begin
  v_reason := nullif(btrim(p_reason), '');
  if v_reason is null or length(v_reason) < 3 then raise exception 'Give a short reason (the buyer will see it)'; end if;
  if p_qty is null or p_qty < 1 or p_qty > 50 then raise exception 'Quantity must be between 1 and 50'; end if;

  select * into v_order from orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.status <> 'paid' then
    raise exception 'Order is %; only a paid order can be converted', v_order.status;
  end if;
  if exists (select 1 from tickets where order_id = p_order_id and status = 'redeemed') then
    raise exception 'A ticket in this order was already scanned at the gate, so it cannot be converted';
  end if;

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
  where t.order_id = p_order_id and t.status = 'issued';

  for v_t in select id, ticket_number_id, ticket_type_id from tickets where order_id = p_order_id and status = 'issued' loop
    perform pg_advisory_xact_lock(hashtext(band_pool_of(v_t.ticket_type_id)::text));
    update ticket_numbers set status = 'available', void_reason = null where id = v_t.ticket_number_id;
    update tickets
       set status = 'void', ticket_number_id = null,
           void_reason = 'Converted to ' || v_type.name || ': ' || v_reason,
           voided_at = now(), voided_by = p_actor
     where id = v_t.id;
  end loop;

  v_old_total := v_order.total_centavos;
  delete from order_items where order_id = p_order_id;

  select * into v_avail from v_ticket_type_availability where ticket_type_id = p_target_type_id;
  if v_avail.sellable < p_qty then
    raise exception 'Only % % wristband(s) are left', greatest(v_avail.sellable, 0), v_type.name;
  end if;
  if v_avail.pool_sellable < v_bands then
    raise exception 'Only % wristband(s) are left for % with its passengers', greatest(v_avail.pool_sellable, 0), v_type.name;
  end if;

  v_new_total := p_qty * v_type.price_centavos;
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
         balance_centavos   = balance_centavos + (v_old_total - v_new_total),
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
            'to_type', v_type.name,
            'to_qty', p_qty,
            'passengers', p_qty * v_inc,
            'old_total_centavos', v_old_total,
            'new_total_centavos', v_new_total,
            'balance_centavos', v_old_total - v_new_total));

  return jsonb_build_object(
    'order_no', v_order.order_no,
    'type', v_type.name,
    'qty', p_qty,
    'passengers', p_qty * v_inc,
    'old_total_centavos', v_old_total,
    'new_total_centavos', v_new_total,
    'balance_centavos', (select balance_centavos from orders where id = p_order_id));
end $$;

revoke execute on function public.convert_order(uuid, uuid, integer, jsonb, uuid, text, text[], jsonb) from public, anon, authenticated;
