-- Roles and permissions, edited in Admin > Settings > Users & roles (2026-10-28).
--
-- A role is a named set of permissions (the keys in src/lib/roles.ts). Each staff
-- account points at one role through staff.role_id. The owner role ("System admin")
-- always has every permission and cannot be edited or deleted, so there is always
-- a way back into Settings.
--
-- staff.role, staff.system_access and staff.can_scan stay for older rows: an account
-- with no role_id is read the old way by the app. This migration gives every
-- existing account the built-in role that matches what it could do before, so
-- nobody gains or loses access.
--
-- Additive and safe to run twice. Run it before deploying the app that reads it;
-- the app falls back to the old columns while the table is missing.

create table if not exists roles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  permissions text[] not null default '{}',
  is_owner    boolean not null default false,
  sort_order  integer not null default 100,
  created_at  timestamptz not null default now()
);
comment on table roles is 'Staff roles: a named set of permissions. Edited in Admin > Settings > Users & roles.';
comment on column roles.permissions is 'Permission keys from src/lib/roles.ts. Unknown keys are ignored by the app.';
comment on column roles.is_owner is 'Every permission, always. Cannot be edited or deleted.';

alter table roles enable row level security;
drop policy if exists "staff read roles" on roles;
create policy "staff read roles" on roles for select using (is_staff());

-- Built-in roles, the same sets as the old ranks (src/lib/roles.ts LEGACY mirrors these).
insert into roles (name, description, permissions, is_owner, sort_order) values
  ('System admin', 'Everything, including Numbers, Audit, Settings and Users & roles.', '{}', true, 10),
  ('Admin', 'Every sales tool, voids, conversions and reports. No Settings.', '{dashboard,verify,orders,orders_manage,walkin,walkin_prices,scan,reports}', false, 20),
  ('Staff', 'Dashboard, Verify, Orders, Walk-in and Scan.', '{dashboard,verify,orders,walkin,scan}', false, 30),
  ('Gate', 'The walk-in desk: Walk-in and Scan, nothing about online orders or buyers.', '{walkin,scan}', false, 40),
  ('Scanner', 'Scan only.', '{scan}', false, 50)
on conflict (name) do nothing;

alter table staff add column if not exists role_id uuid references roles(id);
comment on column staff.role_id is 'The account''s role. Null: the app reads role, system_access and can_scan instead.';
comment on column staff.role is 'Superseded by role_id; read only while role_id is null.';

-- An account with Scan turned off gets a copy of its role without Scan.
insert into roles (name, description, permissions, sort_order)
select distinct r.name || ' (no Scan)', 'Same as ' || r.name || ', without Scan.', array_remove(r.permissions, 'scan'), r.sort_order + 1
from staff s
join roles r on r.name = case s.role::text when 'admin' then 'Admin' when 'staff' then 'Staff' when 'gate' then 'Gate' else 'Scanner' end
where s.role_id is null and s.can_scan = false and not (s.role = 'admin' and s.system_access)
on conflict (name) do nothing;

update staff s set role_id = r.id
from roles r
where s.role_id is null
  and r.name = case
    when s.role = 'admin' and s.system_access then 'System admin'
    else (case s.role::text when 'admin' then 'Admin' when 'staff' then 'Staff' when 'gate' then 'Gate' else 'Scanner' end)
      || case when s.can_scan = false then ' (no Scan)' else '' end
  end;
