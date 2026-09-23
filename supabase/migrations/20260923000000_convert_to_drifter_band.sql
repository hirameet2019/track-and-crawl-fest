-- Let a paid order be converted into a Drifter Family band (2026-09-23).
--
-- The organizer asked for Drifter Family in the "Change to another ticket" list:
-- a drifter's relative who bought an ordinary ticket online should be able to get
-- the plain red band instead, without cancelling and re-ordering.
--
-- The old guard refused the label twice - once for `drifter_family`, once for
-- `sell_online = false`. Only the second test ever mattered, and for the wrong
-- reason: what actually breaks an order line is a label with NO PRICE (the gate
-- labels Y and O are priced per tally, so `price_centavos` is 0 and the order
-- total would silently collapse to zero). Drifter Family is priced at P150, so
-- it converts cleanly. The test is now the price itself.
--
-- Note on the free allowance: bands issued this way are paid for through the
-- order and do NOT count against that drifter's four free bands on the Drifters
-- tab, which only tracks hand-outs recorded there.

create or replace function convert_order(
  p_order_id       uuid,
  p_target_type_id uuid,
  p_qty            integer,
  p_attendees      jsonb,
  p_actor          uuid,
  p_reason         text,
  p_tokens         text[]
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
begin
  v_reason := nullif(btrim(p_reason), '');
  if v_reason is null or length(v_reason) < 3 then raise exception 'Give a short reason (the buyer will see it)'; end if;
  if p_qty is null or p_qty < 1 or p_qty > 50 then raise exception 'Quantity must be between 1 and 50'; end if;
  if p_tokens is null or coalesce(array_length(p_tokens, 1), 0) < p_qty then raise exception 'Not enough QR tokens supplied'; end if;

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
  if v_type.requires_vehicle then
    raise exception 'Converting into % needs a plate number and car photo, which this form cannot collect; ask the buyer to place a new order', v_type.name;
  end if;
  if v_type.price_centavos <= 0 then
    raise exception '% (%) has no ticket price - it is sold by tally on the Walk-in tab, so it cannot sit on an order', v_type.name, v_type.band_color;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_target_type_id::text));

  select jsonb_agg(jsonb_build_object('number', t.number, 'type', tt.name, 'holder', t.holder_name) order by t.number)
    into v_old
  from tickets t join ticket_types tt on tt.id = t.ticket_type_id
  where t.order_id = p_order_id and t.status = 'issued';

  -- Hand every unused band back to the pool. The ticket row stays, void, so the old
  -- QR still scans and tells the marshal what happened.
  for v_t in select id, ticket_number_id, ticket_type_id from tickets where order_id = p_order_id and status = 'issued' loop
    perform pg_advisory_xact_lock(hashtext(v_t.ticket_type_id::text));
    update ticket_numbers set status = 'available', void_reason = null where id = v_t.ticket_number_id;
    update tickets
       set status = 'void', ticket_number_id = null,
           void_reason = 'Converted to ' || v_type.name || ': ' || v_reason,
           voided_at = now(), voided_by = p_actor
     where id = v_t.id;
  end loop;

  v_old_total := v_order.total_centavos;
  delete from order_items where order_id = p_order_id;

  -- Checked only now: the released bands are back in stock and this order no
  -- longer counts against the target type's cap, so a same-type swap still fits.
  select * into v_avail from v_ticket_type_availability where ticket_type_id = p_target_type_id;
  if v_avail.sellable < p_qty then
    raise exception 'Only % % wristband(s) are left', greatest(v_avail.sellable, 0), v_type.name;
  end if;

  v_new_total := p_qty * v_type.price_centavos;
  insert into order_items (order_id, ticket_type_id, qty, unit_price_centavos, attendees)
  values (p_order_id, p_target_type_id, p_qty, v_type.price_centavos, coalesce(p_attendees, '[]'::jsonb));

  for v_i in 1..p_qty loop
    select * into v_num from ticket_numbers
      where ticket_type_id = p_target_type_id and status = 'available'
      order by seq for update skip locked limit 1;
    if not found then raise exception 'No wristband numbers left for %', v_type.name; end if;

    v_att := coalesce(p_attendees -> (v_i - 1), '{}'::jsonb);
    insert into tickets (order_id, ticket_type_id, ticket_number_id, number, qr_token, holder_name, shirt_size)
    values (p_order_id, p_target_type_id, v_num.id, v_num.number, p_tokens[v_i],
            coalesce(nullif(btrim(v_att->>'holder_name'), ''), v_order.buyer_name),
            nullif(btrim(v_att->>'shirt_size'), ''));
    update ticket_numbers set status = 'assigned' where id = v_num.id;
  end loop;

  update orders
     set total_centavos     = v_new_total,
         balance_centavos   = balance_centavos + (v_old_total - v_new_total),
         balance_settled_at = null,
         balance_note       = null
   where id = p_order_id;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (p_actor, 'order.converted', 'order', p_order_id::text,
          jsonb_build_object(
            'order_no', v_order.order_no,
            'reason', v_reason,
            'from', coalesce(v_old, '[]'::jsonb),
            'to_type', v_type.name,
            'to_qty', p_qty,
            'old_total_centavos', v_old_total,
            'new_total_centavos', v_new_total,
            'balance_centavos', v_old_total - v_new_total));

  return jsonb_build_object(
    'order_no', v_order.order_no,
    'type', v_type.name,
    'qty', p_qty,
    'old_total_centavos', v_old_total,
    'new_total_centavos', v_new_total,
    'balance_centavos', (select balance_centavos from orders where id = p_order_id));
end $$;
revoke execute on function public.convert_order(uuid, uuid, integer, jsonb, uuid, text, text[]) from public, anon, authenticated;
