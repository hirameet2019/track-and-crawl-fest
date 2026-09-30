-- Two nudge emails around the payment window: a reminder shortly before the
-- hold expires, and a notice once it has. Both are sent by the cron route at
-- /api/cron/payment-emails.
--
-- The stamps below are what stop a buyer being emailed twice. A time-window
-- query alone is not enough: cron runs overlap, retry and drift, so "has this
-- order already been told" has to be recorded, not inferred from the clock.

alter table orders
  add column if not exists reminder_sent_at      timestamptz,
  add column if not exists expiry_notice_sent_at timestamptz;

comment on column orders.reminder_sent_at is
  'When the "your hold is about to expire" email went out, or when it was suppressed. Null means one is still due.';
comment on column orders.expiry_notice_sent_at is
  'When the "your hold expired, you can still finish" email went out, or when it was suppressed. Null means one is still due.';

-- Start clean. Without this, the first cron run would mail every buyer whose
-- order had already lapsed, some of them from the day before: a burst of
-- surprise mail about orders they have long since abandoned or replaced. Orders
-- that predate the feature are marked handled so only future lapses are mailed.
update orders
   set expiry_notice_sent_at = now()
 where status = 'expired' and expiry_notice_sent_at is null;

update orders
   set reminder_sent_at = now()
 where status <> 'pending_payment' and reminder_sent_at is null;

-- The cron sweep filters on status plus one of the stamps; this keeps it off a
-- sequential scan as the orders table grows through the event.
create index if not exists orders_pending_reminder_idx
  on orders (expires_at)
  where status = 'pending_payment' and reminder_sent_at is null;

create index if not exists orders_expired_notice_idx
  on orders (expires_at)
  where status = 'expired' and expiry_notice_sent_at is null;
