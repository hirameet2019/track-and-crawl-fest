---
version: 1
slug: "src-app-staff-layout-tsx"
primary_target: "src/app/(staff)/layout.tsx"
related_targets: ["src/components/StaffShell.tsx"]
---

# Staff app (admin, walk-in, verify, scanner)

Mode: Operate. Users: staff, gate, scanner and admin roles on laptops and phones equally, often under event-day queue pressure. Constraints: role and account switches gate navigation; colours come from Settings; white-label.

## Direction contract

THESIS: The familiar admin, done at the craft of Linear, the Vercel dashboard and Shopify admin, inside the event's dark neon world; it refuses the old top bar of nine tabs over a light app re-skinned dark.

OWN-WORLD: Near-black ground, a violet-tinted zinc scale running dark to light (surfaces, borders, then text), status families as dark tints with light ink, the four-stop neon gradient as a hairline on the sidebar edge and phone top bar, cyan for the active nav icon, Orbitron italic uppercase page titles, and the cyan-to-green gradient reserved for the one event-day action per screen (+1, Approve).

STORY: Staff know where everything is at a glance: grouped sidebar (Overview, Sales, Gate, Admin) filtered by role, the page's work in the main column, the frequent action largest.

FIRST VIEWPORT: 256px sidebar with event logo, grouped nav with drawn icons, ticket-page link and user card with sign out at the foot; main column up to 1400px with the page title and its work. Under 1024px: sticky top bar with menu button, logo and page name; the nav opens as a drawer.

FORM: Category standard by user choice (canon) after two re-rolls. seed: none (unavailable)

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
