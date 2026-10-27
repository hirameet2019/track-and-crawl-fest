-- Email outbox (Admin > Settings > Email > Outbox).
--
-- Every email the site sends to a buyer is written here: the ones that went out,
-- the ones that failed, and the ones held back because no email provider is set
-- up yet. Staff send the held and failed ones from Settings once SMTP works, and
-- can resend any of them.
--
-- The body is kept as it was written. A ticket PDF is not stored: it is built
-- fresh from the order when the email is sent, so it always shows the tickets
-- that are valid at that moment.
--
-- Additive only: one new table, no existing row, function or policy changes, so
-- it is safe while registration is live. Read and written only by the server
-- (service role), so RLS is on with no policies.

create table if not exists email_outbox (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- received | reminder | expiry | tickets | converted | voided | rejected
  kind        text not null,
  order_id    uuid references orders(id) on delete cascade,
  to_email    text not null,
  subject     text not null,
  html        text not null,
  -- Attach the order's ticket PDF when sending.
  has_pdf     boolean not null default false,
  status      text not null default 'held' check (status in ('held', 'sent', 'failed', 'skipped')),
  -- Why it failed, or why it was skipped.
  error       text,
  attempts    integer not null default 0,
  provider    text,
  sent_at     timestamptz
);

create index if not exists email_outbox_status_idx on email_outbox (status, created_at desc);
create index if not exists email_outbox_order_idx on email_outbox (order_id, kind);

alter table email_outbox enable row level security;

comment on table email_outbox is 'Buyer emails: sent, failed, or held until an email provider is set up. Admin > Settings > Email.';
