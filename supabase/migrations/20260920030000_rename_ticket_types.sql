-- Organizer wording (2026-09-20): shorter public names. Codes, prices and bands unchanged.
update ticket_types set name = 'Early Bird' where code = 'P';
update ticket_types set name = 'Early Bird Kids' where code = 'B';
update ticket_types set name = 'VIP Pass' where code = 'G';
