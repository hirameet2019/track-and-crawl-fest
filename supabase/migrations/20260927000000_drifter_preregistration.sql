-- Drifter pre-registration links (2026-09-27).
--
-- Each competing drifter gets a private link (/d/<token>). It opens with their
-- name and team taken from the entry list - not typed, so nobody can claim bands
-- as somebody else - and lets them list the people coming with them and confirm
-- the wristband rules before event day. Nothing leaves the pool at that point:
-- the desk hands the bands over in person, and only then does the normal drifter
-- tally run (free allowance, gate price past it, pool deduction, audit).
--
-- One row per drifter holds both the entry and their submitted list; resubmitting
-- replaces the list until the bands have been handed over.

create table if not exists drifter_entries (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references events(id) on delete cascade,
  ticket_type_id  uuid not null references ticket_types(id) on delete cascade,
  drifter_name    text not null check (length(btrim(drifter_name)) between 2 and 80),
  team_name       text check (team_name is null or length(team_name) <= 80),
  car_no          text check (car_no is null or length(car_no) <= 20),
  token           text not null unique check (length(token) >= 10),
  active          boolean not null default true,
  -- filled in by the drifter through their link
  people          jsonb not null default '[]'::jsonb,
  band_count      integer check (band_count is null or band_count between 1 and 20),
  rules_ack_at    timestamptz,
  submitted_at    timestamptz,
  -- set by the desk
  handed_over_at  timestamptz,
  handed_over_by  uuid references staff(id),
  created_by      uuid references staff(id),
  created_at      timestamptz not null default now()
);
create index if not exists drifter_entries_event_idx on drifter_entries (event_id, active);
-- one live entry per drifter, so the allowance cannot be split across two links
create unique index if not exists drifter_entries_name_uidx
  on drifter_entries (ticket_type_id, lower(btrim(drifter_name))) where active;

alter table drifter_entries enable row level security;
drop policy if exists "staff read drifter entries" on drifter_entries;
create policy "staff read drifter entries" on drifter_entries for select using (is_staff());

-- ------------------------------------------------------------------ the drifter submits
create or replace function submit_drifter_registration(
  p_token     text,
  p_people    jsonb,
  p_rules_ack boolean
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_e      drifter_entries%rowtype;
  v_person jsonb;
  v_clean  jsonb := '[]'::jsonb;
  v_name   text;
  v_role   text;
  v_n      integer;
begin
  select * into v_e from drifter_entries where token = p_token for update;
  if not found or not v_e.active then raise exception 'This link is not active. Ask the organizer for a new one.'; end if;
  if v_e.handed_over_at is not null then raise exception 'Your wristbands were already handed over, so this list can no longer be changed.'; end if;
  if not coalesce(p_rules_ack, false) then raise exception 'Please confirm that you understand the wristband rules.'; end if;
  if p_people is null or jsonb_typeof(p_people) <> 'array' then raise exception 'List the people coming with you.'; end if;

  v_n := jsonb_array_length(p_people);
  if v_n < 1 then raise exception 'List at least one person.'; end if;
  if v_n > 20 then raise exception 'A list can hold at most 20 people. Ask the desk for more on the day.'; end if;

  for v_person in select * from jsonb_array_elements(p_people) loop
    v_name := nullif(btrim(regexp_replace(coalesce(v_person->>'name', ''), '\s+', ' ', 'g')), '');
    v_role := coalesce(v_person->>'role', '');
    if v_name is null or length(v_name) < 2 then raise exception 'Every person needs a full name.'; end if;
    if length(v_name) > 80 then raise exception 'One of the names is too long.'; end if;
    if v_role not in ('Family', 'Friend', 'Pit crew', 'Spotter', 'Manager', 'Team staff') then
      raise exception 'Pick a role for every person.';
    end if;
    v_clean := v_clean || jsonb_build_array(jsonb_build_object('name', v_name, 'role', v_role));
  end loop;

  update drifter_entries
     set people = v_clean, band_count = v_n, rules_ack_at = now(), submitted_at = now()
   where id = v_e.id;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (null, 'drifter.registered', 'drifter_entry', v_e.id::text,
          jsonb_build_object('drifter', v_e.drifter_name, 'team', v_e.team_name, 'bands', v_n, 'resubmitted', v_e.submitted_at is not null));

  return jsonb_build_object('drifter_name', v_e.drifter_name, 'band_count', v_n, 'submitted_at', now());
end $$;
revoke execute on function public.submit_drifter_registration(text, jsonb, boolean) from public, anon, authenticated;

-- ------------------------------------------------------------------ the desk hands over
-- Runs the ordinary tally with the drifter's own confirmation, so the free
-- allowance, the gate price past it and the pool deduction work exactly as for
-- a walk-up, and the bands land in "Handed out here" under the same name.
create or replace function hand_over_drifter_entry(
  p_entry_id uuid,
  p_actor    uuid,
  p_method   payment_method
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_e drifter_entries%rowtype;
  v_r jsonb;
begin
  select * into v_e from drifter_entries where id = p_entry_id for update;
  if not found or not v_e.active then raise exception 'That drifter entry is not active.'; end if;
  if v_e.submitted_at is null or coalesce(v_e.band_count, 0) < 1 then raise exception '% has not submitted a list yet.', v_e.drifter_name; end if;
  if v_e.handed_over_at is not null then raise exception 'The bands for % were already handed over.', v_e.drifter_name; end if;

  v_r := record_drifter_bands(v_e.ticket_type_id, v_e.drifter_name, v_e.band_count, p_actor, p_method, v_e.rules_ack_at is not null, v_e.team_name);

  update drifter_entries set handed_over_at = now(), handed_over_by = p_actor where id = v_e.id;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (p_actor, 'drifter.handed_over', 'drifter_entry', v_e.id::text,
          jsonb_build_object('drifter', v_e.drifter_name, 'team', v_e.team_name, 'bands', v_e.band_count,
                             'rules_ack_at', v_e.rules_ack_at, 'charge_centavos', v_r->'charge_centavos'));

  return v_r;
end $$;
revoke execute on function public.hand_over_drifter_entry(uuid, uuid, payment_method) from public, anon, authenticated;
