-- Drifter lists: partial hand-over, and getting a lost link back (2026-09-27).
--
-- Partial hand-over. A drifter rarely arrives with everyone on their list. The
-- desk now hands over bands only for the people who are there, ticked by name,
-- and the rest stay reserved on the list to collect when they arrive. The free
-- allowance counts across all pickups, because every pickup runs the ordinary
-- tally. The entry counts as handed over only when everyone has collected.
-- Once any band is out, the list is locked online and changed at the desk.
--
-- Lost link. A drifter who signs up through the shared link may give an email;
-- their personal link is sent there at once, and a "lost your link?" request
-- resends it to that address only - never shown on screen, so knowing someone's
-- name is not enough to open their list. Resends are spaced ten minutes apart.

alter table drifter_entries
  add column if not exists bands_given   integer not null default 0,
  add column if not exists contact_email text
    check (contact_email is null or contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add column if not exists link_sent_at  timestamptz;

create index if not exists drifter_entries_email_idx on drifter_entries (lower(contact_email)) where contact_email is not null;

-- ------------------------------------------------------------------ list edits stop once bands are out
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
  if v_e.bands_given > 0 then
    raise exception 'Some of your wristbands were already handed over, so your list can now only be changed at the registration desk.';
  end if;
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

-- ------------------------------------------------------------------ hand over the people who are here
drop function if exists hand_over_drifter_entry(uuid, uuid, payment_method, boolean, text);

create or replace function hand_over_drifter_entry(
  p_entry_id          uuid,
  p_actor             uuid,
  p_method            payment_method,
  p_payment_confirmed boolean default false,
  p_payment_ref       text default null,
  -- positions on the list of the people collecting now; null = everyone still waiting
  p_indices           integer[] default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_e       drifter_entries%rowtype;
  v_people  jsonb;
  v_idx     integer[];
  v_i       integer;
  v_n       integer;
  v_r       jsonb;
  v_charge  integer;
  v_ref     text := nullif(btrim(coalesce(p_payment_ref, '')), '');
  v_given   integer;
  v_names   text[] := '{}';
begin
  select * into v_e from drifter_entries where id = p_entry_id for update;
  if not found or not v_e.active then raise exception 'That drifter entry is not active.'; end if;
  if v_e.submitted_at is null or coalesce(v_e.band_count, 0) < 1 then raise exception '% has not submitted a list yet.', v_e.drifter_name; end if;
  if v_e.handed_over_at is not null then raise exception 'Everyone on % list has already collected their band.', v_e.drifter_name || '''s'; end if;

  v_people := v_e.people;
  if p_indices is null then
    select coalesce(array_agg(i - 1 order by i), '{}') into v_idx
    from jsonb_array_elements(v_people) with ordinality as t(p, i)
    where not (p ? 'given_at');
  else
    v_idx := p_indices;
  end if;

  v_n := coalesce(array_length(v_idx, 1), 0);
  if v_n = 0 then raise exception 'Tick at least one person who is here to collect.'; end if;
  if (select count(distinct x) from unnest(v_idx) x) <> v_n then raise exception 'The same person is ticked twice.'; end if;

  foreach v_i in array v_idx loop
    if v_i < 0 or v_i >= jsonb_array_length(v_people) then raise exception 'That person is not on the list.'; end if;
    if (v_people -> v_i) ? 'given_at' then
      raise exception '% already collected their band.', v_people -> v_i ->> 'name';
    end if;
    v_names := v_names || (v_people -> v_i ->> 'name');
    v_people := jsonb_set(v_people, array[v_i::text, 'given_at'], to_jsonb(now()));
  end loop;

  -- The ordinary tally, so the free allowance counts across every pickup.
  v_r := record_drifter_bands(v_e.ticket_type_id, v_e.drifter_name, v_n, p_actor, p_method,
                              v_e.rules_ack_at is not null, v_e.team_name, p_payment_confirmed, v_ref);
  v_charge := coalesce((v_r->>'charge_centavos')::integer, 0);
  v_given := v_e.bands_given + v_n;

  update drifter_entries
     set people         = v_people,
         bands_given    = v_given,
         handed_over_at = case when v_given >= v_e.band_count then now() end,
         handed_over_by = p_actor,
         paid_centavos  = paid_centavos + v_charge,
         payment_method = case when v_charge > 0 then coalesce(p_method, 'cash') else payment_method end,
         payment_ref    = case
                            when v_charge > 0 and v_ref is not null then
                              case when payment_ref is null then v_ref else payment_ref || ', ' || v_ref end
                            else payment_ref
                          end
   where id = v_e.id;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (p_actor, 'drifter.handed_over', 'drifter_entry', v_e.id::text,
          jsonb_build_object('drifter', v_e.drifter_name, 'team', v_e.team_name, 'bands', v_n,
                             'collected', v_given, 'of', v_e.band_count, 'people', to_jsonb(v_names),
                             'rules_ack_at', v_e.rules_ack_at, 'charge_centavos', v_charge,
                             'method', case when v_charge > 0 then coalesce(p_method, 'cash') end,
                             'payment_ref', case when v_charge > 0 then v_ref end));

  return v_r || jsonb_build_object('collected', v_given, 'of', v_e.band_count);
end $$;
revoke execute on function public.hand_over_drifter_entry(uuid, uuid, payment_method, boolean, text, integer[]) from public, anon, authenticated;

-- ------------------------------------------------------------------ sign-up keeps an email
drop function if exists self_register_drifter(text, text, text, text, text, jsonb, boolean);

create or replace function self_register_drifter(
  p_slug      text,
  p_token     text,
  p_name      text,
  p_team      text,
  p_car       text,
  p_people    jsonb,
  p_rules_ack boolean,
  p_email     text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_type  ticket_types%rowtype;
  v_name  text;
  v_team  text;
  v_car   text;
  v_email text;
  v_id    uuid;
  v_r     jsonb;
begin
  select * into v_type from ticket_types
   where drifter_signup_slug = p_slug and drifter_family and active;
  if not found then raise exception 'This sign-up link is closed. Ask the organizer for the current one.'; end if;

  v_name  := nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), '');
  v_team  := nullif(btrim(regexp_replace(coalesce(p_team, ''), '\s+', ' ', 'g')), '');
  v_car   := nullif(btrim(regexp_replace(coalesce(p_car, ''), '^#', '')), '');
  v_email := nullif(lower(btrim(coalesce(p_email, ''))), '');
  if v_name is null or length(v_name) < 2 then raise exception 'Enter your full name as the drifter.'; end if;
  if length(v_name) > 80 then raise exception 'That name is too long.'; end if;
  if length(coalesce(v_team, '')) > 80 then raise exception 'That team name is too long.'; end if;
  if length(coalesce(v_car, '')) > 20 then raise exception 'That car number is too long.'; end if;
  if v_email is not null and (length(v_email) > 120 or v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'That email address does not look right.';
  end if;

  if exists (select 1 from drifter_entries
              where ticket_type_id = v_type.id and active and lower(btrim(drifter_name)) = lower(v_name)) then
    raise exception 'A drifter named % is already registered. If that is you, use "Lost your link?" below, or ask the registration desk.', v_name;
  end if;

  insert into drifter_entries (event_id, ticket_type_id, drifter_name, team_name, car_no, token, self_registered, contact_email)
  values (v_type.event_id, v_type.id, v_name, v_team, v_car, p_token, true, v_email)
  returning id into v_id;

  v_r := submit_drifter_registration(p_token, p_people, p_rules_ack);

  insert into audit_log (actor, action, entity, entity_id, data)
  values (null, 'drifter.self_registered', 'drifter_entry', v_id::text,
          jsonb_build_object('drifter', v_name, 'team', v_team, 'car', v_car, 'bands', v_r->'band_count', 'email_given', v_email is not null));

  return jsonb_build_object('token', p_token, 'drifter_name', v_name, 'band_count', v_r->'band_count');
end $$;
revoke execute on function public.self_register_drifter(text, text, text, text, text, jsonb, boolean, text) from public, anon, authenticated;
