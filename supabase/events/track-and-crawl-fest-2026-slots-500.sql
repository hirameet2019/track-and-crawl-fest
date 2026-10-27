-- Track & Crawl Fest 2026: 500 slots each (2026-10-27). Adds C301-C500 to Car
-- Registration and M101-M500 to Motorcycle Registration; existing numbers untouched.
insert into ticket_numbers (ticket_type_id, number, seq)
select t.id, t.code || lpad(g::text, 3, '0'), g
from ticket_types t
join events e on e.id = t.event_id and e.slug = 'track-and-crawl-fest-2026'
cross join generate_series(1, 500) g
where t.code in ('C', 'M')
on conflict (ticket_type_id, number) do nothing
