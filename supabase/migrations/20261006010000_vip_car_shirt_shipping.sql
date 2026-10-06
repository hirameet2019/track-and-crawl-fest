-- VIP Car Display ships its shirt too (2026-10-06), online only, like VIP Pass:
-- an online car order gives a shipping address for the driver's shirt. Online car
-- sales closed on 4 October, so this matters only if they reopen; gate sales still
-- hand the shirt over. The free passenger has no shirt.

update ticket_types set ships_shirt = true where active and code = 'R';
