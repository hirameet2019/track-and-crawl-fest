-- Drifter family records corrected to six free bands each (2026-10-13).
--
-- The organizer confirmed these were recording mistakes and that no money was
-- received for them: every competing drifter gets six free bands, nothing paid.
--   * Four gate entries on the Drifters tab are set to 6 bands, 6 free (they read
--     16 = 6 free + 10 paid PHP 1,500; 15 = 6 free + 9 paid PHP 1,350; 4 free;
--     5 free).
--   * Order #49 (converted to 12 Drifter Family tickets at PHP 150, "paid" by
--     GoTyme, PHP 50 balance) keeps 6 tickets, D-0001 to D-0006, at PHP 0. The
--     other 6 are voided and their bands go back to the stack; the order total and
--     balance become 0.
-- Every change writes an audit_log row with the record before and after. A full
-- copy of the records beforehand is in exports/backup on the IT machine.
--
-- Guarded: a row that is missing is skipped (a fresh database); a row that no
-- longer holds the values it was corrected from stops the whole change.

do $fix$
declare
  v_reason text := 'Recording mistake confirmed by the organizer: drifter family bands are free, 6 per drifter, and no payment was received.';
  v_row walkin_sales%rowtype;
  v_fix record;
  v_order orders%rowtype;
  v_item order_items%rowtype;
  v_drop uuid[] := array['1ee9348a-b5aa-4fe3-8aa0-e2a1182b0658', '5446cc06-b965-473d-a8de-22ac70b8ad51', '176b64db-bb87-4974-85d4-91635dc7335b',
                         '7a09989d-aa4f-482a-9658-d5af764fafad', '9623eaf8-a0b8-40a9-b32c-729fdf51bd71', 'feadb39d-6a43-4c30-b1a9-29af81a0ef03']::uuid[];
  v_keep_atts jsonb;
  v_before jsonb;
begin
  -- Gate entries on the Drifters tab: (id, qty and free it must still hold).
  for v_fix in select * from (values
      ('cb875c07-dba3-4893-a9d1-ba1d08906e4c'::uuid, 16, 6),
      ('7507fe46-cbef-4d1d-a773-c6e2c5ee5b60'::uuid, 15, 6),
      ('b98c80d3-2617-462f-867e-4453f3b6f0a0'::uuid, 4, 4),
      ('e67d4cc0-c03d-4298-a961-da18a3f7c651'::uuid, 5, 5)) as f(id, qty, free) loop
    select * into v_row from walkin_sales where id = v_fix.id for update;
    if not found then continue; end if;
    if v_row.qty <> v_fix.qty or v_row.free_qty <> v_fix.free then
      raise exception 'Drifter entry % now holds % bands (% free), not % (% free): stopping', v_fix.id, v_row.qty, v_row.free_qty, v_fix.qty, v_fix.free;
    end if;
    update walkin_sales set qty = 6, free_qty = 6 where id = v_fix.id;
    insert into audit_log (actor, action, entity, entity_id, data)
    values (null, 'drifter.corrected', 'walkin_sale', v_fix.id::text,
            jsonb_build_object('reason', v_reason, 'before', to_jsonb(v_row), 'after', jsonb_build_object('qty', 6, 'free_qty', 6)));
  end loop;

  -- Order #49: six free Drifter Family tickets.
  select * into v_order from orders where id = '1390d228-b040-4093-a739-cb73e84935c1' for update;
  if found then
    select * into v_item from order_items where id = '910ae60c-b82d-4a09-8092-5a7de7153cee' for update;
    if v_order.total_centavos <> 180000 or v_order.balance_centavos <> 5000 or v_item.qty <> 12 or v_item.unit_price_centavos <> 15000
       or (select count(*) from tickets where id = any(v_drop) and order_id = v_order.id and status = 'issued' and ticket_number_id is not null) <> 6 then
      raise exception 'Order #49 is no longer as it was (total %, balance %, line % x %): stopping', v_order.total_centavos, v_order.balance_centavos, v_item.qty, v_item.unit_price_centavos;
    end if;
    v_before := jsonb_build_object('order', to_jsonb(v_order), 'line', to_jsonb(v_item),
      'voided', (select jsonb_agg(jsonb_build_object('id', id, 'number', number, 'holder', holder_name) order by number) from tickets where id = any(v_drop)));

    -- The six extra bands go back to the stack, the way a conversion releases them.
    update ticket_numbers set status = 'available', void_reason = null
     where id in (select ticket_number_id from tickets where id = any(v_drop));
    update tickets
       set status = 'void', ticket_number_id = null, void_reason = 'Corrected: ' || v_reason, voided_at = now(), voided_by = null
     where id = any(v_drop);

    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('holder_name', holder_name)) order by number) into v_keep_atts
      from tickets where order_id = v_order.id and ticket_type_id = v_item.ticket_type_id and ticket_number_id is not null;
    update order_items set qty = 6, unit_price_centavos = 0, attendees = coalesce(v_keep_atts, '[]'::jsonb) where id = v_item.id;
    update orders
       set total_centavos = 0, balance_centavos = 0, balance_settled_at = null,
           balance_note = 'Corrected 13 Oct 2026: no payment was received; drifter family bands are free, 6 per drifter.'
     where id = v_order.id;
    insert into audit_log (actor, action, entity, entity_id, data)
    values (null, 'order.corrected', 'order', v_order.id::text,
            jsonb_build_object('order_no', v_order.order_no, 'reason', v_reason, 'before', v_before,
                               'after', jsonb_build_object('total_centavos', 0, 'balance_centavos', 0, 'line', jsonb_build_object('qty', 6, 'unit_price_centavos', 0))));
  end if;
end $fix$;
