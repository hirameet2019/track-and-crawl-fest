-- Broadcast-from-database: one tiny message per order insert/update on the
-- private topic "orders". Cheaper and more reliable than WAL-based
-- postgres_changes; only signed-in staff may join the topic (RLS on realtime.messages).
create or replace function public.notify_order_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'id', new.id,
      'order_no', new.order_no,
      'status', new.status,
      'old_status', case when tg_op = 'UPDATE' then old.status else null end,
      'op', tg_op
    ),
    'order_changed',
    'orders',
    true
  );
  return null;
end $$;

drop trigger if exists orders_broadcast on public.orders;
create trigger orders_broadcast
  after insert or update on public.orders
  for each row execute function public.notify_order_change();

drop policy if exists "staff read order broadcasts" on realtime.messages;
create policy "staff read order broadcasts" on realtime.messages
  for select to authenticated
  using (realtime.topic() = 'orders' and public.is_staff());
