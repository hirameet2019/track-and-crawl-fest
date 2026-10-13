-- System access: Numbers, Audit and Settings for one account (2026-10-13).
--
-- The organizer's admins keep the admin tools (orders, voids, conversions, reports),
-- but only the IT account (frmgdelacruz) may open Numbers, Audit and Settings or
-- use their actions. staff.system_access marks that account; the app checks it on
-- top of the admin role. Turn it on for another admin here if ever needed.

alter table staff add column if not exists system_access boolean not null default false;
comment on column staff.system_access is
  'May open Numbers, Audit and Settings and use their actions (on top of the admin role).';

update staff set system_access = true where id = 'f9664575-b975-47ad-bf95-2e669a9aca28';
