-- Gate shifts and safer taps (2026-10-05). Discrepancies at the gate surface at
-- closing, when the cash and the bands left are counted and nobody can say whose
-- count is off. Two changes:
--
-- 1. Shifts. A staff member opens a shift (starting cash and the bands they were
--    handed per label) before selling, and closes it with what they count. Every
--    gate sale belongs to the seller's open shift, so the close compares counted
--    against expected for that one person: cash = starting + cash sales; bands
--    left = received - sold. The result is stored with the shift.
--
-- 2. Safer taps.
--    * client_ref: the device sends a fresh id per sale and the same id on a
--      retry, so a sale that went through on a slow connection is not recorded
--      twice when the staff member taps again.
--    * undo_walkin_sale reverses exactly one sale (same bands, shirt, name,
--      plate, method, shift), once, within a few minutes, by its seller or an
--      admin. The Walk-in tab offers it for ten seconds after each sale.
--    * GCash, Maya and GoTyme sales need the reference number.
--    record_walkin now returns {count, sale_id, duplicate} instead of the count.

-- ------------------------------------------------------------------ shifts
create table if not exists gate_shifts (
  id                    uuid primary key default gen_random_uuid(),
  event_id              uuid not null references events(id) on delete cascade,
  staff_id              uuid not null references staff(id),
  opened_at             timestamptz not null default now(),
  opening_cash_centavos integer not null default 0 check (opening_cash_centavos >= 0),
  -- ticket_type_id -> bands handed to this person at the start
  opening_bands         jsonb not null default '{}'::jsonb,
  closed_at             timestamptz,
  closed_by             uuid references staff(id),
  counted_cash_centavos integer check (counted_cash_centavos >= 0),
  -- ticket_type_id -> bands this person still had at the close
  counted_bands         jsonb,
  -- the reconciliation computed at the close
  result                jsonb,
  note                  text
);
create unique index if not exists gate_shifts_one_open on gate_shifts (staff_id) where closed_at is null;
create index if not exists gate_shifts_event_idx on gate_shifts (event_id, opened_at desc);

alter table gate_shifts enable row level security;
drop policy if exists "staff read shifts" on gate_shifts;
create policy "staff read shifts" on gate_shifts for select using (is_staff());

alter table walkin_sales
  add column if not exists shift_id   uuid references gate_shifts(id),
  add column if not exists client_ref uuid,
  add column if not exists reverses   uuid references walkin_sales(id);
create unique index if not exists walkin_sales_client_ref_key on walkin_sales (client_ref) where client_ref is not null;
create unique index if not exists walkin_sales_reverses_key   on walkin_sales (reverses)   where reverses is not null;
create index if not exists walkin_sales_shift_idx on walkin_sales (shift_id) where shift_id is not null;

