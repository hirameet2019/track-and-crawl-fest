-- Drift event ticketing: initial schema
-- Money is stored in centavos (integer) to avoid floating point issues.

create extension if not exists pgcrypto;

create type order_status   as enum ('pending_payment','awaiting_verification','paid','rejected','expired','cancelled');
create type order_channel  as enum ('online','onsite','import');
create type payment_method as enum ('gcash','maya','cash');
create type ticket_status  as enum ('issued','redeemed','void');
create type number_status  as enum ('available','assigned','void');
create type staff_role     as enum ('admin','staff','scanner');

-- ---------------------------------------------------------------- events
create table events (
  id                 uuid primary key default gen_random_uuid(),
  slug               text not null unique,
  name               text not null,
  tagline            text,
  venue              text,
  starts_at          timestamptz,
  sales_open_at      timestamptz,
  sales_close_at     timestamptz,               -- PLACEHOLDER until organizer advises cutoff
  -- Receipt / organizer details (printed on the receipt page of the PDF)
  org_name           text not null,
  org_tin            text,
  org_address        text,
  org_vat_registered boolean not null default false,
  receipt_label      text not null default 'ACKNOWLEDGMENT RECEIPT', -- switch to 'OFFICIAL RECEIPT' once BIR-registered
  -- Payment QR images (public URLs or /placeholders/*.png)
  gcash_qr_url       text,
  gcash_account_name text,
  maya_qr_url        text,
  maya_account_name  text,
  refund_policy      text,
  active             boolean not null default true,
  created_at         timestamptz not null default now()
);

-- ---------------------------------------------------------- ticket types
create table ticket_types (
  id                 uuid primary key default gen_random_uuid(),
  event_id           uuid not null references events(id) on delete cascade,
  code               text not null,                 -- short code, e.g. EBA, EBC, VIPS, VIPC
  name               text not null,
  description        text,
  price_centavos     integer not null check (price_centavos >= 0),
  band_color         text,                          -- wristband colour shown to gate staff
  includes_shirt     boolean not null default false,
  includes_lanyard   boolean not null default false,
  includes_sticker   boolean not null default false,
  includes_car_pass  boolean not null default false,
  requires_vehicle   boolean not null default false, -- capture plate + model
  is_child           boolean not null default false,
  sort_order         integer not null default 0,
  active             boolean not null default true,
  unique (event_id, code)
);

-- ----------------------------------------------- ticket number pool
-- Numbers are supplied by the organizer (pre-printed wristband serials).
-- Admins import ranges; the system hands them out in seq order.
create table ticket_numbers (
  id              uuid primary key default gen_random_uuid(),
  ticket_type_id  uuid not null references ticket_types(id) on delete cascade,
  number          text not null,                    -- exactly as printed on the band
  seq             integer not null,                 -- ordering for assignment
  status          number_status not null default 'available',
  void_reason     text,
  created_at      timestamptz not null default now(),
  unique (ticket_type_id, number)
);
create index ticket_numbers_pick_idx on ticket_numbers (ticket_type_id, status, seq);

-- --------------------------------------------------------------- staff
create table staff (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null,
  role       staff_role not null default 'staff',
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- -------------------------------------------------------------- orders
create sequence order_no_seq start 1001;
create sequence receipt_no_seq start 1;

create table orders (
  id                  uuid primary key default gen_random_uuid(),
  event_id            uuid not null references events(id),
  order_no            integer not null default nextval('order_no_seq') unique,
  channel             order_channel not null default 'online',
  status              order_status not null default 'pending_payment',
  buyer_name          text not null,
  buyer_email         text,
  buyer_mobile        text,
  total_centavos      integer not null check (total_centavos >= 0),
  payment_method      payment_method,
  payment_reference   text,                          -- GCash/Maya reference number
  payment_proof_path  text,                          -- storage path in bucket payment-proofs
  proof_submitted_at  timestamptz,
  expires_at          timestamptz,                   -- pending_payment orders past this are expired
  paid_at             timestamptz,
  verified_by         uuid references staff(id),
  verified_at         timestamptz,
  rejection_reason    text,
  sold_by             uuid references staff(id),     -- onsite sales
  receipt_no          integer unique,                -- assigned on issue
  email_sent_at       timestamptz,
  notes               text,
  created_at          timestamptz not null default now()
);
-- One GCash/Maya reference can only ever pay for one order.
create unique index orders_payment_reference_uidx
  on orders (payment_method, payment_reference)
  where payment_reference is not null and status <> 'rejected';
create index orders_status_idx on orders (status, created_at);

create table order_items (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references orders(id) on delete cascade,
  ticket_type_id      uuid not null references ticket_types(id),
  qty                 integer not null check (qty > 0),
  unit_price_centavos integer not null,
  -- per-ticket attributes captured at checkout, one element per ticket in qty order
  attendees           jsonb not null default '[]'::jsonb  -- [{holder_name, shirt_size, vehicle_plate, vehicle_model}]
);

-- ------------------------------------------------------------- tickets
create table tickets (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references orders(id) on delete cascade,
  ticket_type_id   uuid not null references ticket_types(id),
  ticket_number_id uuid not null unique references ticket_numbers(id),
  number           text not null,
  qr_token         text not null unique,
  holder_name      text,
  shirt_size       text,
  vehicle_plate    text,
  vehicle_model    text,
  status           ticket_status not null default 'issued',
  redeemed_at      timestamptz,
  redeemed_by      uuid references staff(id),
  kit_claimed      jsonb not null default '{}'::jsonb, -- {"shirt":true,"lanyard":true,"sticker":true,"car_pass":true}
  created_at       timestamptz not null default now()
);
create index tickets_order_idx on tickets (order_id);

create table audit_log (
  id         bigserial primary key,
  actor      uuid,
  action     text not null,
  entity     text not null,
  entity_id  text,
  data       jsonb,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------- functions

-- Availability = numbers still available minus numbers already promised to
-- unpaid (pending / awaiting verification) orders.
create or replace view v_ticket_type_availability as
select
  tt.id as ticket_type_id,
  tt.event_id,
  tt.code, tt.name, tt.price_centavos, tt.band_color, tt.sort_order, tt.active,
  (select count(*) from ticket_numbers n where n.ticket_type_id = tt.id)                          as pool_total,
  (select count(*) from ticket_numbers n where n.ticket_type_id = tt.id and n.status='available') as pool_available,
  (select count(*) from ticket_numbers n where n.ticket_type_id = tt.id and n.status='assigned')  as sold,
  (select count(*) from ticket_numbers n where n.ticket_type_id = tt.id and n.status='void')      as voided,
  coalesce((select sum(oi.qty) from order_items oi join orders o on o.id = oi.order_id
            where oi.ticket_type_id = tt.id and o.status in ('pending_payment','awaiting_verification')),0) as reserved,
  (select count(*) from ticket_numbers n where n.ticket_type_id = tt.id and n.status='available')
   - coalesce((select sum(oi.qty) from order_items oi join orders o on o.id = oi.order_id
            where oi.ticket_type_id = tt.id and o.status in ('pending_payment','awaiting_verification')),0) as sellable,
  coalesce((select sum(oi.qty * oi.unit_price_centavos) from order_items oi join orders o on o.id = oi.order_id
            where oi.ticket_type_id = tt.id and o.status = 'paid'),0) as revenue_centavos,
  (select count(*) from tickets t where t.ticket_type_id = tt.id and t.status = 'redeemed') as redeemed
from ticket_types tt;

-- Expire unpaid orders whose payment window has closed.
create or replace function expire_stale_orders() returns integer
language plpgsql security definer as $$
declare n integer;
begin
  update orders set status = 'expired'
  where status = 'pending_payment' and expires_at is not null and expires_at < now();
  get diagnostics n = row_count;
  return n;
end $$;

-- Create an order with items, enforcing availability under a per-type lock.
-- p_items: [{ticket_type_id, qty, attendees:[...]}]
create or replace function create_order(
  p_event_id uuid,
  p_channel order_channel,
  p_buyer_name text,
  p_buyer_email text,
  p_buyer_mobile text,
  p_items jsonb,
  p_expires_minutes integer,
  p_sold_by uuid default null
) returns uuid
language plpgsql security definer as $$
declare
  v_order_id uuid;
  v_total integer := 0;
  v_item jsonb;
  v_type ticket_types%rowtype;
  v_sellable bigint;
  v_qty integer;
begin
  perform expire_stale_orders();

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'No tickets selected';
  end if;

  -- Lock each involved ticket type so concurrent buyers cannot oversell.
  for v_item in select * from jsonb_array_elements(p_items) loop
    perform pg_advisory_xact_lock(hashtext((v_item->>'ticket_type_id')));
  end loop;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'qty')::int;
    if v_qty is null or v_qty <= 0 then raise exception 'Invalid quantity'; end if;
    select * into v_type from ticket_types where id = (v_item->>'ticket_type_id')::uuid and active;
    if not found then raise exception 'Unknown or inactive ticket type'; end if;
    select sellable into v_sellable from v_ticket_type_availability where ticket_type_id = v_type.id;
    if v_sellable < v_qty then
      raise exception 'Only % left for %', greatest(v_sellable,0), v_type.name;
    end if;
    v_total := v_total + v_qty * v_type.price_centavos;
  end loop;

  insert into orders (event_id, channel, buyer_name, buyer_email, buyer_mobile, total_centavos, expires_at, sold_by)
  values (p_event_id, p_channel, p_buyer_name, p_buyer_email, p_buyer_mobile, v_total,
          case when p_channel = 'online' then now() + make_interval(mins => p_expires_minutes) end,
          p_sold_by)
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_type from ticket_types where id = (v_item->>'ticket_type_id')::uuid;
    insert into order_items (order_id, ticket_type_id, qty, unit_price_centavos, attendees)
    values (v_order_id, v_type.id, (v_item->>'qty')::int, v_type.price_centavos, coalesce(v_item->'attendees','[]'::jsonb));
  end loop;

  return v_order_id;
end $$;

-- Mark order paid, pull wristband numbers from the pool, create tickets, assign receipt no.
-- p_tokens: array of pre-generated QR tokens, at least as many as tickets to issue.
create or replace function issue_order_tickets(
  p_order_id uuid,
  p_actor uuid,
  p_payment_method payment_method,
  p_payment_reference text,
  p_tokens text[]
) returns setof tickets
language plpgsql security definer as $$
declare
  v_order orders%rowtype;
  v_item order_items%rowtype;
  v_num ticket_numbers%rowtype;
  v_ticket tickets%rowtype;
  v_i integer;
  v_tok integer := 1;
  v_att jsonb;
begin
  select * into v_order from orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.status = 'paid' then raise exception 'Order already paid'; end if;
  if v_order.status in ('rejected','cancelled') then raise exception 'Order is %', v_order.status; end if;

  for v_item in select * from order_items where order_id = p_order_id loop
    perform pg_advisory_xact_lock(hashtext(v_item.ticket_type_id::text));
    for v_i in 1..v_item.qty loop
      select * into v_num from ticket_numbers
        where ticket_type_id = v_item.ticket_type_id and status = 'available'
        order by seq for update skip locked limit 1;
      if not found then raise exception 'No wristband numbers left for this ticket type'; end if;

      v_att := coalesce(v_item.attendees -> (v_i - 1), '{}'::jsonb);

      insert into tickets (order_id, ticket_type_id, ticket_number_id, number, qr_token,
                           holder_name, shirt_size, vehicle_plate, vehicle_model)
      values (p_order_id, v_item.ticket_type_id, v_num.id, v_num.number, p_tokens[v_tok],
              coalesce(v_att->>'holder_name', v_order.buyer_name),
              v_att->>'shirt_size', v_att->>'vehicle_plate', v_att->>'vehicle_model')
      returning * into v_ticket;

      update ticket_numbers set status = 'assigned' where id = v_num.id;
      v_tok := v_tok + 1;
      return next v_ticket;
    end loop;
  end loop;

  update orders set
    status = 'paid',
    paid_at = now(),
    payment_method = coalesce(p_payment_method, payment_method),
    payment_reference = coalesce(p_payment_reference, payment_reference),
    verified_by = p_actor,
    verified_at = now(),
    receipt_no = nextval('receipt_no_seq')
  where id = p_order_id;

  insert into audit_log (actor, action, entity, entity_id) values (p_actor, 'order.issued', 'order', p_order_id::text);
  return;
end $$;

-- Import a contiguous range of pre-printed numbers, e.g. prefix 'VIP-', 1..500, pad 4 => VIP-0001..VIP-0500
create or replace function import_number_range(
  p_ticket_type_id uuid, p_prefix text, p_start integer, p_end integer, p_pad integer
) returns integer
language plpgsql security definer as $$
declare n integer;
begin
  insert into ticket_numbers (ticket_type_id, number, seq)
  select p_ticket_type_id, coalesce(p_prefix,'') || lpad(g::text, greatest(p_pad, length(p_end::text)), '0'), g
  from generate_series(p_start, p_end) g
  on conflict (ticket_type_id, number) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Redeem at gate. Returns a result code plus the ticket id.
create or replace function redeem_ticket(p_token text, p_actor uuid)
returns table (result text, ticket_id uuid)
language plpgsql security definer as $$
declare v tickets%rowtype;
begin
  select * into v from tickets where qr_token = p_token for update;
  if not found then return query select 'not_found'::text, null::uuid; return; end if;
  if v.status = 'void' then return query select 'void'::text, v.id; return; end if;
  if v.status = 'redeemed' then return query select 'already_redeemed'::text, v.id; return; end if;
  update tickets set status = 'redeemed', redeemed_at = now(), redeemed_by = p_actor where id = v.id;
  insert into audit_log (actor, action, entity, entity_id) values (p_actor, 'ticket.redeemed', 'ticket', v.id::text);
  return query select 'ok'::text, v.id;
end $$;

-- ------------------------------------------------------------------ RLS
alter table events         enable row level security;
alter table ticket_types   enable row level security;
alter table ticket_numbers enable row level security;
alter table staff          enable row level security;
alter table orders         enable row level security;
alter table order_items    enable row level security;
alter table tickets        enable row level security;
alter table audit_log      enable row level security;

create or replace function is_staff() returns boolean language sql stable security definer as $$
  select exists (select 1 from staff where id = auth.uid() and active);
$$;

-- Public may read active events and ticket types. Everything else is staff-only
-- for reads; all writes go through the service role in server actions.
create policy "public read events"       on events         for select using (active);
create policy "public read ticket types" on ticket_types   for select using (active);
create policy "staff read numbers"       on ticket_numbers for select using (is_staff());
create policy "staff read staff"         on staff          for select using (is_staff());
create policy "staff read orders"        on orders         for select using (is_staff());
create policy "staff read items"         on order_items    for select using (is_staff());
create policy "staff read tickets"       on tickets        for select using (is_staff());
create policy "staff read audit"         on audit_log      for select using (is_staff());

-- Storage buckets: private payment screenshots, public event assets (QR images, logo)
insert into storage.buckets (id, name, public) values ('payment-proofs','payment-proofs', false)
on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('event-assets','event-assets', true)
on conflict (id) do nothing;
