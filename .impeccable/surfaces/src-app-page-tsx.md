---
version: 1
slug: "src-app-page-tsx"
primary_target: "src/app/page.tsx"
related_targets: ["src/components/OrderForm.tsx","src/components/EventHero.tsx"]
---

# Public ticket page

Mode: Persuade. Covers the home page (hero + tickets), and carries into the buyer flow pages (pay, order status, ticket, drifter signup).

Audience and job: buyers on phones and laptops pick tiers, add holders, pay by bank QR. Proof: the event's own artwork, logo, date, venue and real tier inclusions. Constraints: white-label (everything event-specific from Settings), sales can be closed (then the page shows the closed state and gate info), all logic in OrderForm stays.

## Direction contract

THESIS: The page continues the event poster. Tiers are billed like a poster lineup, premium biggest, instead of a stack of identical cards; buying happens inside that billing.

OWN-WORLD: The incumbent world, kept: near-black ground with the deep violet top, the event photo hero with pink/cyan screen-blend glow, smoke and light streaks, the logo art, glass chips, Orbitron italic uppercase with the four-stop neon underline, cyan-to-green neon pill buttons. Billing lines are set in Orbitron italic, separated by hairlines, each with band-colour strap, inclusions in small system type, price, stepper.

STORY: The visitor sees the event (art, date, venue, admission), scrolls into SECURE YOUR SPOT, reads the lineup of tiers from VIP down, sets quantities on the line, sees the running total pinned at the bottom right, and checks out.

FIRST VIEWPORT: Full-bleed photo hero (slideshow) with the kicker chip, the logo art at about 620px, date and venue glass chips, admission prices and the pulsing Get tickets button at the bottom right; the billing section header starts at the fold.

FORM: Poster billing, position 4 on the grounded list (dealt card). seed: none (unavailable)

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
