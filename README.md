# Track & Crawl Fest 2026 Registration

Registration website for Track & Crawl Fest 2026 (Tarlac Circuit Hill, Nov 7 2026):
car and motorcycle registrations, paid by QR or bank transfer. Buyers upload proof
of payment, staff verify it, and the system issues numbered registrations with QR
codes. Includes a receipt PDF, email delivery, walk-in sales at the gate, a sales
dashboard, and a mobile gate scanner with offline fallback.

**Running another event?** Follow [SETUP-NEW-EVENT.md](SETUP-NEW-EVENT.md). Almost
everything is edited in **Admin > Settings**: Event, Tickets, Payments (QR codes and
added channels such as bank transfers), Payment page, Ordering, Page (what the
registration page shows and says, and what a registration is called), Look, Email,
Advanced. `src/config/site.ts` and `src/config/event.ts` only hold the defaults.

## Stack

- Next.js 16 (App Router, server actions) + Tailwind 4
- Supabase: Postgres, Auth (staff logins), Storage (payment screenshots, vehicle photos, artwork)
- pdf-lib + qrcode for the receipt and registration PDF
- SMTP or Resend for email (dry-run logs to the console when neither is set)

## Registrations

| Code | Name | Price | Slots |
|------|------|-------|-------|
| C | Car Registration | PHP 500 | 500 (C001-C500) |
| M | Motorcycle Registration | PHP 500 | 500 (M001-M500) |

Each needs the driver or rider's name, the plate, make/model and a photo of the
vehicle. Created by `supabase/events/track-and-crawl-fest-2026*.sql`.

## Supabase project

Its own project (ref in `.env.local`), separate from any earlier event. Apply every
file in `supabase/migrations` with `npx supabase db push`, or run new ones in the
SQL editor (the payment-channel migration's enum statement must run on its own).
Migrations are additive; never reset or wipe a project that has taken registrations.

## Payment channels

- **GoTyme / GCash / Maya**: offered when their QR code is saved under
  **Admin > Settings > Payments > Payment QR codes** (press *Save QR codes*).
- **More payment channels** (same tab): any bank transfer or e-wallet, with its own
  QR and/or account number. Shown after the built-in ones while switched on.
- Orders record the channel's id and name, so staff screens, receipts and exports
  read "BDO Bank Transfer" and the like.

## Flows

- **Online**: `/` pick registrations -> `/pay/[id]` shows the QR codes and amount,
  buyer submits the reference no. + screenshot -> `/admin/verify` staff approve or
  reject -> registrations issued, PDF emailed -> `/order/[id]` shows the QR codes.
- **Walk-in**: `/admin/walkin` tallies gate sales per label.
- **Gate**: `/scan` camera scanner, marks each QR redeemed, works offline from a cached list.
- **Numbers**: `/admin/numbers` imports or voids registration numbers.
- **Export**: `/api/admin/export` Excel (summary + one sheet per type); Reports has the per-staff walk-in workbook.

## Deploying

Vercel project `hakdog3/track-and-crawl-fest`. Automatic deploys from Git are **off**
(`git.deploymentEnabled: false` in `vercel.json`): pushing to `main` does not go
live. Deploy on purpose with `vercel deploy --prod` or Redeploy in the dashboard.

## Email

Configure at **Admin > Settings > Email**: SMTP host, port, login, sender, and a
"Send test" button. Saved settings override the environment variables. Provider:
**SMTP** when a host is set, else **Resend** when an API key is set, else
**dry-run** (nothing sent).

Every buyer email is kept in the **Outbox** on the same tab (table `email_outbox`,
migration `20261028000000_email_outbox.sql`). In dry-run they wait there; once SMTP
works, *Send all waiting* sends them (20 per click), and any one can be sent again.
Emails that no longer make sense are skipped (a "pay within 60 minutes" for an
order already paid or expired). Ticket emails are rebuilt with a fresh PDF when sent.

```
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USER=registrations@yourdomain.com
SMTP_PASS=<mailbox password or app password>
EMAIL_FROM="Track & Crawl Fest <registrations@yourdomain.com>"
```

Test without placing an order:

```bash
node --env-file=.env.local scripts/send-test-email.mjs you@example.com
```

## Notes

- Orders hold their registrations for the payment window (Settings > Payments,
  60 minutes by default) until proof is uploaded, then until staff decide. Expiry is final.
- A reference number can be used on only one live order per channel.
- The receipt label defaults to "ACKNOWLEDGMENT RECEIPT"; change `events.receipt_label`
  to "OFFICIAL RECEIPT" only once the organizer's accountant confirms BIR registration.
