-- All writes go through server actions using the service role. Nothing else may call these.
revoke execute on function public.expire_stale_orders() from public, anon, authenticated;
revoke execute on function public.create_order(uuid, order_channel, text, text, text, jsonb, integer, uuid) from public, anon, authenticated;
revoke execute on function public.issue_order_tickets(uuid, uuid, payment_method, text, text[]) from public, anon, authenticated;
revoke execute on function public.import_number_range(uuid, text, integer, integer, integer) from public, anon, authenticated;
revoke execute on function public.redeem_ticket(text, uuid) from public, anon, authenticated;
-- is_staff is used inside RLS policies, so authenticated must keep execute; anon does not need it.
revoke execute on function public.is_staff() from public, anon;

-- Pin search_path so a malicious schema cannot shadow referenced objects.
alter function public.expire_stale_orders() set search_path = public, pg_temp;
alter function public.create_order(uuid, order_channel, text, text, text, jsonb, integer, uuid) set search_path = public, pg_temp;
alter function public.issue_order_tickets(uuid, uuid, payment_method, text, text[]) set search_path = public, pg_temp;
alter function public.import_number_range(uuid, text, integer, integer, integer) set search_path = public, pg_temp;
alter function public.redeem_ticket(text, uuid) set search_path = public, pg_temp;
alter function public.is_staff() set search_path = public, pg_temp;

-- The availability view should respect the caller's RLS (public can see ticket_types, not orders).
alter view public.v_ticket_type_availability set (security_invoker = on);
-- Only staff need the raw view; the public sales page reads it via the service role.
revoke select on public.v_ticket_type_availability from anon;
