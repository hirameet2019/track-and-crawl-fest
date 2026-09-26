-- Drifter self sign-up through one shared link (2026-09-27).
--
-- The organizer cannot hand over a final list of competing drifters, so the
-- per-drifter links cannot be made in advance. Instead there is one shared link
-- (/drifters/<slug>) the organizer posts to the drifters. A drifter types their
-- own name, team and car number, lists the people with them and confirms the
-- rules; that creates their entry and gives them their own personal link
-- (/d/<token>) to change the list later. From there it is the same flow.
--
-- What keeps it honest without a list:
--   * nothing leaves the pool until the desk hands the bands over in person, and
--     a self-registered entry is flagged so staff check the competitor pass first
--   * one live entry per drifter name, so a name cannot be registered twice
--   * the slug is random and can be closed or replaced if it leaks

alter table drifter_entries
  add column if not exists self_registered boolean not null default false;

alter table ticket_types
  -- null = the shared sign-up link is closed
  add column if not exists drifter_signup_slug text unique;

create or replace function self_register_drifter(
  p_slug      text,
  p_token     text,
  p_name      text,
  p_team      text,
  p_car       text,
  p_people    jsonb,
  p_rules_ack boolean
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_type ticket_types%rowtype;
  v_name text;
  v_team text;
  v_car  text;
  v_id   uuid;
  v_r    jsonb;
begin
  select * into v_type from ticket_types
   where drifter_signup_slug = p_slug and drifter_family and active;
  if not found then raise exception 'This sign-up link is closed. Ask the organizer for the current one.'; end if;

  v_name := nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), '');
  v_team := nullif(btrim(regexp_replace(coalesce(p_team, ''), '\s+', ' ', 'g')), '');
  v_car  := nullif(btrim(regexp_replace(coalesce(p_car, ''), '^#', '')), '');
  if v_name is null or length(v_name) < 2 then raise exception 'Enter your full name as the drifter.'; end if;
  if length(v_name) > 80 then raise exception 'That name is too long.'; end if;
  if length(coalesce(v_team, '')) > 80 then raise exception 'That team name is too long.'; end if;
  if length(coalesce(v_car, '')) > 20 then raise exception 'That car number is too long.'; end if;

  if exists (select 1 from drifter_entries
              where ticket_type_id = v_type.id and active and lower(btrim(drifter_name)) = lower(v_name)) then
    raise exception 'A drifter named % is already registered. If that is you, open the personal link you got after signing up, or ask the registration desk.', v_name;
  end if;

  insert into drifter_entries (event_id, ticket_type_id, drifter_name, team_name, car_no, token, self_registered)
  values (v_type.event_id, v_type.id, v_name, v_team, v_car, p_token, true)
  returning id into v_id;

  -- Same checks as a personal link: every name, a role each, the rules confirmed.
  -- Any failure undoes the insert above, so a half-filled sign-up leaves nothing.
  v_r := submit_drifter_registration(p_token, p_people, p_rules_ack);

  insert into audit_log (actor, action, entity, entity_id, data)
  values (null, 'drifter.self_registered', 'drifter_entry', v_id::text,
          jsonb_build_object('drifter', v_name, 'team', v_team, 'car', v_car, 'bands', v_r->'band_count'));

  return jsonb_build_object('token', p_token, 'drifter_name', v_name, 'band_count', v_r->'band_count');
end $$;
revoke execute on function public.self_register_drifter(text, text, text, text, text, jsonb, boolean) from public, anon, authenticated;
