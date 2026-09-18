-- GoTyme Bank (InstaPay QR) as a payment channel.
--
-- Schema only. The events row is updated separately (see README > Payment
-- channels) because a new enum value cannot be used in the same transaction
-- that adds it. Which channels the buyer sees is driven by which *_qr_url
-- columns are non-null, so switching channels on/off is a data change, not a
-- deploy.
alter type payment_method add value if not exists 'gotyme';

alter table events
  add column if not exists gotyme_qr_url       text,
  add column if not exists gotyme_account_name text;
