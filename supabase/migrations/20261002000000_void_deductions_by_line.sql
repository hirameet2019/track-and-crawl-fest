-- Price each voided ticket from its own order line (2026-10-02).
--
-- A VIP Car Display order carries two lines of the same ticket type: the car at
-- the full price and the free passenger band at PHP 0 (tickets.included). The old
-- view joined a void ticket to every line of its type, so one void counted twice
-- and always cost the price of both lines: voiding the free passenger band took
-- PHP 1,850 off the paid total on the Dashboard and the Orders page.
--
-- Now each void ticket takes exactly one line: the PHP 0 line for an included
-- band, the priced line for anything else. Orders with a single line per type
-- come out the same as before. A void ticket with no line of its type (an order
-- converted to another label) still drops out, as before.
--
-- Same columns, same types, so the Dashboard and the Orders totals need no change.

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
group by t.order_id;

alter view public.v_order_void_deductions set (security_invoker = on);
revoke select on public.v_order_void_deductions from anon;
