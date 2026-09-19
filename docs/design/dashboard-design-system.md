# Dashboard Design System

Adapts [apple-design-analysis.md](./apple-design-analysis.md) — a spec for Apple's *marketing* site (photography-first, full-bleed hero tiles, alternating light/dark sections, "Buy"/"Add to Bag" CTAs) — for this platform's actual frontend: a dense, data-heavy clinical operations console (patient tables, queue monitors, escalation review, campaign dashboards). Confirmed with the user before building: extract the token language, don't transplant the marketing-page structure.

## What we took as-is

- **Color tokens**: Action Blue (`#0066cc`) as the single interactive accent, the ink/canvas/parchment/hairline neutrals, the three near-black tile steps (repurposed for a dark sidebar rather than dark product tiles).
- **Typography scale**: the full SF Pro Display/Text hierarchy, including the "Apple tight" negative letter-spacing at display sizes, 17px (not 16px) body copy, and the 300/400/600/700 weight ladder with 500 deliberately absent.
- **Radius scale**: `none/xs/sm/md/lg/pill/full` exactly as specified — pill reserved for actions (buttons, search), `lg` (18px) for utility cards, `sm` (8px) for compact utility elements.
- **Elevation discipline**: no shadows on chrome (cards, buttons, tables) — flat surfaces and color/border changes carry hierarchy instead. We don't have "product photography" to apply the signature drop-shadow to, so in this system that shadow token is simply unused rather than misapplied to something else.
- **Button grammar**: primary pill (Action Blue), secondary ghost pill, dark utility rect, icon-circular — same shapes, applied to dashboard actions (save, cancel, add, icon buttons) instead of "Buy"/"Learn more".
- **Press micro-interaction**: `transform: scale(0.95)` active state on every button.

## What we deliberately changed

**No full-bleed 80px-padded hero tiles, no alternating light/dark page sections, no marketing copy.** A campaign manager scanning a queue or a clinical reviewer triaging an escalation needs maximum information density and fast scanning, not a museum-gallery pace. Layout is a conventional dashboard chassis instead: a persistent dark sidebar (reusing `surface-tile-1` / `surface-black` from the spec) + a light content area (`canvas`/`canvas-parchment`) with dense tables, forms, and cards.

**Status/semantic colors are added — the spec has none.** Apple's single-accent rule is a marketing-page constraint ("no second brand color, ever"); it does not apply to conveying *state* in an operations tool, where color-coded risk levels, escalation priority, and task outcomes are a core scanability requirement, not a branding choice. We use the `dataviz` skill's fixed, contrast-validated status palette (good `#0ca30c` / warning `#fab219` / serious `#ec835a` / critical `#d03b3b`), always paired with an icon + text label per that skill's accessibility rule — never color alone. Action Blue remains the *only* color for interactive/actionable elements (links, buttons, focus rings); status colors are strictly informational and never used on anything clickable.

**Search/filter inputs use `rounded.pill` per spec; other form fields use `rounded.sm`/`md`.** A login form or a "create patient" form is not a search bar — pill-shaped text/select/date inputs read oddly in a dense form. We follow the spec's own radius-grammar rule ("don't mix radii grammars") by reserving pill exclusively for actions and search, and using the compact utility radius for standard form fields.

**Tabular figures for data tables.** The spec's typography notes proportional figures for large standalone numbers (stat tiles, hero figures) — kept. Table columns of numbers (patient counts, capacities) use `font-variant-numeric: tabular-nums` instead, per standard data-table practice, since values must align vertically down a column.

## Component inventory (implemented)

Base primitives in `web/src/components/ui/`: `Button`, `Badge` (status), `Card`, `Input`, `Select`, `Textarea`, `Table`, `Pagination`, `Tabs`, `StatTile`, `EmptyState`, `Spinner`, `Alert`, `FieldLabel`.

Layout in `web/src/components/layout/`: `AppShell` (sidebar + topbar chassis), `Sidebar` (role-aware nav), `TopBar` (hospital/user context + sign out).

## Font substitution

Per the spec's own "Note on Font Substitutes": `-apple-system, BlinkMacSystemFont` leads the stack (resolves to real SF Pro on macOS/iOS/Safari), with **Inter** (Google Fonts) as the open-source fallback elsewhere, loaded in `web/index.html`.

## Implementation gotcha: spacing-token names collided with Tailwind's own reserved keywords

Found live (broke the entire layout — every `max-w-*` card collapsed to near-zero width) and worth recording so it isn't reintroduced: Tailwind v4 unifies padding/margin/gap/width/height/inset **and** `max-w-*`/`min-w-*` under one `--spacing-*` theme namespace, and reserves the exact t-shirt names `3xs/2xs/xs/sm/md/lg/xl/2xl…7xl` as container-width keywords within that same namespace. The design doc's spacing scale uses `xs/sm/md/lg/xl` as token names too — defining `--spacing-sm: 12px` didn't just add a new `p-sm` utility, it silently *redefined* `max-w-sm` from Tailwind's real ~24rem "small container" width to 12px, because both utilities read from the same namespace. Every card using `max-w-sm`/`max-w-lg` collapsed.

Fix: the spacing scale is defined under a `ds-` prefix instead (`--spacing-ds-xs`, `--spacing-ds-sm`, …), used as `p-ds-lg`, `gap-ds-md`, etc. throughout the components. This leaves Tailwind's own `max-w-*`/`min-w-*` keyword vocabulary untouched. All eight tokens are prefixed for one consistent convention, even though only `xs/sm/md/lg/xl` actually collided (`xxs`/`xxl`/`section` were already safe, since Tailwind's reserved forms are spelled `3xs`/`2xs`/`2xl`).

Lesson for any future custom Tailwind v4 theme: never name a `--spacing-*` (or any other shared-namespace scale) key after one of Tailwind's own reserved size keywords, even if you only intend to use it for padding/gap — the namespace is shared across every utility family that reads from it, silently.
