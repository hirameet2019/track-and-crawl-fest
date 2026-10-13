-- Hide labels from staff pages without touching their data (2026-10-13).
--
-- After the event the organizer asked for the VIP labels and the drifter family
-- bands to be left out of the Dashboard, the Walk-in tab, Orders and Verify, while
-- every order, ticket and gate sale stays in the database in case it is needed.
--
-- ticket_types.hidden_in_admin marks such a label. The pages filter on it in the app
-- (no view or function changes); Settings > Tickets has the switch to show a label
-- again. The Drifters tab, the exports and the buyers' own pages are unaffected.
-- Code backup before this change: git tag backup/before-hide-vip-2026-10-13.

alter table ticket_types add column if not exists hidden_in_admin boolean not null default false;
comment on column ticket_types.hidden_in_admin is
  'Left out of the Dashboard, Walk-in, Orders and Verify. Data is kept; untick in Settings > Tickets to show it again.';

update ticket_types set hidden_in_admin = true
 where active and (code in ('G', 'GN', 'R', 'C') or drifter_family);
