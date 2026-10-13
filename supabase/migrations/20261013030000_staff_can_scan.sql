-- Scan access per account (2026-10-13).
--
-- Every role from scanner up opens Scan. The organizer asked for an office account
-- that sees only Dashboard, Verify, Orders, Walk-in and Drifters, so staff.can_scan
-- turns Scan off for one account: the tab is hidden, /scan sends it home, and the
-- scan actions refuse it. Every existing account keeps Scan (default true).

alter table staff add column if not exists can_scan boolean not null default true;
comment on column staff.can_scan is
  'May open Scan and use the scan actions. False hides the Scan tab for this account.';
