-- Void an issued ticket (or a whole paid order) after a verification mistake.
-- The wristband number stays attached to the voided ticket and is marked void in
-- the pool, so the printed serial is never handed to someone else. Everything is
-- reversible with unvoid_ticket.

alter type order_status add value if not exists 'voided';

alter table tickets
  add column if not exists void_reason text,
  add column if not exists voided_at   timestamptz,
  add column if not exists voided_by   uuid references staff(id);

create or replace function void_ticket(p_ticket_id uuid, p_actor uuid, p_reason text) returns tickets
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_t tickets%rowtype;
  v_remaining integer;
begin
  select * into v_t from tickets where id = p_ticket_id for update;
  if not found then raise exception 'Ticket not found'; end if;
  if v_t.status = 'void' then raise exception 'Ticket % is already void', v_t.number; end if;
  if v_t.status = 'redeemed' then raise exception 'Ticket % was already scanned at the gate and cannot be voided', v_t.number; end if;

  update tickets set status = 'void', void_reason = p_reason, voided_at = now(), voided_by = p_actor
    where id = p_ticket_id returning * into v_t;
  update ticket_numbers set status = 'void', void_reason = 'Ticket voided: ' || p_reason where id = v_t.ticket_number_id;

  select count(*) into v_remaining from tickets where order_id = v_t.order_id and status <> 'void';
  if v_remaining = 0 then
    update orders set status = 'voided' where id = v_t.order_id and status = 'paid';
  end if;

  insert into audit_log (actor, action, entity, entity_id, data)
    values (p_actor, 'ticket.voided', 'ticket', p_ticket_id::text,
            jsonb_build_object('number', v_t.number, 'reason', p_reason, 'order_id', v_t.order_id, 'order_voided', v_remaining = 0));
  return v_t;
end $$;

create or replace function unvoid_ticket(p_ticket_id uuid, p_actor uuid) returns tickets
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_t tickets%rowtype;
begin
  select * into v_t from tickets where id = p_ticket_id for update;
  if not found then raise exception 'Ticket not found'; end if;
  if v_t.status <> 'void' then raise exception 'Ticket % is %, not void', v_t.number, v_t.status; end if;

  update tickets set status = 'issued', void_reason = null, voided_at = null, voided_by = null
    where id = p_ticket_id returning * into v_t;
  update ticket_numbers set status = 'assigned', void_reason = null where id = v_t.ticket_number_id;
  update orders set status = 'paid' where id = v_t.order_id and status = 'voided';

  insert into audit_log (actor, action, entity, entity_id, data)
    values (p_actor, 'ticket.unvoided', 'ticket', p_ticket_id::text, jsonb_build_object('number', v_t.number, 'order_id', v_t.order_id));
  return v_t;
end $$;

-- Void every unused ticket of a paid order. Tickets already scanned at the gate are skipped.
create or replace function void_order(p_order_id uuid, p_actor uuid, p_reason text) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order orders%rowtype;
  v_id uuid;
  v_n integer := 0;
begin
  select * into v_order from orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.status <> 'paid' then raise exception 'Order is %, only paid orders can be voided', v_order.status; end if;

  for v_id in select id from tickets where order_id = p_order_id and status = 'issued' order by created_at loop
    perform void_ticket(v_id, p_actor, p_reason);
    v_n := v_n + 1;
  end loop;

  insert into audit_log (actor, action, entity, entity_id, data)
    values (p_actor, 'order.voided', 'order', p_order_id::text, jsonb_build_object('order_no', v_order.order_no, 'reason', p_reason, 'tickets', v_n));
  return v_n;
end $$;

revoke execute on function public.void_ticket(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.unvoid_ticket(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.void_order(uuid, uuid, text) from public, anon, authenticated;
