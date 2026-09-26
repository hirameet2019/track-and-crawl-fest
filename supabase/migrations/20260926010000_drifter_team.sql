-- Record the team a drifter runs with (2026-09-26).
--
-- Staff at the desk want to see at a glance which team a name belongs to, so the
-- team travels with every hand-out and rolls up beside the drifter. It is
-- optional: a privateer has no team, and the gate must not stall over a blank
-- field. Left blank for a drifter already on the list, the team already recorded
-- is kept rather than wiped.

alter table walkin_sales
  add column if not exists team_name text;

-- Per-drifter roll-up now carries the team: the most recent one recorded wins, so
-- a correction sticks without having to edit old rows.
drop view if exists v_drifter_bands;
create view v_drifter_bands with (security_invoker = on) as
select
  ws.ticket_type_id,
  tt.event_id,
  lower(ws.drifter_name)                                                     as drifter_key,
  min(ws.drifter_name)                                                       as drifter_name,
  (array_agg(ws.team_name order by ws.created_at desc)
     filter (where nullif(btrim(ws.team_name), '') is not null))[1]          as team_name,
  sum(ws.qty)::integer                                                       as bands,
  sum(ws.free_qty)::integer                                                  as free_bands,
  (sum(ws.qty) - sum(ws.free_qty))::integer                                  as paid_bands,
  sum((ws.qty - ws.free_qty) * ws.unit_price_centavos)::bigint               as amount_centavos,
  min(ws.created_at)                                                         as first_at,
  max(ws.created_at)                                                         as last_at
from walkin_sales ws
join ticket_types tt on tt.id = ws.ticket_type_id
where ws.drifter_name is not null
group by ws.ticket_type_id, tt.event_id, lower(ws.drifter_name)
having sum(ws.qty) <> 0;
revoke select on public.v_drifter_bands from anon;

drop function if exists record_drifter_bands(uuid, text, integer, uuid, payment_method, boolean);

create or replace function record_drifter_bands(
  p_ticket_type_id uuid,
  p_drifter_name   text,
  p_qty            integer,
  p_actor          uuid,
  p_method         payment_method,
  p_rules_ack      boolean default false,
  p_team           text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_type     ticket_types%rowtype;
  v_name     text;
  v_existing text;
  v_team     text;
  v_price    integer;
  v_sellable bigint;
  v_before   bigint;
  v_after    bigint;
  v_free     integer;
  v_paid     integer;
begin
  if p_qty is null or p_qty = 0 then raise exception 'Quantity must not be zero'; end if;
  v_name := nullif(btrim(regexp_replace(p_drifter_name, '\s+', ' ', 'g')), '');
  if v_name is null then raise exception 'Enter the drifter''s name'; end if;
  if length(v_name) > 80 then raise exception 'That name is too long'; end if;
  v_team := nullif(btrim(regexp_replace(coalesce(p_team, ''), '\s+', ' ', 'g')), '');
  if length(coalesce(v_team, '')) > 80 then raise exception 'That team name is too long'; end if;
  -- Handing bands over needs the confirmation; taking them back does not.
  if p_qty > 0 and not coalesce(p_rules_ack, false) then
    raise exception 'The drifter must confirm the wristband rules before any band is handed over';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_ticket_type_id::text));

  select * into v_type from ticket_types where id = p_ticket_type_id and active;
  if not found then raise exception 'Unknown or inactive ticket type'; end if;
  if not v_type.drifter_family then raise exception '% is not a drifter label', v_type.name; end if;
  v_price := coalesce(v_type.walkin_price_centavos, v_type.price_centavos);

  -- Keep one spelling per drifter: match on lower(), store the spelling first used.
  select ws.drifter_name into v_existing
  from walkin_sales ws
  where ws.ticket_type_id = p_ticket_type_id and lower(ws.drifter_name) = lower(v_name)
  order by ws.created_at limit 1;
  if v_existing is not null then v_name := v_existing; end if;

  -- A blank team on a drifter already known keeps the team already recorded.
  if v_team is null then
    select b.team_name into v_team from v_drifter_bands b
    where b.ticket_type_id = p_ticket_type_id and b.drifter_key = lower(v_name);
  end if;

  select coalesce(sum(ws.qty), 0) into v_before
  from walkin_sales ws
  where ws.ticket_type_id = p_ticket_type_id and lower(ws.drifter_name) = lower(v_name);

  v_after := v_before + p_qty;
  if v_after < 0 then
    raise exception '% has only % band(s) recorded', v_name, v_before;
  end if;

  if p_qty > 0 then
    select a.sellable into v_sellable from v_ticket_type_availability a where a.ticket_type_id = p_ticket_type_id;
    if v_sellable < p_qty then
      raise exception 'Only % wristband(s) left for % (%)', greatest(v_sellable, 0), v_type.name, v_type.band_color;
    end if;
  end if;

  v_free := (least(v_after, v_type.free_allowance) - least(v_before, v_type.free_allowance))::integer;
  v_paid := p_qty - v_free;

  if v_paid > 0 and v_price <= 0 then
    raise exception 'Set the price for extra % bands first', v_type.name;
  end if;

  insert into walkin_sales (event_id, ticket_type_id, drifter_name, team_name, qty, free_qty, unit_price_centavos, payment_method, sold_by, rules_ack)
  values (v_type.event_id, p_ticket_type_id, v_name, v_team, p_qty, v_free, v_price, coalesce(p_method, 'cash'), p_actor, coalesce(p_rules_ack, false));

  insert into audit_log (actor, action, entity, entity_id, data)
  values (p_actor, 'drifter.bands', 'ticket_type', p_ticket_type_id::text,
          jsonb_build_object('drifter', v_name, 'team', v_team, 'qty', p_qty, 'free', v_free, 'paid', v_paid,
                             'unit_price_centavos', v_price, 'method', coalesce(p_method, 'cash'),
                             'rules_ack', coalesce(p_rules_ack, false)));

  return jsonb_build_object(
    'drifter_name', v_name,
    'team_name', v_team,
    'total', v_after,
    'free', v_free,
    'paid', v_paid,
    'charge_centavos', greatest(v_paid, 0) * v_price
  );
end $$;
revoke execute on function public.record_drifter_bands(uuid, text, integer, uuid, payment_method, boolean, text) from public, anon, authenticated;