-- ------------------------------------------------------------------ open
create or replace function open_gate_shift(
  p_actor         uuid,
  p_event_id      uuid,
  p_opening_cash  integer,
  p_opening_bands jsonb
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id   uuid;
  v_key  text;
  v_val  jsonb;
  v_n    integer;
  v_clean jsonb := '{}'::jsonb;
begin
  if not exists (select 1 from staff where id = p_actor and active) then raise exception 'Not on the staff list'; end if;
  if exists (select 1 from gate_shifts where staff_id = p_actor and closed_at is null) then
    raise exception 'You already have a shift open. Close it before opening another.';
  end if;
  if p_opening_cash is null or p_opening_cash < 0 or p_opening_cash > 100000000 then
    raise exception 'Enter the starting cash (0 if none)';
  end if;

  for v_key, v_val in select * from jsonb_each(coalesce(p_opening_bands, '{}'::jsonb)) loop
    if not exists (select 1 from ticket_types t where t.id::text = v_key and t.event_id = p_event_id and t.active and t.sell_at_gate and not t.drifter_family) then
      raise exception 'Unknown gate label in the band count';
    end if;
    if jsonb_typeof(v_val) <> 'number' then raise exception 'Band counts must be whole numbers'; end if;
    v_n := (v_val #>> '{}')::numeric::integer;
    if v_n < 0 or v_n > 100000 or (v_val #>> '{}')::numeric <> v_n then raise exception 'Band counts must be whole numbers'; end if;
    v_clean := v_clean || jsonb_build_object(v_key, v_n);
  end loop;

  insert into gate_shifts (event_id, staff_id, opening_cash_centavos, opening_bands)
  values (p_event_id, p_actor, p_opening_cash, v_clean)
  returning id into v_id;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (p_actor, 'gate_shift.opened', 'gate_shift', v_id::text,
          jsonb_build_object('opening_cash_centavos', p_opening_cash, 'opening_bands', v_clean));
  return v_id;
end $$;
revoke execute on function public.open_gate_shift(uuid, uuid, integer, jsonb) from public, anon, authenticated;

-- ------------------------------------------------------------------ the numbers of one shift
create or replace function gate_shift_figures(p_shift_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with s as (select * from gate_shifts where id = p_shift_id),
  sold as (
    select w.ticket_type_id,
           sum(w.qty)                                 as bands,
           sum(w.qty - w.free_qty)                    as sales,
           sum((w.qty - w.free_qty) * w.unit_price_centavos) as amount
      from walkin_sales w where w.shift_id = p_shift_id group by 1),
  by_method as (
    select w.payment_method::text as method,
           sum((w.qty - w.free_qty) * w.unit_price_centavos) as amount,
           count(*) filter (where w.qty > 0 and w.reverses is null) as sales
      from walkin_sales w where w.shift_id = p_shift_id group by 1),
  labels as (
    select t.id, t.code, coalesce(t.walkin_name, t.name) as name, t.band_color, t.sort_order
      from ticket_types t, s
     where t.event_id = s.event_id and t.active and t.sell_at_gate and not t.drifter_family
       and ((s.opening_bands ? t.id::text) or exists (select 1 from sold where sold.ticket_type_id = t.id)
            or (s.counted_bands is not null and s.counted_bands ? t.id::text)))
  select jsonb_build_object(
    'opening_cash_centavos', s.opening_cash_centavos,
    'cash_sales_centavos', coalesce((select amount from by_method where method = 'cash'), 0),
    'expected_cash_centavos', s.opening_cash_centavos + coalesce((select amount from by_method where method = 'cash'), 0),
    'methods', coalesce((select jsonb_object_agg(method, jsonb_build_object('amount_centavos', amount, 'sales', sales)) from by_method), '{}'::jsonb),
    'total_centavos', coalesce((select sum(amount) from by_method), 0),
    'labels', coalesce((select jsonb_agg(jsonb_build_object(
        'ticket_type_id', l.id, 'code', l.code, 'name', l.name, 'band_color', l.band_color,
        'received', (s.opening_bands ->> l.id::text)::integer,
        'sold_bands', coalesce(so.bands, 0), 'sales', coalesce(so.sales, 0), 'amount_centavos', coalesce(so.amount, 0),
        'expected_left', case when s.opening_bands ? l.id::text then (s.opening_bands ->> l.id::text)::integer - coalesce(so.bands, 0) end
      ) order by l.sort_order) from labels l left join sold so on so.ticket_type_id = l.id), '[]'::jsonb)
  ) from s;
$$;
revoke execute on function public.gate_shift_figures(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------ close
create or replace function close_gate_shift(
  p_actor         uuid,
  p_shift_id      uuid,
  p_counted_cash  integer,
  p_counted_bands jsonb,
  p_note          text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_s      gate_shifts%rowtype;
  v_admin  boolean;
  v_fig    jsonb;
  v_label  jsonb;
  v_labels jsonb := '[]'::jsonb;
  v_counted integer;
  v_clean  jsonb := '{}'::jsonb;
  v_key    text;
  v_val    jsonb;
  v_n      integer;
  v_result jsonb;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into v_s from gate_shifts where id = p_shift_id for update;
  if not found then raise exception 'That shift does not exist'; end if;
  if v_s.closed_at is not null then raise exception 'That shift is already closed'; end if;
  select exists (select 1 from staff where id = p_actor and active and role = 'admin') into v_admin;
  if p_actor <> v_s.staff_id and not v_admin then raise exception 'Only the person on the shift or an admin can close it'; end if;
  if p_counted_cash is null or p_counted_cash < 0 or p_counted_cash > 100000000 then raise exception 'Enter the cash you counted'; end if;
  if length(coalesce(v_note, '')) > 500 then raise exception 'The note is too long'; end if;

  for v_key, v_val in select * from jsonb_each(coalesce(p_counted_bands, '{}'::jsonb)) loop
    if jsonb_typeof(v_val) <> 'number' then raise exception 'Band counts must be whole numbers'; end if;
    v_n := (v_val #>> '{}')::numeric::integer;
    if v_n < 0 or v_n > 100000 or (v_val #>> '{}')::numeric <> v_n then raise exception 'Band counts must be whole numbers'; end if;
    v_clean := v_clean || jsonb_build_object(v_key, v_n);
  end loop;

  -- Every label handed out at the start has to be counted back.
  for v_key in select jsonb_object_keys(v_s.opening_bands) loop
    if not (v_clean ? v_key) then raise exception 'Count the bands left for every label you received'; end if;
  end loop;

  update gate_shifts set counted_bands = v_clean where id = p_shift_id;
  v_fig := gate_shift_figures(p_shift_id);

  for v_label in select * from jsonb_array_elements(v_fig -> 'labels') loop
    v_counted := (v_clean ->> (v_label ->> 'ticket_type_id'))::integer;
    v_labels := v_labels || jsonb_build_array(v_label || jsonb_build_object(
      'counted_left', v_counted,
      'difference', case when v_counted is not null and v_label ? 'expected_left' and (v_label ->> 'expected_left') is not null
                         then v_counted - (v_label ->> 'expected_left')::integer end));
  end loop;

  v_result := v_fig || jsonb_build_object(
    'labels', v_labels,
    'counted_cash_centavos', p_counted_cash,
    'cash_difference_centavos', p_counted_cash - (v_fig ->> 'expected_cash_centavos')::integer);

  update gate_shifts
     set closed_at = now(), closed_by = p_actor, counted_cash_centavos = p_counted_cash, result = v_result, note = v_note
   where id = p_shift_id;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (p_actor, 'gate_shift.closed', 'gate_shift', p_shift_id::text,
          jsonb_build_object('staff_id', v_s.staff_id, 'cash_difference_centavos', v_result -> 'cash_difference_centavos',
                             'counted_cash_centavos', p_counted_cash, 'note', v_note));
  return v_result;
end $$;
revoke execute on function public.close_gate_shift(uuid, uuid, integer, jsonb, text) from public, anon, authenticated;

-- ------------------------------------------------------------------ the gate tap
drop function if exists record_walkin(uuid, integer, uuid, payment_method, text, text, text);

create or replace function record_walkin(
  p_ticket_type_id uuid,
  -- sales to record (negative to take back): cars for a label with included
  -- passengers, otherwise bands
  p_qty            integer,
  p_actor          uuid,
  p_method         payment_method,
  -- required for a label that includes a shirt (taken from the sale when a named sale goes back)
  p_shirt_size     text default null,
  -- a label with gate_needs_name: the person's name (sales, and name-only take-backs)
  p_holder_name    text default null,
  -- a car label: the plate (sales and take-backs)
  p_vehicle_plate  text default null,
  -- a fresh id per sale from the device, the same one on a retry
  p_client_ref     uuid default null,
  -- GCash, Maya and GoTyme sales: the transfer's reference number
  p_payment_ref    text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_type     ticket_types%rowtype;
  v_label    text;
  v_price    integer;
  v_per_sale integer;
  v_bands    integer;
  v_free     integer;
  v_avail    record;
  v_size     text := nullif(upper(btrim(coalesce(p_shirt_size, ''))), '');
  v_name     text := nullif(btrim(regexp_replace(coalesce(p_holder_name, ''), '\s+', ' ', 'g')), '');
  v_plate    text := nullif(upper(btrim(regexp_replace(coalesce(p_vehicle_plate, ''), '\s+', ' ', 'g'))), '');
  v_ref      text := nullif(btrim(coalesce(p_payment_ref, '')), '');
  v_method   payment_method := coalesce(p_method, 'cash');
  v_key      text;
  v_named    boolean;
  v_count    bigint;
  v_size_net bigint;
  v_net      bigint;
  v_order_no integer;
  v_last     walkin_sales%rowtype;
  v_shift    uuid;
  v_sale     uuid;
begin
  if p_qty is null or p_qty = 0 then raise exception 'Quantity must not be zero'; end if;
  perform pg_advisory_xact_lock(hashtext(p_ticket_type_id::text));

  -- A retry of a sale that already went through: answer again, record nothing.
  if p_client_ref is not null then
    select id into v_sale from walkin_sales where client_ref = p_client_ref;
    if found then
      select coalesce(sum(qty), 0) into v_count from walkin_sales where ticket_type_id = p_ticket_type_id;
      return jsonb_build_object('count', v_count, 'sale_id', v_sale, 'duplicate', true);
    end if;
  end if;

  select * into v_type from ticket_types where id = p_ticket_type_id and active;
  if not found then raise exception 'Unknown or inactive ticket type'; end if;
  v_label := coalesce(v_type.walkin_name, v_type.name);
  if v_type.drifter_family then raise exception 'Record % bands on the Drifters tab', v_type.name; end if;
  if not v_type.sell_at_gate then raise exception '% is not sold at the gate', v_label; end if;

  -- Every staff sale belongs to the seller's open shift.
  if p_actor is not null then
    select id into v_shift from gate_shifts where staff_id = p_actor and closed_at is null;
    if not found then raise exception 'Open your shift first: starting cash and bands received, at the top of the Walk-in tab.'; end if;
  end if;

  v_price    := coalesce(v_type.walkin_price_centavos, v_type.price_centavos);
  v_per_sale := 1 + greatest(coalesce(v_type.included_companions, 0), 0);
  v_bands    := p_qty * v_per_sale;
  v_free     := p_qty * (v_per_sale - 1);
  v_named    := v_type.requires_vehicle or v_type.gate_needs_name;

  if p_qty > 0 and v_method <> 'cash' then
    if v_ref is null or length(v_ref) < 4 then
      raise exception 'Enter the % reference number for this sale', upper(v_method::text);
    end if;
    if length(v_ref) > 60 then raise exception 'That reference number is too long'; end if;
  end if;
  if v_method = 'cash' then v_ref := null; end if;

  if v_type.requires_vehicle then
    if abs(p_qty) <> 1 then raise exception 'Record one car at a time for %', v_label; end if;
    v_key := regexp_replace(coalesce(v_plate, ''), '[^A-Z0-9]', '', 'g');
    if length(v_key) < 3 then raise exception 'Enter the car''s plate number'; end if;
    if length(v_plate) > 20 then raise exception 'That plate number is too long'; end if;

    select coalesce(sum(qty - free_qty), 0) into v_net
      from walkin_sales
     where ticket_type_id = p_ticket_type_id and vehicle_plate is not null
       and regexp_replace(upper(vehicle_plate), '[^A-Z0-9]', '', 'g') = v_key;

    if p_qty > 0 then
      if v_name is null or length(v_name) < 2 then raise exception 'Enter the driver''s name'; end if;
      if length(v_name) > 80 then raise exception 'That name is too long'; end if;
      if v_net > 0 then raise exception '% is already recorded at the gate for %', v_plate, v_label; end if;
      select o.order_no into v_order_no
        from tickets t join orders o on o.id = t.order_id
       where t.ticket_type_id = p_ticket_type_id and t.status in ('issued', 'redeemed') and t.vehicle_plate is not null
         and regexp_replace(upper(t.vehicle_plate), '[^A-Z0-9]', '', 'g') = v_key
       limit 1;
      if found then
        raise exception '% already has a VIP Car Display ticket from online order #%. Scan that ticket instead of selling another.', v_plate, v_order_no;
      end if;
    else
      if v_net < 1 then raise exception 'No gate sale for % to take back', v_plate; end if;
      select * into v_last
        from walkin_sales
       where ticket_type_id = p_ticket_type_id and qty > 0 and vehicle_plate is not null
         and regexp_replace(upper(vehicle_plate), '[^A-Z0-9]', '', 'g') = v_key
       order by created_at desc limit 1;
      v_size  := v_last.shirt_size;
      v_name  := v_last.holder_name;
      v_plate := v_last.vehicle_plate;
    end if;
  elsif v_type.gate_needs_name then
    if abs(p_qty) <> 1 then raise exception 'Record one % at a time', v_label; end if;
    v_plate := null;
    if v_name is null or length(v_name) < 2 then
      raise exception '%', case when p_qty > 0 then 'Enter the name for ' || v_label else 'Pick the name to take back' end;
    end if;
    if length(v_name) > 80 then raise exception 'That name is too long'; end if;
    if p_qty < 0 then
      select coalesce(sum(qty - free_qty), 0) into v_net
        from walkin_sales where ticket_type_id = p_ticket_type_id and lower(holder_name) = lower(v_name);
      if v_net < 1 then raise exception 'No gate sale for % to take back', v_name; end if;
      -- the latest sale under this name whose shirt size has not already gone back
      select w.* into v_last
        from walkin_sales w
       where w.ticket_type_id = p_ticket_type_id and w.qty > 0 and lower(w.holder_name) = lower(v_name)
         and (select coalesce(sum(x.qty - x.free_qty), 0)
                from walkin_sales x
               where x.ticket_type_id = w.ticket_type_id and lower(x.holder_name) = lower(v_name)
                 and x.shirt_size is not distinct from w.shirt_size) > 0
       order by w.created_at desc limit 1;
      v_size := v_last.shirt_size;
      v_name := v_last.holder_name;
    end if;
  else
    v_name := null;
    v_plate := null;
  end if;

  if v_type.includes_shirt then
    if v_size is null then raise exception 'Pick the shirt size handed over with %', v_label; end if;
    if v_size not in ('2XS','XS','S','M','L','XL','2XL','3XL','4XL','5XL','6XL','7XL','8XL') then
      raise exception 'Unknown shirt size %', v_size;
    end if;
  else
    v_size := null;
  end if;

  select coalesce(sum(qty), 0) into v_count from walkin_sales where ticket_type_id = p_ticket_type_id;

  if p_qty > 0 then
    if v_price <= 0 then raise exception 'Set the walk-in price for % (%) first', v_label, v_type.band_color; end if;
    select pool_sellable, online_cap, cap_used into v_avail from v_ticket_type_availability where ticket_type_id = p_ticket_type_id;
    if v_avail.pool_sellable < v_bands then
      raise exception 'Only % wristband(s) left for % (%)', greatest(v_avail.pool_sellable, 0), v_label, v_type.band_color;
    end if;
    if v_avail.online_cap is not null and v_avail.online_cap - v_avail.cap_used < p_qty then
      raise exception 'Only % left for % (limit of %)', greatest(v_avail.online_cap - v_avail.cap_used, 0), v_label, v_avail.online_cap;
    end if;
  else
    if v_count + v_bands < 0 then raise exception 'Nothing left to take back for %', v_label; end if;
    if v_size is not null and not v_named then
      select coalesce(sum(qty - free_qty), 0) into v_size_net
        from walkin_sales where ticket_type_id = p_ticket_type_id and shirt_size = v_size;
      if v_size_net + p_qty < 0 then raise exception 'No % shirt sale to take back for %', v_size, v_label; end if;
    end if;
  end if;

  insert into walkin_sales (event_id, ticket_type_id, qty, free_qty, unit_price_centavos, payment_method, sold_by,
                            shirt_size, holder_name, vehicle_plate, payment_ref, shift_id, client_ref)
  values (v_type.event_id, p_ticket_type_id, v_bands, v_free, v_price, v_method, p_actor,
          v_size, v_name, v_plate, v_ref, v_shift, p_client_ref)
  returning id into v_sale;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (p_actor, 'walkin.recorded', 'ticket_type', p_ticket_type_id::text,
          jsonb_build_object('qty', v_bands, 'free', v_free, 'sales', p_qty, 'unit_price_centavos', v_price,
                             'method', v_method, 'payment_ref', v_ref, 'shirt_size', v_size,
                             'holder', v_name, 'plate', v_plate, 'shift_id', v_shift, 'sale_id', v_sale));

  return jsonb_build_object('count', v_count + v_bands, 'sale_id', v_sale, 'duplicate', false);
end $$;
revoke execute on function public.record_walkin(uuid, integer, uuid, payment_method, text, text, text, uuid, text) from public, anon, authenticated;

-- ------------------------------------------------------------------ undo one sale
create or replace function undo_walkin_sale(p_actor uuid, p_sale_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_w     walkin_sales%rowtype;
  v_admin boolean;
  v_id    uuid;
begin
  select * into v_w from walkin_sales where id = p_sale_id;
  if not found then raise exception 'That sale does not exist'; end if;
  perform pg_advisory_xact_lock(hashtext(v_w.ticket_type_id::text));
  select * into v_w from walkin_sales where id = p_sale_id for update;

  if v_w.drifter_name is not null then raise exception 'Drifter bands are corrected on the Drifters tab'; end if;
  if v_w.qty <= 0 or v_w.reverses is not null then raise exception 'Only a sale can be undone'; end if;
  if exists (select 1 from walkin_sales where reverses = p_sale_id) then raise exception 'That sale was already undone'; end if;
  select exists (select 1 from staff where id = p_actor and active and role = 'admin') into v_admin;
  if v_w.sold_by is distinct from p_actor and not v_admin then raise exception 'Only the person who made the sale can undo it'; end if;
  if v_w.created_at < now() - interval '5 minutes' and not v_admin then
    raise exception 'Too late to undo here. Use − on the label to take it back.';
  end if;

  insert into walkin_sales (event_id, ticket_type_id, qty, free_qty, unit_price_centavos, payment_method, sold_by,
                            shirt_size, holder_name, vehicle_plate, payment_ref, shift_id, reverses)
  values (v_w.event_id, v_w.ticket_type_id, -v_w.qty, -v_w.free_qty, v_w.unit_price_centavos, v_w.payment_method, p_actor,
          v_w.shirt_size, v_w.holder_name, v_w.vehicle_plate, v_w.payment_ref, v_w.shift_id, p_sale_id)
  returning id into v_id;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (p_actor, 'walkin.undone', 'ticket_type', v_w.ticket_type_id::text,
          jsonb_build_object('sale_id', p_sale_id, 'reversal_id', v_id, 'qty', v_w.qty, 'free', v_w.free_qty,
                             'shirt_size', v_w.shirt_size, 'holder', v_w.holder_name, 'plate', v_w.vehicle_plate));
  return jsonb_build_object('reversal_id', v_id, 'qty', v_w.qty, 'free', v_w.free_qty);
end $$;
revoke execute on function public.undo_walkin_sale(uuid, uuid) from public, anon, authenticated;
