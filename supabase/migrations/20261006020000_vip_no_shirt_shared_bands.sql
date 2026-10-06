-- New online selections (2026-10-06):
--   * VIP Pass (no shirt), P500, code GN. Same green wristband as the VIP Pass:
--     it takes the next free G band, first come first served with the VIP Pass
--     with shirt. Online only.
--   * VIP Car Display (no shirt), P850 (C) is now sold online too, no limit and
--     no closing date, on the same C0001-C9999 numbers as the gate.
--   * VIP Car Display with shirt (R) reopens online with no closing date (its
--     shirt ships, 20261006010000).
--
-- Shared wristband stacks: ticket_types.pool_type_id points a label at another
-- label's numbers. Everything that takes a number or checks stock goes through
-- band_pool_of(), and the availability view counts reservations and gate sales
-- across the whole stack. A label without pool_type_id is its own stack, so the
-- existing labels behave exactly as before.

alter table ticket_types add column if not exists pool_type_id uuid references ticket_types(id);
comment on column ticket_types.pool_type_id is
  'Takes wristband numbers (and stock) from this ticket type''s stack instead of its own. One level only.';

/** The ticket type whose wristband numbers a label uses. */
create or replace function band_pool_of(p_type uuid) returns uuid
language sql stable
set search_path = public, pg_temp
as $$ select coalesce((select pool_type_id from ticket_types where id = p_type), p_type) $$;
revoke execute on function band_pool_of(uuid) from public, anon, authenticated;

-- One level: the lender keeps its own stack, is in the same event, and nobody lends to a borrower.
create or replace function ticket_types_pool_check() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.pool_type_id is null then return new; end if;
  if new.pool_type_id = new.id then raise exception 'A ticket type cannot share wristbands with itself'; end if;
  if not exists (select 1 from ticket_types o where o.id = new.pool_type_id and o.event_id = new.event_id and o.pool_type_id is null) then
    raise exception 'Shared wristbands must come from a ticket type of the same event that keeps its own stack';
  end if;
  if exists (select 1 from ticket_types s where s.pool_type_id = new.id) then
    raise exception '% already lends its wristbands to another ticket type', new.name;
  end if;
  return new;
end $$;
revoke execute on function ticket_types_pool_check() from public, anon, authenticated;
drop trigger if exists ticket_types_pool_check on ticket_types;
create trigger ticket_types_pool_check before insert or update of pool_type_id on ticket_types
  for each row execute function ticket_types_pool_check();

-- Point the stock locks and number picks at the stack. The live definitions are
-- patched in place (each fragment must occur exactly once) so nothing else in
-- these functions changes.
create or replace function pg_temp.patch_fn(p_fn regprocedure, p_old text, p_new text) returns void
language plpgsql as $$
declare v_def text; v_n integer;
begin
  v_def := pg_get_functiondef(p_fn);
  v_n := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  if v_n <> 1 then raise exception 'Expected one "%" in %, found %', p_old, p_fn, v_n; end if;
  execute replace(v_def, p_old, p_new);
end $$;

select pg_temp.patch_fn('public.create_order(uuid, order_channel, text, text, text, jsonb, integer, uuid)'::regprocedure,
  $o$perform pg_advisory_xact_lock(hashtext((v_item->>'ticket_type_id')));$o$,
  $n$perform pg_advisory_xact_lock(hashtext(band_pool_of((v_item->>'ticket_type_id')::uuid)::text));$n$);
