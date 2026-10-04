-- Gate sales of a car label take the driver's name and the plate number (2026-10-05).
--
-- Applies to labels with requires_vehicle (VIP Car Display, sold at the gate as
-- "VIP Car with shirt (2 pax)"). One car per tap. The plate keeps the gate list
-- honest:
--   * a plate already recorded at the gate cannot be sold again;
--   * a plate that already has an online VIP Car Display ticket is refused, so a
--     buyer who paid online has their ticket scanned instead of paying twice;
--   * taking a car back names its plate, and the shirt size and name come from
--     the original sale.
-- Plates are compared on letters and digits only ("nbc-8821" = "NBC 8821").

alter table walkin_sales
  add column if not exists holder_name   text,
  add column if not exists vehicle_plate text;

create index if not exists walkin_sales_plate_idx
  on walkin_sales (ticket_type_id, (regexp_replace(upper(vehicle_plate), '[^A-Z0-9]', '', 'g')))
  where vehicle_plate is not null;

drop function if exists record_walkin(uuid, integer, uuid, payment_method, text);

create or replace function record_walkin(
  p_ticket_type_id uuid,
  -- sales to record (negative to take back): cars for a label with included
  -- passengers, otherwise bands
  p_qty            integer,
  p_actor          uuid,
  p_method         payment_method,
  -- required for a label that includes a shirt (taken from the sale when a car goes back)
  p_shirt_size     text default null,
  -- required for a car label: the driver's name (sales) and the plate (sales and take-backs)
  p_holder_name    text default null,
  p_vehicle_plate  text default null
) returns integer
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
  v_key      text;
  v_count    bigint;
  v_size_net bigint;
  v_net      bigint;
  v_order_no integer;
  v_last     walkin_sales%rowtype;
begin
  if p_qty is null or p_qty = 0 then raise exception 'Quantity must not be zero'; end if;
  perform pg_advisory_xact_lock(hashtext(p_ticket_type_id::text));

  select * into v_type from ticket_types where id = p_ticket_type_id and active;
  if not found then raise exception 'Unknown or inactive ticket type'; end if;
  v_label := coalesce(v_type.walkin_name, v_type.name);
  if v_type.drifter_family then raise exception 'Record % bands on the Drifters tab', v_type.name; end if;
  if not v_type.sell_at_gate then raise exception '% is not sold at the gate', v_label; end if;

  v_price    := coalesce(v_type.walkin_price_centavos, v_type.price_centavos);
  v_per_sale := 1 + greatest(coalesce(v_type.included_companions, 0), 0);
  v_bands    := p_qty * v_per_sale;
  v_free     := p_qty * (v_per_sale - 1);

  -- ---------------------------------------------------------------- car details
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
      -- the car goes back exactly as it was sold
      select * into v_last
        from walkin_sales
       where ticket_type_id = p_ticket_type_id and qty > 0 and vehicle_plate is not null
         and regexp_replace(upper(vehicle_plate), '[^A-Z0-9]', '', 'g') = v_key
       order by created_at desc limit 1;
      v_size  := v_last.shirt_size;
      v_name  := v_last.holder_name;
      v_plate := v_last.vehicle_plate;
    end if;
  else
    v_name := null;
    v_plate := null;
  end if;

  -- ---------------------------------------------------------------- shirt
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
    if v_size is not null and not v_type.requires_vehicle then
      select coalesce(sum(qty - free_qty), 0) into v_size_net
        from walkin_sales where ticket_type_id = p_ticket_type_id and shirt_size = v_size;
      if v_size_net + p_qty < 0 then raise exception 'No % shirt sale to take back for %', v_size, v_label; end if;
    end if;
  end if;

  insert into walkin_sales (event_id, ticket_type_id, qty, free_qty, unit_price_centavos, payment_method, sold_by,
                            shirt_size, holder_name, vehicle_plate)
  values (v_type.event_id, p_ticket_type_id, v_bands, v_free, v_price, coalesce(p_method, 'cash'), p_actor,
          v_size, v_name, v_plate);

  insert into audit_log (actor, action, entity, entity_id, data)
  values (p_actor, 'walkin.recorded', 'ticket_type', p_ticket_type_id::text,
          jsonb_build_object('qty', v_bands, 'free', v_free, 'sales', p_qty, 'unit_price_centavos', v_price,
                             'method', coalesce(p_method, 'cash'), 'shirt_size', v_size,
                             'holder', v_name, 'plate', v_plate));

  return (v_count + v_bands)::integer;
end $$;
revoke execute on function public.record_walkin(uuid, integer, uuid, payment_method, text, text, text) from public, anon, authenticated;
