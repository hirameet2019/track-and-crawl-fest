-- Key/value settings editable from Admin > Settings (email/SMTP configuration).
-- Contains the SMTP password, so no RLS policy grants any role read access;
-- only the service role (server actions) can read or write it.
create table app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references staff(id)
);
alter table app_settings enable row level security;
