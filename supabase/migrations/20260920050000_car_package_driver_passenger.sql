-- Organizer clarification (2026-09-20): the "2 VIP Pass" in the VIP Car Display
-- package are one for the DRIVER (covered by the car ticket itself) and one for
-- the PASSENGER. So one included companion per car, without a shirt: the package
-- has 1 event t-shirt, for the driver. Wristbands: 200 VIP Pass + 40 passengers = 240 of 300 green.

update ticket_types set
  included_companions = 1,
  description = 'VIP car display parking, VIP Pass access for the driver and 1 VIP Pass for your passenger, included. Dedicated VIP entrance, VIP viewing tent, 2 VIP lanyards, 2 event decals, 1 event t-shirt for the driver, and a drift demo raffle entry. Limited to 40 cars. Car photo, plate number and model required.'
where code = 'R';

-- Included passengers are marked on the ticket so the gate kit and PDF skip the shirt.
alter table tickets add column if not exists included boolean not null default false;
comment on column tickets.included is 'VIP Pass bundled free with a VIP Car Display ticket (no shirt in the kit).';

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
                           holder_name, shirt_size, vehicle_plate, vehicle_model, vehicle_photo_path, companion_of, included)
      values (p_order_id, v_item.ticket_type_id, v_num.id, v_num.number, p_tokens[v_tok],
              coalesce(v_att->>'holder_name', v_order.buyer_name),
              v_att->>'shirt_size', v_att->>'vehicle_plate', v_att->>'vehicle_model', v_att->>'vehicle_photo_path',
              nullif(v_att->>'companion_of', ''),
              coalesce((v_att->>'included')::boolean, false))
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
