-- Convert a paid order to a different ticket type (2026-09-22).
--
-- Buyers change their mind after paying: order #49 paid PHP1,850 for a VIP Car
-- Display and then asked to be an Early Bird instead. Voiding and asking them to
-- order again loses the order number, the receipt and the payment trail, so this
-- swaps the contents in place: the same order keeps its number and receipt, the
-- old wristbands go back to the pool, new ones are issued, and the difference in
-- price is remembered as a balance the organizer still owes (or still collects).
--
-- Unlike an ordinary void - which retires the printed serial so a handed-out band
-- can never be reused - a conversion happens before anything is handed over, so
-- the band returns to stock. The old ticket row keeps its printed `number` for
-- history but lets go of the band, which is why ticket_number_id becomes nullable.
-- Such a ticket can never be un-voided: its band belongs to someone else now.

alter table tickets alter column ticket_number_id drop not null;
comment on column tickets.ticket_number_id is
  'The band held by this ticket. NULL only on a ticket converted to another type: the band went back to the pool and `number` is kept for history.';

alter table orders
  -- what is still owed after a conversion: positive = refund due to the buyer,
  -- negative = the buyer still has to pay the difference. Settled by hand.
  add column if not exists balance_centavos   integer not null default 0,
  add column if not exists balance_settled_at timestamptz,
  add column if not exists balance_note       text;

-- ------------------------------------------------------------------ guard
-- A converted ticket has no band to take back, so restoring it would create a
-- valid ticket with a serial someone else is now wearing.
create or replace function unvoid_ticket(p_ticket_id uuid, p_actor uuid) returns tickets
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_t tickets%rowtype;
begin
  select * into v_t from tickets where id = p_ticket_id for update;
  if not found then raise exception 'Ticket not found'; end if;
  if v_t.status <> 'void' then raise exception 'Ticket % is %, not void', v_t.number, v_t.status; end if;
  if v_t.ticket_number_id is null then
    raise exception 'Ticket % was converted to another ticket type and cannot be restored; convert the order again instead', v_t.number;
  end if;

  update tickets set status = 'issued', void_reason = null, voided_at = null, voided_by = null
    where id = p_ticket_id returning * into v_t;
  update ticket_numbers set status = 'assigned', void_reason = null where id = v_t.ticket_number_id;
  update orders set status = 'paid' where id = v_t.order_id and status = 'voided';

  insert into audit_log (actor, action, entity, entity_id, data)
    values (p_actor, 'ticket.unvoided', 'ticket', p_ticket_id::text, jsonb_build_object('number', v_t.number, 'order_id', v_t.order_id));
  return v_t;
end $$;
revoke execute on function public.unvoid_ticket(uuid, uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------ convert
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
  if v_type.drifter_family then
    raise exception '% is handed out on the Drifters tab, it is not sold in orders', v_type.name;
  end if;
  if not v_type.sell_online then
    raise exception '% (%) is a gate label with no online price; it is counted on the Walk-in tab instead', v_type.name, v_type.band_color;
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

-- ------------------------------------------------------------------ settle
-- The refund (or the extra payment) happens in GoTyme, outside this system; this
-- only records that someone has done it, so the open-balance list stays true.
create or replace function settle_order_balance(p_order_id uuid, p_actor uuid, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order orders%rowtype;
begin
  select * into v_order from orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.balance_centavos = 0 then raise exception 'Order #% has no open balance', v_order.order_no; end if;
  if v_order.balance_settled_at is not null then raise exception 'Order #% was already settled', v_order.order_no; end if;

  update orders set balance_settled_at = now(), balance_note = nullif(btrim(p_note), '') where id = p_order_id;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (p_actor, 'order.balance_settled', 'order', p_order_id::text,
          jsonb_build_object('order_no', v_order.order_no, 'balance_centavos', v_order.balance_centavos, 'note', nullif(btrim(p_note), '')));
end $$;
revoke execute on function public.settle_order_balance(uuid, uuid, text) from public, anon, authenticated;
