-- Where a stuck buyer can reach the organizer (Messenger link, tel: or mailto:).
alter table events
  add column if not exists support_contact_label text,
  add column if not exists support_contact_url text;
comment on column events.support_contact_label is 'Shown to buyers, e.g. "Message us on Messenger" or "Text 0917 123 4567".';
comment on column events.support_contact_url is 'Link for the label: https://m.me/..., tel:09171234567, or mailto:...';
