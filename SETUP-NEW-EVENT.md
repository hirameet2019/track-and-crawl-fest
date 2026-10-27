# Setting up a new event

This app runs Track & Crawl Fest 2026 and is set up to be reused. Almost
everything event-specific is edited in **Admin > Settings** (admin login), with
no code change and no redeploy:

Settings is split into tabs, one job each:

| Tab | What it covers |
|-----|----------------|
| Overview | Setup checklist: what is ready and what is missing, each with a link to fix it |
| Event | Name, tagline, venue, date, online sales window, receipt details, refund policy, "Need help?" link |
| Tickets | Add / edit / hide ticket types (code, band colour, prices, where sold, inclusions, car tickets and companions, kids, caps) and the per-type online cut-offs |
| Payments | QR codes and account names, more payment channels (bank transfers, other e-wallets), time to pay, reminder timing, and how each channel is named |
| Payment page | What the payment page shows and its steps, labels and notes |
| Ordering | Tickets per order, passengers per car, shirt sizes with measurements, size-chart image |
| Look | Browser-tab suffix, logo, backdrop, share image, slideshow (images and videos), effects, colours, PDF ticket logo, banner and colours, staff note |
| Email | SMTP / Resend sender |
| Page | What the registration page shows and says, the "Your details" fields, and what a registration is called |
| Advanced | Staff login domain (change between events, not during one); locale shown read-only |

Uploads go to the public `event-assets` Storage bucket. What is never saved in
Settings falls back to the defaults in `src/config/site.ts`, so a fresh install
looks like Track & Crawl Fest until you change it, and **Back to defaults** returns
there.

Still in code: locale and time zone (used by almost every screen), the
browser-tab icon (`src/app/icon.png`), and the Tailwind-wide colour retint
(`THEME.palette` in `src/config/site.ts`).

## 1. Make a copy

Use a **new Supabase project** and a **new Vercel project** per event. Do not add
a second event to the old database: the staff Orders/Verify screens,
the export, the reminder cron and the **gate scanner** do not filter by event
yet, so the old event's orders would show up and its QR codes would be accepted
at the new gate.

1. Fork or copy the repo. Create a Vercel project from it (region `sin1`,
   framework Next.js; `vercel.json` already has the function limits and cron).
2. Create a Supabase project.

## 2. Environment variables

