-- VIP Car Display companions: a VIP Standing ticket bought from inside a car
-- ticket stays linked to that car by plate number, so the gate can seat the
-- passenger with the right car. Attendee JSON key: companion_of.
alter table tickets add column if not exists companion_of text;
comment on column tickets.companion_of is 'Plate number of the VIP Car Display car this ticket rides with (companion tickets only).';

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
                           holder_name, shirt_size, vehicle_plate, vehicle_model, vehicle_photo_path, companion_of)
      values (p_order_id, v_item.ticket_type_id, v_num.id, v_num.number, p_tokens[v_tok],
              coalesce(v_att->>'holder_name', v_order.buyer_name),
              v_att->>'shirt_size', v_att->>'vehicle_plate', v_att->>'vehicle_model', v_att->>'vehicle_photo_path',
              nullif(v_att->>'companion_of', ''))
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
