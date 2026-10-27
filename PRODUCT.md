# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Current event

**Track & Crawl Fest 2026** (own Supabase and Vercel): Tarlac Circuit Hill, Tarlac, Philippines, Nov 7 2026, 7AM-5PM. "Big cars. Small rigs. Same passion." Presented by 2S06, NoInvite and Philippine RC Expo. The site is a registration: PHP 500 per car (driver, plate, make/model and a car photo), 300 slots to start, paid by bank QR with proof upload and staff verification. Page order (user, 2026-10-27): event information with the hero first, then the registration and payment.

## Users

- **Buyers** of event tickets, on phones and laptops in about equal measure. They pick tickets, give holder details (shirt size, car plate where needed, delivery address for shipped shirts), pay by bank QR (GoTyme InstaPay; GCash and Maya can be re-enabled), upload proof, and later open their tickets and receipt from email.
- **Staff** at a desk or on the move, on laptops and phones equally:
  - *staff* role: verify payment proofs, manage orders, sell at the walk-in desk, read the dashboard;
  - *gate* role: walk-in desk only;
  - *scanner* role: the gate scanner only;
  - *admin*: everything, plus Numbers, Reports, Audit and Settings when the account has system access.
- **Organizer** who sets up a new event entirely in Admin > Settings (event details, ticket types, artwork, slideshow, colours, payments, ordering rules, email, PDF branding).

## Product Purpose

Sell numbered tickets for a live event and run event day: online sales with proof-of-payment verification, tickets that match pre-printed wristband serials, receipt and ticket PDFs by email, on-site walk-in sales, a live sales dashboard, a mobile gate scanner with an offline fallback, and exports/reports for reconciliation. Success is every peso reconciled (dashboard = database = cash box/bank), no wristband serial issued twice, a fast gate, and buyers who never have to message support to find their ticket.

## Positioning

A small-organizer ticketing system built around physical wristbands: each ticket is bound to a pre-printed serial, walk-in taps deduct from the same stock as online orders, and the whole event (look included) is configured from Settings rather than code. Being re-skinned per event is part of the product.

## Operating Context

- Event day is loud, bright, outdoors and fast: walk-in staff tap +1 repeatedly under queue pressure; gate staff scan wristbands one-handed on phones, sometimes offline.
- Verification is manual: staff compare the buyer's uploaded screenshot with the bank reference.
- Reconciliation happens after hours against the cash box per staff and the GoTyme account history; Excel exports are the hand-off format.
- Deploy: Vercel, Git-linked (push to `main` = production). Supabase Postgres/Auth/Storage.

## Capabilities and Constraints

- Next.js 16 App Router with server actions, Tailwind 4. No component library; shared primitives live in `src/app/globals.css` (`.btn*`, `.input`, `.card`, `.label`, `.glass`, `.dark-zone`, `.staff-shell`) and `src/components`.
- Brand colours are runtime values from Settings, written as CSS variables in the root layout (`--brand-bg`, `--brand-bg-deep`, `--neon-pink|violet|cyan|green`); components must read the variables, never hard-code a colour that Settings is supposed to change. `THEME.palette` can re-tint Tailwind colour families.
- Event-specific copy, artwork, logo, slideshow, ticket labels, prices and rules come from Settings/DB; nothing in the chrome may assume drift, cars or a specific event name (white-label, see Brand Commitments).
- Ticket labels carry a wristband colour (`band_color`, including stripes) that staff match by eye; that colour is data, not decoration.
- Money is stored in centavos; dates use Asia/Manila.
- Large tables (walk-in sales, audit log, ticket numbers) pass PostgREST's 1,000-row cap; aggregates must page (`src/lib/fetch-all.ts`) or use DB views.
- Roles and per-account switches (system access, `can_scan`) gate navigation; the redesign must not expose a page a role lacks.
- Redesign work lives on branch `redesign/impeccable`, not merged to `main` until approved.

## Brand Commitments

- **Track & Crawl look** (user, 2026-10-27): follow the event poster: night-black ground, CRAWL red, bone white, sunset orange/amber, checkered flags, brush strokes, heavy condensed italic type, the Tarlac Circuit Hill photo. Placeholder art is cropped from the poster in public/tcf/ until the organizer sends originals (transparent logo, clean photos, sponsor logos).


- **Keep the current theme and colorway** (user, 2026-10-15): dark near-black background with a deep violet top (`#0a0a0c` / `#14061f` defaults) and the four-stop neon gradient pink `#ff3fd1` → violet `#b34cff` → cyan `#2fd8ff` → green `#6dff5c`, all still editable in Settings.
- **White-label** (user, 2026-10-15): the system will be reused for any event and other organizers, so event identity (name, logo, artwork, poster, sponsors) comes only from Settings; the product chrome stays neutral.
- **Keep on the public side** (user, 2026-10-15): the Settings-driven hero artwork and slideshow, the Orbitron display face, the cyan→green neon gradient buttons, and the hero motion effects (smoke, streaks, glow; toggled in Settings).
- **Staff screens take the familiar admin layout** (user, 2026-10-15, after two re-rolls of novel structures): a conventional sidebar/top-bar admin executed at full craft inside the dark neon world, no novel navigation model. Quality bar: Linear, the Vercel dashboard, and Shopify admin.
- **Priority** (user, 2026-10-15): the public buyer flow is redesigned first, then the staff screens, then scanner and login.

## Evidence on Hand

- No testimonials, press, or third-party claims exist; do not invent any.

## Product Principles

1. **Money and stock must reconcile.** Every figure a screen shows comes from the same source the exports use; a pretty number that disagrees with the database is a defect.
2. **Event day speed beats ornament.** Walk-in, verify and scan screens are used hundreds of times an hour; the frequent action is the biggest, closest and least ambiguous thing on screen.
3. **The event owns the identity, the system owns the clarity.** Artwork and colour come from Settings; structure, legibility and states are the product's.
4. **Buyers should never need support to find their ticket.** Status, next step and the ticket itself are always one obvious tap away.
5. **A role sees only its job.** Navigation and actions follow the role and account switches exactly.

## Accessibility & Inclusion

- Used outdoors in sunlight and at night: text and state colours need strong contrast on the dark theme; wristband colour is never the only cue (code letters stay alongside swatches).
- Phones and laptops equally: every screen works from 360 px wide to wide desktop.
- Respect `prefers-reduced-motion` (the current hero and reveal motion already do).