Copy `.env.example` to `.env.local` and fill it in, then put the same values in
Vercel (Production):

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SITE_URL`: the public URL. It is printed inside every QR code
  and email link, so set it to the final domain **before** the first sale.
- `CRON_SECRET`: any long random string. Without it the reminder / expiry
  emails never send.
- Email: `SMTP_*` + `EMAIL_FROM` (or `RESEND_API_KEY`). Can also be set later
  in **Admin > Settings**, which overrides the env vars.

## 3. Database

```bash
npx supabase link --project-ref <new ref>
npx supabase db push
```

That applies every file in `supabase/migrations` and gives you the full current
schema. (The old project also lists `realtime_orders`,
`convert_order_reject_gate_only` and `payment_reminder_emails_backfill`; they
are superseded or were one-off data fixes, so they are intentionally not in the
repo.)

Then copy `supabase/new-event.template.sql`, replace at least the slug, name
and organizer, and run it once. Settings edits an event, it does not create
one, so this gives it the first `events` row (and, if you like, starter
ticket types).

From here on use **Admin > Settings** (after step 4 gives you an admin login):
start at the Overview tab: it lists what is still missing and links to the
tab that fixes each item. Only channels with a QR are offered to buyers, and the instructions
name the first one.

### Ticket type fields worth knowing

The same fields appear in Settings > Ticket types with plain labels.

| Column | Effect |
|--------|--------|
| `code` | Letter on the band serials. The import script matches serials by it. |
| `sell_online` / `sell_at_gate` | Shown on the order form / the Walk-in tab and accepted at the gate. |
| `walkin_price_centavos`, `walkin_name` | Gate price and name, when they differ from the online ones. |
| `gate_needs_name` | Gate sale records a name (a car label also records the plate). |
| `requires_vehicle` | Buyer must give plate, model and a car photo; gets a car pass. |
| `included_companions` | Free passes bundled with one ticket of this type (they take the companion type's band). |
| `is_child` | Shown as a kids ticket. |
| `includes_shirt` / `_lanyard` / `_sticker` / `_car_pass` | Kit checklist on the ticket, PDF and gate screen. Shirt types ask for a size. |
| `online_cap` | Max online sales for this type; null = limited only by its numbers. |
| `sales_close_at` | Per-type online cut-off. Easier to set in **Admin > Settings**. |

## 4. Registration numbers and staff

Import each type's numbers at **Admin > Numbers**, e.g. prefix C, 1 to 500, pad 3
for C001 to C500 (or paste a list). A number can be voided there later.

Staff: create each user in Supabase Auth, then add a `staff` row:

```sql
insert into staff (id, full_name, role) values ('<auth user uuid>', 'Juan Dela Cruz', 'admin');
```

Roles, lowest to highest: `scanner` (gate scanner only), `gate` (walk-in desk:
Walk-in and Scan only), `staff` (verify, orders, dashboard), `admin` (everything).
Gate users can log in with a short username: the login form adds
`@<STAFF.usernameDomain>` (`site.ts`), so the Auth email for `walkin1` is
`walkin1@drift.local` unless you change the domain.

## 5. Look of the site: Admin > Settings

Everything under **Look of the site** saves together with **Save look**:

- **Title and images**: browser-tab suffix ("Event name · Tickets"), logo (hero,
  page banner, login, staff bar), backdrop behind inner pages, and the share
  image for Facebook / Messenger / Viber previews (about 1200 x 630).
- **Sales page slideshow**: up to 8 slides. Each has an image, an optional
  video (muted, looping; the image shows while it loads and for people who
  turned off motion), a focus point that stays in frame when cropped, and fill
  or whole-image fit. Reorder with the arrows. Also seconds per slide and the
  glow / smoke / streak effects (smoke and streaks suit motorsport).
- **Colours**: four accents (buttons, glows, underlines, ticket stripe), page
  background, background glow, phone browser bar.
- **PDF ticket**: logo and banner photo (PNG or JPG). Blank keeps the built-in
  files; if the logo cannot be loaded the PDF writes the event name instead.
- **Note above the sales schedule**: optional, for staff.

Keep files light: hero images 1600-2000 px wide, videos short and under ~5 MB
(upload limit 10 MB per image, 50 MB per video).

Code-only extras in `src/config/site.ts`: `THEME.palette` (retint Tailwind's
cyan / fuchsia / violet shades across the whole UI), `BRAND.pdf.palette` (PDF
stripe and wordmark colours), `LOCALE`, `STAFF.usernameDomain`,
`NOTES.salesSchedule`. Replace `src/app/icon.png` and
`src/app/apple-icon.png` for the browser-tab and home-screen icon.

## 6. Payments, ordering and advanced: Admin > Settings

- **Payments**: time to pay (wristbands are held this long), reminder email
  timing, how long expiry notices are still sent, and each channel's wording
  (full name, short name, "pay via" phrases, the note under the QR, and the
  "where is the reference number" screenshot). Instructions name the first
  channel that has a QR code.
- **Ordering**: tickets of one type per order, passengers per car, and the
  shirt sizes offered (in order, with width / length / sleeve in inches) plus an
  optional supplier chart image.
- **Advanced**: staff login domain (short usernames become name@domain). Saving
  asks for confirmation because it changes logins immediately.

The values in `src/config/event.ts` are only the defaults now.

## 7. Before opening sales

- [ ] `npm run build` passes; deploy.
- [ ] Sales page shows the right name, date, venue, slides, prices; share the link in Messenger and check the preview image.
- [ ] Place a real small order, pay, upload proof, approve it in **Admin > Verify**; the email arrives with the PDF; the PDF shows the right logo, banner and band colours.
- [ ] Scan that ticket on a gate phone; scan it again and see it refused.
- [ ] Let one test order expire and confirm the reminder and expiry emails (needs `CRON_SECRET`).
- [ ] Support contact is set on the events row.
- [ ] Void the test tickets (Admin > Orders). Voiding retires that wristband too, so
      use one spare band per test, or run the tests before importing the real serials.
- [ ] Set up the database backup (`scripts/backup.mjs`).

## Not configurable yet

- The Tagalog helper lines on the order, payment and email screens are written
  inline in each component, next to the English.
- One event per database (see step 1). Making the staff screens, export, cron
  and scanner filter by event is the next step if events ever overlap.
- Gate phones keep an offline ticket cache in the browser (`ticket-cache-v1`).
  It is replaced on the first online sync, but clear the site data on reused
  gate phones before a new event to be safe.
