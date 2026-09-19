-- Per-ticket-type online sales cut-off (organizer, 2026-09-19):
--   Early Bird Adult + Child  close end of Oct 8
--   VIP Car Display + VIP Standing close end of Oct 4
-- NULL = no cut-off. Admins change or clear it from Admin > Settings > Sales
-- schedule at any time (data change, no deploy), so sales can be reopened.

alter table ticket_types add column if not exists sales_close_at timestamptz;

update ticket_types set sales_close_at = '2026-10-08 23:59:59+08' where code in ('B', 'P');
update ticket_types set sales_close_at = '2026-10-04 23:59:59+08' where code in ('R', 'G');
