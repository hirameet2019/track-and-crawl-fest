-- Custom online payment channels (Admin > Settings > Payments > More payment channels).
--
-- GoTyme, GCash and Maya stay as they are. Any channel an admin adds in Settings
-- (a bank transfer, another e-wallet) is recorded on the order as payment_method
-- 'other', with the channel's id and its name at the moment of payment, so the
-- record still reads right if the channel is renamed or removed later.
--
-- Additive only: one new enum value and two nullable columns. No existing row,
-- function or policy changes, so it is safe while registration is live.
--
-- Run the two statements separately in the Supabase SQL editor (or with
-- `supabase db push`): Postgres will not let a new enum value be used in the same
-- transaction that adds it, and the editor runs a whole paste as one.

alter type payment_method add value if not exists 'other';

alter table orders
  add column if not exists payment_channel       text,
  add column if not exists payment_channel_label text;

comment on column orders.payment_channel is 'Settings id of the channel the buyer paid with (gotyme, gcash, maya, or a custom channel id).';
comment on column orders.payment_channel_label is 'That channel''s name when the proof was submitted, e.g. "BPI bank transfer".';
