# Drift Event Tickets

Ticket sales website for a car drift event. Buyers pay via the organizer's
GoTyme Bank InstaPay QR (GCash / Maya can be re-enabled), upload proof, staff verify, and the system issues numbered tickets
that match pre-printed wristbands. Includes a receipt PDF, email delivery, on-site
sales, a sales dashboard, and a mobile gate scanner with offline fallback.

## Stack

- Next.js 16 (App Router, server actions) + Tailwind 4
- Supabase: Postgres, Auth (staff logins), Storage (payment screenshots, QR images)
- pdf-lib + qrcode for the receipt/ticket PDF
- Resend for email (dry-run logs to console when no API key is set)

## Ticket types (seeded, PLACEHOLDER quantities)

| Code | Name | Price | Includes |
|------|------|-------|----------|
| EBA  | Early Bird - Adult | PHP 150 | wristband |
| EBC  | Early Bird - Child (below 12) | PHP 75 | wristband |
| VIPS | VIP Standing | PHP 950 | wristband, t-shirt, ID lanyard, sticker |
| VIPC | VIP Car Display | PHP 1,500 | wristband, t-shirt, VIP passes, car pass |

## Supabase project

Project **DriftTickets**, ref `bcrxzihpyoahvfmrayej`, region ap-southeast-1, org
Digital Transformation Office. Both migrations and the placeholder seed are already
applied there. `.env.local` has the URL and anon key; the service role key must be
pasted from Dashboard > Project Settings > API Keys.

## Setup (fresh project)

1. Create a Supabase project. Copy `.env.example` to `.env.local` and fill in the
   URL, anon key, and service role key.
2. Apply the schema and seed:
   ```bash
   npx supabase link --project-ref <ref>
   npx supabase db push
   npx supabase db query -f supabase/seed.sql
   ```
   Or paste `supabase/migrations/20260911000000_init.sql` then `supabase/seed.sql`
   into the SQL editor.
3. Create staff accounts in Supabase Auth (email + password), then add each to the
   `staff` table:
   ```sql
   insert into staff (id, full_name, role) values ('<auth user uuid>', 'Juan Dela Cruz', 'admin');
   ```
   Roles: `admin` (everything incl. number import), `staff` (verify, orders,
   on-site sales, dashboard), `scanner` (gate scanner only).
4. Replace placeholders in the `events` row: name, venue, date, organizer receipt
   details, `gcash_qr_url`, `maya_qr_url` (upload the real QR images to the public
   `event-assets` bucket and paste their URLs), `sales_close_at`, `refund_policy`.
5. Import the real wristband serials at **Admin > Numbers** (delete the seeded
   placeholder ranges first: `delete from ticket_numbers;`).
6. `npm run dev`

## Payment channels

Which channels a buyer sees on `/pay/[id]` (and can pick under "I paid with") is
driven by the `events` row: a channel is offered only when its `*_qr_url` is set.
Currently **GoTyme Bank (InstaPay QR)** only:

```sql
update events set gotyme_qr_url = '/payment/gotyme-qr.jpg', gotyme_account_name = 'Christine Sy',
                  gcash_qr_url = null, maya_qr_url = null where active;
```

To bring GCash or Maya back, set their `*_qr_url` (public path or Storage URL)
again; no deploy needed. Labels/colours live in `PAYMENT_CHANNELS`
(`src/config/event.ts`); the marketing copy uses `PAY_VIA` from the same file.

## Flows

- **Online**: `/` choose tickets -> `/pay/[id]` shows QR + amount, buyer submits
  reference no. + screenshot -> `/admin/verify` staff approve -> tickets issued,
  PDF emailed -> `/order/[id]` shows QR codes.
- **On-site**: `/admin/onsite` staff records payment, tickets issue immediately.
- **Gate**: `/scan` camera scanner, marks redeemed, shows band number + kit
  checklist, caches ticket list for offline validation.
- **Numbers**: `/admin/numbers` import ranges or pasted lists, void damaged bands.
- **Export**: `/api/admin/export` CSV of all tickets and orders.

## Email

Configure at **Admin > Settings** (admin role): SMTP host, port, login, sender, and
a "Send test" button. Settings saved there are stored in the `app_settings` table
and take effect immediately. If nothing is saved there, the environment variables
below are used. Provider: **SMTP** when a host is set, else **Resend** when an API
key is set, else **dry-run** (logged to the server console, nothing sent).

Recommended: SMTP through a Microsoft 365 mailbox.

```
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USER=tickets@yourdomain.com
SMTP_PASS=<mailbox password or app password>
EMAIL_FROM="Drift Event Tickets <tickets@yourdomain.com>"
```

Requirements on the tenant: SMTP AUTH enabled for that mailbox (Exchange admin
center > mailbox > Manage email apps > Authenticated SMTP) and an app password if
MFA is on. Microsoft 365 limits: 10,000 recipients/day, 30 messages/minute.

Test the configuration without placing an order:

```bash
node --env-file=.env.local scripts/send-test-email.mjs you@example.com
```

## Notes

- Orders hold inventory for 30 minutes (`PAYMENT_WINDOW_MINUTES`) until proof is
  uploaded, then until staff decide.
- A GCash/Maya reference number can only be used on one live order.
- Receipt label defaults to "ACKNOWLEDGMENT RECEIPT". Change `events.receipt_label`
  to "OFFICIAL RECEIPT" only once the organizer's accountant confirms BIR
  registration of the receipt series.
