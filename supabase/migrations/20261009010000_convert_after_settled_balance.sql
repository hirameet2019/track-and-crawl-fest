-- A conversion after a settled balance starts that balance from zero (2026-10-09).
--
-- Settling (Admin > Orders > "Mark as settled") only stamps balance_settled_at;
-- the amount stays on the order. convert_order added each new difference to it
-- and cleared the stamp, so a second conversion after the first refund was paid
-- showed the paid amount again: P450 refunded and settled, then another P450
-- change asked for P900, on the admin page and in the buyer's email.
--
-- Now a settled balance counts as done and the new conversion's difference stands
-- on its own. An open (unsettled) balance still adds up, as it should: two P450
-- changes not yet refunded are P900 owed. The settled amount stays in the audit
-- log (order.balance_settled). No order had a settled balance when this shipped.

create or replace function pg_temp.patch_fn(p_fn regprocedure, p_old text, p_new text) returns void
language plpgsql as $$
declare v_def text; v_n integer;
begin
  v_def := pg_get_functiondef(p_fn);
  v_n := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  if v_n <> 1 then raise exception 'Expected one "%" in %, found %', p_old, p_fn, v_n; end if;
  execute replace(v_def, p_old, p_new);
end $$;

-- In an UPDATE every right-hand side reads the row as it was, so this sees the old stamp.
select pg_temp.patch_fn('public.convert_order(uuid, uuid, integer, jsonb, uuid, text, text[], jsonb, uuid[])'::regprocedure,
  $o$balance_centavos   = balance_centavos + (v_out - v_add),$o$,
  $n$balance_centavos   = case when balance_settled_at is null then balance_centavos else 0 end + (v_out - v_add),$n$);
