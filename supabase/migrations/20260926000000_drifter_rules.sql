-- Drifter wristband rules, from the organizer (2026-09-26).
--
--   * the label is for the whole team, not just family: "Drifter, Family & Friends"
--   * six free bands per drifter, up from four
--   * everyone inside the area must wear a band or be asked to leave, and the
--     drifter has to confirm they understand that before staff hand any over
--
-- The confirmation is enforced here, not only in the form: a hand-out without it
-- is refused, and the acknowledgement is stored on the row so the audit trail can
-- show who agreed to what.

update ticket_types set
  name = 'Drifter, Family & Friends',
  free_allowance = 6,
  description = 'Wristbands for a competing drifter and their team - family, friends, pit crew, spotter, manager and other team staff. Six per drifter are free; extra bands are charged at the gate price. Everyone inside the drifter area must wear one.'
where code = 'D';

alter table walkin_sales
  -- the drifter confirmed the rules in front of staff before taking the bands
  add column if not exists rules_ack boolean not null default false;

drop function if exists record_drifter_bands(uuid, text, integer, uuid, payment_method);

create or replace function record_drifter_bands(
  p_ticket_type_id uuid,
  p_drifter_name   text,
  p_qty            integer,
  p_actor          uuid,
  p_method         payment_method,
  p_rules_ack      boolean default false
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_type     ticket_types%rowtype;
  v_name     text;
  v_existing text;
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

  insert into walkin_sales (event_id, ticket_type_id, drifter_name, qty, free_qty, unit_price_centavos, payment_method, sold_by, rules_ack)
  values (v_type.event_id, p_ticket_type_id, v_name, p_qty, v_free, v_price, coalesce(p_method, 'cash'), p_actor, coalesce(p_rules_ack, false));

  insert into audit_log (actor, action, entity, entity_id, data)
  values (p_actor, 'drifter.bands', 'ticket_type', p_ticket_type_id::text,
          jsonb_build_object('drifter', v_name, 'qty', p_qty, 'free', v_free, 'paid', v_paid,
                             'unit_price_centavos', v_price, 'method', coalesce(p_method, 'cash'),
                             'rules_ack', coalesce(p_rules_ack, false)));

  return jsonb_build_object(
    'drifter_name', v_name,
    'total', v_after,
    'free', v_free,
    'paid', v_paid,
    'charge_centavos', greatest(v_paid, 0) * v_price
  );
end $$;
revoke execute on function public.record_drifter_bands(uuid, text, integer, uuid, payment_method, boolean) from public, anon, authenticated;
