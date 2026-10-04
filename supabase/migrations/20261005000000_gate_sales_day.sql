-- Event-day gate sales (2026-10-05). The organizer reopens sales at the gate on
-- 10 October:
--   * VIP Car (no shirt), PHP 850: a new gate-only label, Red stripes, driver only,
--     with its own 9,999 wristband numbers (C0001-C9999).
--   * VIP Car with shirt, 2 pax, PHP 1,850: the VIP Car Display label (R) sold at
--     the gate with the same package as online. One sale is one car: the driver's
--     band (paid) and the passenger's band (included, free), one shirt (driver).
--   * Early Bird Kids shows as "Kids Walk-in" at the gate, PHP 75. Online tickets
--     keep their name.
--   * Early Bird (P) is no longer sold at the gate.
--
-- How a package sale is stored: qty counts bands and free_qty the included ones,
-- the same columns the drifter tally uses, so revenue stays (qty - free_qty) x price
-- everywhere it is already computed that way (Dashboard, exports, this view).

-- ------------------------------------------------------------------ labels
alter table ticket_types
  add column if not exists sell_at_gate boolean not null default true,
  add column if not exists walkin_name  text;

comment on column ticket_types.sell_at_gate is 'Shown on the Walk-in tab and accepted by record_walkin.';
comment on column ticket_types.walkin_name  is 'Name the gate desk sees on the Walk-in tab; the label name everywhere else.';

-- The shirt handed over with a gate sale, for labels that include one.
alter table walkin_sales add column if not exists shirt_size text;

update ticket_types set sell_at_gate = false
 where active and code = 'P';
update ticket_types set walkin_name = 'Kids Walk-in', walkin_price_centavos = 7500
 where active and code = 'B';
update ticket_types set walkin_name = 'VIP Car with shirt (2 pax)'
 where active and code = 'R';

-- Room for the new label right after VIP Car Display.
update ticket_types t set sort_order = t.sort_order + 1
  from ticket_types r
 where r.active and r.code = 'R' and t.active and t.event_id = r.event_id and t.sort_order > r.sort_order
   and not exists (select 1 from ticket_types c where c.event_id = r.event_id and c.code = 'C');

insert into ticket_types (event_id, code, name, description, price_centavos, walkin_price_centavos, band_color,
                          sell_online, sell_at_gate, sort_order, active)
select r.event_id, 'C', 'VIP Car (no shirt)',
       'Gate only, on event day. VIP car for the driver alone, without the event shirt. Red stripes wristband.',
       85000, 85000, 'Red stripes', false, true, r.sort_order + 1, true
  from ticket_types r
 where r.active and r.code = 'R'
on conflict (event_id, code) do nothing;

insert into ticket_numbers (ticket_type_id, number, seq)
select c.id, 'C' || lpad(g::text, 4, '0'), g
  from ticket_types c cross join generate_series(1, 9999) g
 where c.active and c.code = 'C'
on conflict (ticket_type_id, number) do nothing;

-- ------------------------------------------------------------------ availability
-- Two changes, same columns:
--   * cap_used now also counts gate sales (paid bands: one per car for R), so a
--     label's limit (40 cars for R, 200 for VIP Pass) is shared by online and gate.
--     Before, gate sales were bounded by the cap but never used it up.
--   * online revenue nets a voided ticket against its own order line, as
--     v_order_void_deductions does since 20261002000000; a car order's free
--     passenger line no longer doubles the deduction.
create or replace view v_ticket_type_availability as
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
            WHEN tt.online_cap IS NULL THEN p.pool_available - r.reserved - w.walkin_sold
            ELSE LEAST(p.pool_available - r.reserved - w.walkin_sold, tt.online_cap - c.cap_used)
        END AS sellable,
    o.online_revenue_centavos,
    w.walkin_revenue_centavos,
    o.online_revenue_centavos + w.walkin_revenue_centavos AS revenue_centavos,
    ( SELECT count(*) AS count
           FROM tickets t
          WHERE t.ticket_type_id = tt.id AND t.status = 'redeemed'::ticket_status) AS redeemed,
    tt.online_cap,
    c.cap_used,
    p.pool_available - r.reserved - w.walkin_sold AS pool_sellable,
    tt.drifter_family,
    tt.free_allowance,
    w.free_bands
   FROM ticket_types tt
     CROSS JOIN LATERAL ( SELECT count(*) AS pool_total,
            count(*) FILTER (WHERE n.status = 'available'::number_status) AS pool_available,
            count(*) FILTER (WHERE n.status = 'assigned'::number_status) AS assigned,
            count(*) FILTER (WHERE n.status = 'void'::number_status) AS voided
           FROM ticket_numbers n
          WHERE n.ticket_type_id = tt.id) p
     CROSS JOIN LATERAL ( SELECT COALESCE(sum(oi.qty), 0::bigint) AS reserved
           FROM order_items oi
             JOIN orders o_1 ON o_1.id = oi.order_id
          WHERE oi.ticket_type_id = tt.id AND (o_1.status = ANY (ARRAY['pending_payment'::order_status, 'awaiting_verification'::order_status]))) r
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
          WHERE ws.ticket_type_id = tt.id) w;

