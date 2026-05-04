---
canon: secureworks-docs/brand/design-system.md
movement: Architectural Assurance
register: product
last_updated: 2026-04-30
---

# SecureSuite (securedash) — Product Brief (Ops + CEO + Trade Dashboards)

This file exists to satisfy the impeccable setup gate. It is a thin pointer to the canon. The single source of truth is `~/Projects/secureworks-docs/brand/design-system.md`. If any field below conflicts with the canon, the canon wins.

## Register

`product` — `ops.html`, `ceo.html`, `trade.html` are operational tools. The interface SERVES the workflow: scheduling jobs, raising POs, approving variations, dispatching installers. Quality is measured in time-to-decision, mistakes-prevented, and clicks-saved per task. Aesthetic does not get to slow the workflow down; it does get to keep the workflow legible at 10pm on a Tuesday.

`ops.html` already follows the canon — this conformance pass is narrow: brand-name cleanup, utility-colour audit, radius-creep audit. Layout and information architecture are not in scope.

## Users

- **Shaun (operations manager).** The most frequent user of `ops.html`. Lives in the dashboard 6+ hours a day. Knows where every pixel is. Filing bugs in his own Claude session. Runs jobs end-to-end: scheduling, ordering, install dispatch, install QA. Calm under load — the interface is allowed to be dense, but nothing should be ambiguous.
- **Tinnes (patios operations lead).** Schedule + ordering + supplier negotiation. Same density tolerance as Shaun, slightly newer to the tooling.
- **Marnin (CEO / admin).** Read-only most days. Wants `ceo.html` for trend lines and `ops.html` to spot-check active issues. Phone first, desktop deep-dive when something looks off.
- **Installers (Trade PWA).** `trade.html` is the daily-driver for in-the-field installers. Mobile only. Big touch targets. Glove-friendly buttons. Glance-readable in bright Perth sun.

Not these: customers, sub-contractors, casual viewers, anyone outside the SecureWorks ops team.

## Product Purpose

`ops.html` is the source-of-truth view for every active job and the queue of decisions an operations manager needs to make today. It pulls from Supabase (live state), Xero (invoices, POs), and GHL (lead state); it pushes events back through edge functions. Get the right job in front of Shaun in two clicks and let him act.

`ceo.html` is the rolled-up view for the founder. Trend lines, RAG indicators, this-week-vs-last-week. Read-only by design.

`trade.html` is the installer PWA. Today's jobs, navigation to site, sign-off, photo upload, defect log. Field reliability beats feature breadth.

## Brand Personality

Inherited from the SecureWorks brand canon. For a product surface this means:

- The surface looks like a foreman's site folder, not a SaaS marketing page. Architectural, structural, opinionated about hierarchy.
- Density welcomed in `ops.html` admin views. `trade.html` strips to essentials for in-field use.
- Calm-tradie default. Direct-response sharpness reserved for actual blockers (overdue PO, expired insurance, missed install).
- Plain English. "Schedule install" beats "Activate deployment workflow".

Three physical-object words for `ops.html`: **clipboard, structural-steel, late-afternoon-warehouse-light.**
Three for `trade.html`: **hi-vis-yellow, bright-Perth-sun, glove-on-touchscreen.**

## Anti-references

Reject on sight.

**Aesthetics**
- Generic SaaS admin panel — Inter, white-on-cool-grey, 12px corners.
- Crypto / fintech dark-mode-with-neon — glowing accents, gradient borders.
- Hero-metric template (big number + small label + supporting stats + gradient accent). Impeccable absolute ban.
- Identical card grids. Impeccable absolute ban.
- Side-stripe borders thicker than 1px as decorative accents. Impeccable absolute ban — use full borders or leading icons.
- Glassmorphism as default. Impeccable absolute ban.
- Pure white card on pure white page. Use warm-grey page + warm-50 card for distinction.
- Pure black text, pure black shadows.
- Multiple orange CTAs visible at once. One orange element per view (canon).
- Purple `#8E44AD` used as a primary accent or hero CTA. It is utility-only (type-badge for Quick-Quote section, etc.) and never replaces orange.
- Modal as first thought. Use inline / progressive disclosure. Impeccable absolute ban.

**Fonts**
- Inter, Plus Jakarta Sans, DM Sans, Outfit, Space Grotesk, Instrument Sans/Serif. Helvetica Neue is the brand identity (allowed).

**Copy**
- Em dashes anywhere user-visible.
- "SecureWorks WA" (old name) — `ops.html` currently has 15 instances of this; remove.
- Generic empty states — "No data" instead of contextual ("No POs awaiting approval — clear queue").

## Strategic principles

The Five Laws of Architectural Assurance (canon §1) applied to product surfaces:

1. **Space is the primary material.** Density is intentional in admin views. Stat blocks earn monumental scale; supporting tables contract to clinical density.
2. **Colour is emotional architecture.** Dark blue header band, warm-grey page, warm-50 cards, surgical orange for primary action. RAG (`#27AE60` / `#E74C3C` / `#E67E22` / `#3498DB`) and type-badge purple (`#8E44AD`) are utility-only.
3. **Typography operates at extreme scales.** Stat cards use 48–64pt condensed numerals. Body 11–13pt. Avoid 12→14→16 ladders.
4. **Composition follows asymmetric monumentality.** The dashboard layout already does this in `ops.html` — preserve.
5. **Nothing shouts, nothing begs.** RAG indicators are restraint. No animation on red badges. No celebration on green.

Hard rules (canon §2):
- Sharp edges by default (0px). Eased = 3px (inputs/buttons). Pill = 100px (filter chips only).
- Blue-toned shadows only.
- Helvetica Neue only.
- All brand values via CSS custom properties.
- For `ops.html` specifically: out-of-scope changes during this conformance pass include layout, IA, dashboard composition, JS modules. Only re-skin and brand-name cleanup are in scope.
