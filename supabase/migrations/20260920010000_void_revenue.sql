-- Revenue must exclude voided tickets even when only part of a paid order was
-- voided (a fully voided order is already status 'voided' and drops out).

-- Per paid order: how much of total_centavos belongs to tickets that are now void.
create or replace view v_order_void_deductions as
select
  t.order_id,
  count(*)::integer                       as void_tickets,
  sum(oi.unit_price_centavos)::bigint     as void_centavos
from tickets t
join order_items oi on oi.order_id = t.order_id and oi.ticket_type_id = t.ticket_type_id
where t.status = 'void'
group by t.order_id;

alter view public.v_order_void_deductions set (security_invoker = on);
revoke select on public.v_order_void_deductions from anon;

-- Same column list as before; only online_revenue_centavos changes.
create or replace view v_ticket_type_availability as
select
  tt.id as ticket_type_id,
  tt.event_id,
  tt.code, tt.name, tt.price_centavos, tt.walkin_price_centavos, tt.band_color, tt.sort_order, tt.active, tt.sell_online,
  p.pool_total,
  p.pool_available,
  p.voided,
  p.assigned                                   as online_sold,
  w.walkin_sold,
  p.assigned + w.walkin_sold                   as sold,
  r.reserved,
  p.pool_available - r.reserved - w.walkin_sold as sellable,
  o.online_revenue_centavos,
  w.walkin_revenue_centavos,
  o.online_revenue_centavos + w.walkin_revenue_centavos as revenue_centavos,
  (select count(*) from tickets t where t.ticket_type_id = tt.id and t.status = 'redeemed') as redeemed
from ticket_types tt
cross join lateral (
  select count(*) as pool_total,
         count(*) filter (where n.status = 'available') as pool_available,
         count(*) filter (where n.status = 'assigned')  as assigned,
         count(*) filter (where n.status = 'void')      as voided
  from ticket_numbers n where n.ticket_type_id = tt.id
) p
cross join lateral (
  select coalesce(sum(oi.qty), 0)::bigint as reserved
  from order_items oi join orders o_1 on o_1.id = oi.order_id
  where oi.ticket_type_id = tt.id and o_1.status in ('pending_payment','awaiting_verification')
) r
cross join lateral (
  select coalesce(sum(oi.qty * oi.unit_price_centavos), 0)::bigint
         - coalesce((select sum(oi2.unit_price_centavos)
                     from tickets t
                     join order_items oi2 on oi2.order_id = t.order_id and oi2.ticket_type_id = t.ticket_type_id
                     join orders o2 on o2.id = t.order_id
                     where t.ticket_type_id = tt.id and t.status = 'void' and o2.status = 'paid'), 0)::bigint
         as online_revenue_centavos
  from order_items oi join orders o_1 on o_1.id = oi.order_id
  where oi.ticket_type_id = tt.id and o_1.status = 'paid'
) o
cross join lateral (
  select coalesce(sum(ws.qty), 0)::bigint as walkin_sold,
         coalesce(sum(ws.qty * ws.unit_price_centavos), 0)::bigint as walkin_revenue_centavos
  from walkin_sales ws where ws.ticket_type_id = tt.id
) w;

alter view public.v_ticket_type_availability set (security_invoker = on);
revoke select on public.v_ticket_type_availability from anon;
