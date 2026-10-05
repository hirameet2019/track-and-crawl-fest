-- Remove gate shifts (2026-10-05). The organizer does not want the open-shift
-- step at the gate, so selling no longer needs a shift, and the shift table and
-- its functions go. Nothing was recorded in them.
--
-- The safer taps from 20261005040000 stay: client_ref (a retry never records a
-- sale twice), undo_walkin_sale, the e-wallet reference number, and
-- record_walkin returning {count, sale_id, duplicate}.

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
                            shirt_size, holder_name, vehicle_plate, payment_ref, client_ref)
  values (v_type.event_id, p_ticket_type_id, v_bands, v_free, v_price, v_method, p_actor,
          v_size, v_name, v_plate, v_ref, p_client_ref)
  returning id into v_sale;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (p_actor, 'walkin.recorded', 'ticket_type', p_ticket_type_id::text,
          jsonb_build_object('qty', v_bands, 'free', v_free, 'sales', p_qty, 'unit_price_centavos', v_price,
                             'method', v_method, 'payment_ref', v_ref, 'shirt_size', v_size,
                             'holder', v_name, 'plate', v_plate, 'sale_id', v_sale));

  return jsonb_build_object('count', v_count + v_bands, 'sale_id', v_sale, 'duplicate', false);
end $$;
revoke execute on function public.record_walkin(uuid, integer, uuid, payment_method, text, text, text, uuid, text) from public, anon, authenticated;

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
                            shirt_size, holder_name, vehicle_plate, payment_ref, reverses)
  values (v_w.event_id, v_w.ticket_type_id, -v_w.qty, -v_w.free_qty, v_w.unit_price_centavos, v_w.payment_method, p_actor,
          v_w.shirt_size, v_w.holder_name, v_w.vehicle_plate, v_w.payment_ref, p_sale_id)
  returning id into v_id;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (p_actor, 'walkin.undone', 'ticket_type', v_w.ticket_type_id::text,
          jsonb_build_object('sale_id', p_sale_id, 'reversal_id', v_id, 'qty', v_w.qty, 'free', v_w.free_qty,
                             'shirt_size', v_w.shirt_size, 'holder', v_w.holder_name, 'plate', v_w.vehicle_plate));
  return jsonb_build_object('reversal_id', v_id, 'qty', v_w.qty, 'free', v_w.free_qty);
end $$;
revoke execute on function public.undo_walkin_sale(uuid, uuid) from public, anon, authenticated;

drop function if exists open_gate_shift(uuid, uuid, integer, jsonb);
drop function if exists close_gate_shift(uuid, uuid, integer, jsonb, text);
drop function if exists gate_shift_figures(uuid);

alter table walkin_sales drop column if exists shift_id;
drop table if exists gate_shifts;