alter view public.v_ticket_type_availability set (security_invoker = on);
revoke select on public.v_ticket_type_availability from anon;

-- ------------------------------------------------------------------ the gate tap
drop function if exists record_walkin(uuid, integer, uuid, payment_method);

create or replace function record_walkin(
  p_ticket_type_id uuid,
  -- sales to record (negative to take back): cars for a label with included
  -- passengers, otherwise bands
  p_qty            integer,
  p_actor          uuid,
  p_method         payment_method,
  -- required for a label that includes a shirt
  p_shirt_size     text default null
) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_type     ticket_types%rowtype;
  v_label    text;
  v_price    integer;
  v_per_sale integer;
  v_bands    integer;
  v_free     integer;
  v_avail    record;
  v_size     text := nullif(upper(btrim(coalesce(p_shirt_size, ''))), '');
  v_count    bigint;
  v_size_net bigint;
begin
  if p_qty is null or p_qty = 0 then raise exception 'Quantity must not be zero'; end if;
  perform pg_advisory_xact_lock(hashtext(p_ticket_type_id::text));

  select * into v_type from ticket_types where id = p_ticket_type_id and active;
  if not found then raise exception 'Unknown or inactive ticket type'; end if;
  v_label := coalesce(v_type.walkin_name, v_type.name);
  if v_type.drifter_family then raise exception 'Record % bands on the Drifters tab', v_type.name; end if;
  if not v_type.sell_at_gate then raise exception '% is not sold at the gate', v_label; end if;

  v_price    := coalesce(v_type.walkin_price_centavos, v_type.price_centavos);
  -- one sale: the buyer's band plus the passengers the label includes
  v_per_sale := 1 + greatest(coalesce(v_type.included_companions, 0), 0);
  v_bands    := p_qty * v_per_sale;
  v_free     := p_qty * (v_per_sale - 1);

  if v_type.includes_shirt then
    if v_size is null then raise exception 'Pick the shirt size handed over with %', v_label; end if;
    if v_size not in ('2XS','XS','S','M','L','XL','2XL','3XL','4XL','5XL','6XL','7XL','8XL') then
      raise exception 'Unknown shirt size %', v_size;
    end if;
  else
    v_size := null;
  end if;

  select coalesce(sum(qty), 0) into v_count from walkin_sales where ticket_type_id = p_ticket_type_id;

  if p_qty > 0 then
    if v_price <= 0 then raise exception 'Set the walk-in price for % (%) first', v_label, v_type.band_color; end if;
    select pool_sellable, online_cap, cap_used into v_avail from v_ticket_type_availability where ticket_type_id = p_ticket_type_id;
    if v_avail.pool_sellable < v_bands then
      raise exception 'Only % wristband(s) left for % (%)', greatest(v_avail.pool_sellable, 0), v_label, v_type.band_color;
    end if;
    if v_avail.online_cap is not null and v_avail.online_cap - v_avail.cap_used < p_qty then
      raise exception 'Only % left for % (limit of %)', greatest(v_avail.online_cap - v_avail.cap_used, 0), v_label, v_avail.online_cap;
    end if;
  else
    if v_count + v_bands < 0 then raise exception 'Nothing left to take back for %', v_label; end if;
    if v_size is not null then
      select coalesce(sum(qty - free_qty), 0) into v_size_net
        from walkin_sales where ticket_type_id = p_ticket_type_id and shirt_size = v_size;
      if v_size_net + p_qty < 0 then raise exception 'No % shirt sale to take back for %', v_size, v_label; end if;
    end if;
  end if;

  insert into walkin_sales (event_id, ticket_type_id, qty, free_qty, unit_price_centavos, payment_method, sold_by, shirt_size)
  values (v_type.event_id, p_ticket_type_id, v_bands, v_free, v_price, coalesce(p_method, 'cash'), p_actor, v_size);

  insert into audit_log (actor, action, entity, entity_id, data)
  values (p_actor, 'walkin.recorded', 'ticket_type', p_ticket_type_id::text,
          jsonb_build_object('qty', v_bands, 'free', v_free, 'sales', p_qty, 'unit_price_centavos', v_price,
                             'method', coalesce(p_method, 'cash'), 'shirt_size', v_size));

  return (v_count + v_bands)::integer;
end $$;
revoke execute on function public.record_walkin(uuid, integer, uuid, payment_method, text) from public, anon, authenticated;