-- Labels on one stack in the same order are checked together, after the per-label checks.
select pg_temp.patch_fn('public.create_order(uuid, order_channel, text, text, text, jsonb, integer, uuid)'::regprocedure,
  $o$  insert into orders (event_id, channel, buyer_name$o$,
  $n$  for v_agg in
    select band_pool_of((i->>'ticket_type_id')::uuid) as tid, sum((i->>'qty')::int) as qty
    from jsonb_array_elements(p_items) i
    group by 1 having count(distinct i->>'ticket_type_id') > 1
  loop
    select pool_sellable into v_avail from v_ticket_type_availability where ticket_type_id = v_agg.tid;
    if v_avail.pool_sellable < v_agg.qty then
      raise exception 'Only % wristband(s) left for these tickets together', greatest(v_avail.pool_sellable, 0);
    end if;
  end loop;

  insert into orders (event_id, channel, buyer_name$n$);

select pg_temp.patch_fn('public.issue_order_tickets(uuid, uuid, payment_method, text, text[])'::regprocedure,
  $o$perform pg_advisory_xact_lock(hashtext(v_item.ticket_type_id::text));$o$,
  $n$perform pg_advisory_xact_lock(hashtext(band_pool_of(v_item.ticket_type_id)::text));$n$);
select pg_temp.patch_fn('public.issue_order_tickets(uuid, uuid, payment_method, text, text[])'::regprocedure,
  $o$where ticket_type_id = v_item.ticket_type_id and status = 'available'$o$,
  $n$where ticket_type_id = band_pool_of(v_item.ticket_type_id) and status = 'available'$n$);

select pg_temp.patch_fn('public.convert_order(uuid, uuid, integer, jsonb, uuid, text, text[])'::regprocedure,
  $o$perform pg_advisory_xact_lock(hashtext(p_target_type_id::text));$o$,
  $n$perform pg_advisory_xact_lock(hashtext(band_pool_of(p_target_type_id)::text));$n$);
select pg_temp.patch_fn('public.convert_order(uuid, uuid, integer, jsonb, uuid, text, text[])'::regprocedure,
  $o$perform pg_advisory_xact_lock(hashtext(v_t.ticket_type_id::text));$o$,
  $n$perform pg_advisory_xact_lock(hashtext(band_pool_of(v_t.ticket_type_id)::text));$n$);
select pg_temp.patch_fn('public.convert_order(uuid, uuid, integer, jsonb, uuid, text, text[])'::regprocedure,
  $o$where ticket_type_id = p_target_type_id and status = 'available'$o$,
  $n$where ticket_type_id = band_pool_of(p_target_type_id) and status = 'available'$n$);

select pg_temp.patch_fn('public.record_walkin(uuid, integer, uuid, payment_method, text, text, text, uuid, text)'::regprocedure,
  $o$perform pg_advisory_xact_lock(hashtext(p_ticket_type_id::text));$o$,
  $n$perform pg_advisory_xact_lock(hashtext(band_pool_of(p_ticket_type_id)::text));$n$);
select pg_temp.patch_fn('public.undo_walkin_sale(uuid, uuid)'::regprocedure,
  $o$perform pg_advisory_xact_lock(hashtext(v_w.ticket_type_id::text));$o$,
  $n$perform pg_advisory_xact_lock(hashtext(band_pool_of(v_w.ticket_type_id)::text));$n$);
select pg_temp.patch_fn((select p.oid::regprocedure from pg_proc p join pg_namespace s on s.oid = p.pronamespace
                          where s.nspname = 'public' and p.proname = 'record_drifter_bands'),
  $o$perform pg_advisory_xact_lock(hashtext(p_ticket_type_id::text));$o$,
  $n$perform pg_advisory_xact_lock(hashtext(band_pool_of(p_ticket_type_id)::text));$n$);

-- Numbers are loaded on the stack's own label, never on a borrower.
create or replace function import_number_range(p_ticket_type_id uuid, p_prefix text, p_start integer, p_end integer, p_pad integer)
returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare n integer;
begin
  if exists (select 1 from ticket_types where id = p_ticket_type_id and pool_type_id is not null) then
    raise exception 'This ticket type uses another ticket type''s wristbands; load the numbers there';
  end if;
  insert into ticket_numbers (ticket_type_id, number, seq)
  select p_ticket_type_id, coalesce(p_prefix,'') || lpad(g::text, greatest(p_pad, length(p_end::text)), '0'), g
  from generate_series(p_start, p_end) g
  on conflict (ticket_type_id, number) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function import_number_range(uuid, text, integer, integer, integer) from public, anon, authenticated;

-- Availability: pool_total / pool_available are the stack's; online_sold and voided
-- count the numbers this label's tickets hold; sellable and pool_sellable take off
-- every reservation and gate sale on the stack. For a label that is its own stack
-- and lends to nobody these are the same numbers as before.
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
                  WHERE t.ticket_type_id = tt.id AND t.status = 'void'::ticket_status AND o2.status = 'paid'::order_status), 0::bigint) AS online_revenue_centavos
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

-- ---------------------------------------------------------------- the labels
-- VIP Pass (no shirt): the VIP Pass without the shirt, on the VIP Pass's green bands.
insert into ticket_types (event_id, code, name, description, price_centavos, band_color,
                          includes_shirt, ships_shirt, includes_lanyard, includes_sticker, includes_car_pass,
                          requires_vehicle, is_child, sort_order, active, sell_online, walkin_price_centavos,
                          sales_close_at, online_cap, included_companions, drifter_family, free_allowance,
                          sell_at_gate, walkin_name, gate_needs_name, pool_type_id)
select g.event_id, 'GN', 'VIP Pass (no shirt)',
       'Dedicated VIP entrance, VIP viewing tent, VIP lanyard ID, event decal, and a drift demo raffle entry. No event t-shirt. Same green wristband as the VIP Pass.',
       50000, g.band_color,
       false, false, true, true, false,
       false, false, g.sort_order + 1, true, true, null,
       null, null, 0, false, 0,
       false, null, false, g.id
  from ticket_types g
 where g.active and g.code = 'G'
   and not exists (select 1 from ticket_types x where x.event_id = g.event_id and x.code = 'GN');

-- Keep the drifter label after it in the organizer's order.
update ticket_types d set sort_order = gn.sort_order + 1
  from ticket_types gn
 where gn.code = 'GN' and gn.event_id = d.event_id and d.active and d.drifter_family and d.sort_order <= gn.sort_order;

-- VIP Car Display with shirt: online again, no closing date.
update ticket_types set sales_close_at = null where active and code = 'R';

-- VIP Car Display (no shirt): online too. The gate keeps calling it "VIP Car (no shirt)".
update ticket_types
   set sell_online = true,
       name = 'VIP Car Display (no shirt)',
       walkin_name = coalesce(walkin_name, 'VIP Car (no shirt)'),
       description = 'VIP car display parking for the driver, without the event t-shirt. Red stripes wristband. Car photo, plate number and model required.',
       sales_close_at = null,
       online_cap = null
 where active and code = 'C';
