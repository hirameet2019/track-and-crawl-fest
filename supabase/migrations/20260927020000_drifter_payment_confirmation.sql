-- Confirm payment for drifter bands past the free allowance (2026-09-27).
--
-- Bands beyond the free six cost the gate price, collected at the desk. Until
-- now a hand-over simply assumed the money had changed hands. Now any entry that
-- charges something must carry the staff member's confirmation that it was
-- received, and an e-wallet payment (GoTyme, GCash, Maya) must carry its
-- reference number, so the organizer can match every peso to a transfer.
-- Free bands need neither. The confirmation is stored on the tally row and, for
-- pre-registered drifters, on their entry, so their own link can show it.

alter table walkin_sales
  add column if not exists payment_ref text,
  add column if not exists payment_confirmed boolean not null default false;

alter table drifter_entries
  add column if not exists paid_centavos  integer not null default 0,
  add column if not exists payment_method payment_method,
  add column if not exists payment_ref    text;

-- ------------------------------------------------------------------ the tally
drop function if exists record_drifter_bands(uuid, text, integer, uuid, payment_method, boolean, text);

create or replace function record_drifter_bands(
  p_ticket_type_id    uuid,
  p_drifter_name      text,
  p_qty               integer,
  p_actor             uuid,
  p_method            payment_method,
  p_rules_ack         boolean default false,
  p_team              text default null,
  p_payment_confirmed boolean default false,
  p_payment_ref       text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_type     ticket_types%rowtype;
  v_name     text;
  v_existing text;
  v_team     text;
  v_ref      text;
  v_method   payment_method := coalesce(p_method, 'cash');
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
  v_ref := nullif(btrim(coalesce(p_payment_ref, '')), '');
  if length(coalesce(v_ref, '')) > 60 then raise exception 'That reference number is too long'; end if;
  if p_qty > 0 and not coalesce(p_rules_ack, false) then
    raise exception 'The drifter must confirm the wristband rules before any band is handed over';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_ticket_type_id::text));

  select * into v_type from ticket_types where id = p_ticket_type_id and active;
  if not found then raise exception 'Unknown or inactive ticket type'; end if;
  if not v_type.drifter_family then raise exception '% is not a drifter label', v_type.name; end if;
  v_price := coalesce(v_type.walkin_price_centavos, v_type.price_centavos);

  select ws.drifter_name into v_existing
  from walkin_sales ws
  where ws.ticket_type_id = p_ticket_type_id and lower(ws.drifter_name) = lower(v_name)
  order by ws.created_at limit 1;
  if v_existing is not null then v_name := v_existing; end if;

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

  -- Money changes hands: staff must say it did, and an e-wallet transfer must be traceable.
  if v_paid > 0 then
    if not coalesce(p_payment_confirmed, false) then
      raise exception 'Confirm that PHP % for % extra band(s) was received before handing them over',
        to_char(v_paid * v_price / 100.0, 'FM999,990.00'), v_paid;
    end if;
    if v_method <> 'cash' and (v_ref is null or length(v_ref) < 4) then
      raise exception 'Enter the % reference number for the PHP % payment', upper(v_method::text),
        to_char(v_paid * v_price / 100.0, 'FM999,990.00');
    end if;
  end if;

  insert into walkin_sales (event_id, ticket_type_id, drifter_name, team_name, qty, free_qty, unit_price_centavos,
                            payment_method, sold_by, rules_ack, payment_ref, payment_confirmed)
  values (v_type.event_id, p_ticket_type_id, v_name, v_team, p_qty, v_free, v_price,
          v_method, p_actor, coalesce(p_rules_ack, false),
          case when v_paid > 0 then v_ref end, v_paid > 0 and coalesce(p_payment_confirmed, false));

  insert into audit_log (actor, action, entity, entity_id, data)
  values (p_actor, 'drifter.bands', 'ticket_type', p_ticket_type_id::text,
          jsonb_build_object('drifter', v_name, 'team', v_team, 'qty', p_qty, 'free', v_free, 'paid', v_paid,
                             'unit_price_centavos', v_price, 'method', v_method,
                             'rules_ack', coalesce(p_rules_ack, false),
                             'payment_confirmed', v_paid > 0 and coalesce(p_payment_confirmed, false),
                             'payment_ref', case when v_paid > 0 then v_ref end));

  return jsonb_build_object(
    'drifter_name', v_name,
    'team_name', v_team,
    'total', v_after,
    'free', v_free,
    'paid', v_paid,
    'charge_centavos', greatest(v_paid, 0) * v_price
  );
end $$;
revoke execute on function public.record_drifter_bands(uuid, text, integer, uuid, payment_method, boolean, text, boolean, text) from public, anon, authenticated;

-- ------------------------------------------------------------------ pre-registered hand-over
drop function if exists hand_over_drifter_entry(uuid, uuid, payment_method);

create or replace function hand_over_drifter_entry(
  p_entry_id          uuid,
  p_actor             uuid,
  p_method            payment_method,
  p_payment_confirmed boolean default false,
  p_payment_ref       text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_e      drifter_entries%rowtype;
  v_r      jsonb;
  v_charge integer;
begin
  select * into v_e from drifter_entries where id = p_entry_id for update;
  if not found or not v_e.active then raise exception 'That drifter entry is not active.'; end if;
  if v_e.submitted_at is null or coalesce(v_e.band_count, 0) < 1 then raise exception '% has not submitted a list yet.', v_e.drifter_name; end if;
  if v_e.handed_over_at is not null then raise exception 'The bands for % were already handed over.', v_e.drifter_name; end if;

  v_r := record_drifter_bands(v_e.ticket_type_id, v_e.drifter_name, v_e.band_count, p_actor, p_method,
                              v_e.rules_ack_at is not null, v_e.team_name, p_payment_confirmed, p_payment_ref);
  v_charge := coalesce((v_r->>'charge_centavos')::integer, 0);

  update drifter_entries
     set handed_over_at = now(),
         handed_over_by = p_actor,
         paid_centavos  = v_charge,
         payment_method = case when v_charge > 0 then coalesce(p_method, 'cash') end,
         payment_ref    = case when v_charge > 0 then nullif(btrim(coalesce(p_payment_ref, '')), '') end
   where id = v_e.id;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (p_actor, 'drifter.handed_over', 'drifter_entry', v_e.id::text,
          jsonb_build_object('drifter', v_e.drifter_name, 'team', v_e.team_name, 'bands', v_e.band_count,
                             'rules_ack_at', v_e.rules_ack_at, 'charge_centavos', v_charge,
                             'method', case when v_charge > 0 then coalesce(p_method, 'cash') end,
                             'payment_ref', case when v_charge > 0 then nullif(btrim(coalesce(p_payment_ref, '')), '') end));

  return v_r;
end $$;
revoke execute on function public.hand_over_drifter_entry(uuid, uuid, payment_method, boolean, text) from public, anon, authenticated;
