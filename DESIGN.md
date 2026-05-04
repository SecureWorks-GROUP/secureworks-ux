---
canon: secureworks-docs/brand/design-system.md
movement: Architectural Assurance
last_updated: 2026-04-30
format: Google Stitch DESIGN.md (https://stitch.withgoogle.com/docs/design-md/format/)
---

# SecureWorks Group — Design Tokens

Single source of truth: `~/Projects/secureworks-docs/brand/design-system.md`. This file is a Stitch-format projection of that canon for tooling that expects this shape (impeccable, Stitch). If any value here drifts from the canon, the canon wins; update this file to match.

```yaml
colors:
  # ── Anchor palette ──
  orange:        "#F15A29"   # Fired Steel — primary accent, ≤5–8% of any composition, one per view
  dark-blue:     "#293C46"   # Structural Walls — headings, dark sections
  mid-blue:      "#4C6A7C"   # Threshold — secondary text, borders
  white:         "#FFFFFF"   # Pure ground, used sparingly (warm-50 preferred)
  warm-grey:     "#F8F6F3"   # Sandstone — primary page background
  body-text:     "#323232"   # Body — never pure black
  tab-brown:     "#8B6F47"   # Wayfinding — lookbook tab markers only

  # ── Orange family ──
  orange-900:    "#C4481F"   # hover/active
  orange-700:    "#F15A29"   # base (alias of orange)
  orange-500:    "#F4845F"   # icon fills, chart highlights
  orange-300:    "#FADDD2"   # tinted backgrounds, alert surfaces
  orange-100:    "#FDF2EE"   # barely-there wash

  # ── Blue family ──
  blue-950:      "#1A272E"   # immersive backgrounds, hero overlays
  blue-800:      "#293C46"   # base (alias of dark-blue)
  blue-600:      "#4C6A7C"   # base (alias of mid-blue)
  blue-400:      "#8FA4B2"   # disabled states, placeholders
  blue-200:      "#D4DEE4"   # divider lines, table borders
  blue-100:      "#EDF1F4"   # alternating rows on cool surfaces

  # ── Warm family ──
  warm-300:      "#E8E4DF"   # borders on warm surfaces
  warm-200:      "#F0ECE8"   # subtle distinction
  warm-100:      "#F8F6F3"   # base (alias of warm-grey)
  warm-50:       "#FCFBFA"   # near-white card surface; preferred over #FFF

  # ── Utility / RAG semantic ──
  # NOT accent colours. Never replace orange in CTAs.
  semantic-green:   "#27AE60"   # RAG green — completed, on-track
  semantic-red:     "#E74C3C"   # RAG red — overdue, at-risk
  semantic-yellow:  "#E67E22"   # RAG amber — warning
  semantic-blue:    "#3498DB"   # info chips only (not navigation/branding)
  semantic-purple:  "#8E44AD"   # type-badge utility (e.g., Quick-Quote section), never primary accent

  # ── Forbidden ──
  # "#000000": use blue-950 or dark-blue instead
  # "#FFFFFF": prefer warm-50 for surfaces
  # cool greys (#888, #999, #ccc, #eee, #F7F8FA, #F5F7FA): use blue family or warm family

  # ── Opacity scale (fixed values — never arbitrary) ──
  opacity-prominent: 0.85   # body text on dark
  opacity-secondary: 0.55   # labels on dark
  opacity-subtle:    0.25   # watermarks, decorative
  opacity-ghost:     0.08   # dividers on dark
  opacity-whisper:   0.04   # card surfaces on dark

typography:
  family-primary:   "'Helvetica Neue', Helvetica, Arial, -apple-system, BlinkMacSystemFont, sans-serif"
  family-condensed: "'HelveticaNeue-CondensedBold', 'Helvetica Neue Condensed', 'Helvetica Neue', Helvetica, Arial, sans-serif"
  # Identity-preservation: Helvetica is the brand. Reflex-reject list does not apply here.
  # Banned: Inter, Plus Jakarta Sans, DM Sans, Outfit, Space Grotesk, Fraunces, Newsreader, Cormorant, Playfair, Syne, IBM Plex *.

  scale:
    mega:    { size: 72pt, weight: 900, tracking: -2px,    line-height: 0.88 }   # cover headlines
    divider: { size: 48pt, weight: 900, tracking: tight,   line-height: 0.95 }   # section openers
    h1:      { size: 28pt, weight: 800, tracking: -0.3px,  line-height: 1.05 }
    h2:      { size: 18pt, weight: 700, tracking: normal,  line-height: 1.15 }
    h3:      { size: 14pt, weight: 700, tracking: 0.5px,   line-height: 1.20 }
    body:    { size: 11pt, weight: 400, tracking: normal,  line-height: 1.70 }
    caption: { size:  9pt, weight: 400, tracking: normal,  line-height: 1.40 }
    label:   { size:  9pt, weight: 700, tracking: 2.5px,   line-height: 1.20, transform: uppercase }
    fine:    { size:  8pt, weight: 400, style: italic,     line-height: 1.30 }

  rules:
    - Scale jumps must be ≥2.5x (no 12→14→16 ladders).
    - Weight extremes only — 400 (regular) and 700–900 (bold/black). Never 500/600.
    - Labels are sacred: uppercase, tracked, 9pt, 700.
    - Body line lengths 45–75ch. Never wider.
    - Headings use dark-blue, body uses body-text. No pure black.

components:
  # Components below are observable patterns from the existing canonical implementation
  # (securedash/ops.html). Translate, don't invent.

  card:
    background: warm-50           # never pure white on warm pages
    border: "1px solid blue-200"  # or warm-300 on warm surfaces (no temperature mixing)
    border-radius: 0px            # SHARP by default
    padding: 16px
    shadow: none                  # most cards flat; use shadow-lift on hover only
    rule: "Border OR shadow — never both on the same element."

  card-highlighted:
    border: "2px solid orange"
    badge: "uppercase 9pt 700 orange tag pill"
    use: "single 'most popular' / 'recommended' card per view"

  button-primary:
    background: orange
    color: white
    padding: "10px 20px"
    border-radius: 3px            # eased
    font: "Helvetica Neue 700, 11pt, uppercase, tracking 1px"
    hover-background: orange-900  # darken via family step, not opacity
    transition: "200ms ease-out"

  button-secondary:
    background: transparent
    color: dark-blue
    border: "1px solid dark-blue"
    border-radius: 3px

  input:
    background: warm-50
    border: "1px solid blue-200"
    border-radius: 3px            # eased — only inputs/buttons get radius
    padding: "10px 14px"
    focus-border: orange

  tag-pill:
    background: orange
    color: white
    padding: "5px 14px"
    font: "9pt 700 uppercase tracking 1px"
    border-radius: 100px          # full pill — only tag pills

  section-label:
    font: "9pt 700 uppercase tracking 2.5px orange"
    accent-line: "40px × 3px orange, 8px above content, 14px below label"

  stat-block:
    number: "condensed 64pt+, 900 weight, orange OR white"
    label: "9pt 700 uppercase tracking, mid-blue OR white"
    rule: "monumental scale; numbers are columns, not metrics"

  nav:
    # No glassmorphism. No backdrop-filter blur for decoration.
    background: warm-50           # solid warm card on light surfaces
    background-on-dark: dark-blue # solid on dark surfaces
    border-bottom: "1px solid blue-200"
    height: 72px
    button-radius: 0px            # nav buttons sharp; pill is for chips only

  shadow:
    flat:     "none"                                  # default
    lift:     "0 1px 3px rgba(41,60,70,0.06)"         # subtle hover
    rise:     "0 4px 12px rgba(41,60,70,0.10)"        # popovers, dropdowns
    float:    "0 8px 30px rgba(41,60,70,0.14)"        # modals
    monument: "0 16px 60px rgba(41,60,70,0.20)"       # page-on-dark presentation
    rule: "Blue-toned only. Most elements flat. Never combine with border."

layout:
  content-max: 1180px
  section-padding: "clamp(60px, 10vw, 100px)"
  spacing:
    xs:  4px
    sm:  8px
    md:  16px
    lg:  24px
    xl:  40px
    "2xl": 60px
  grid:
    primary: "CSS Grid with named template areas for editorial composition"
    fallback: "Flexbox for component-internal alignment only"
  rules:
    - Asymmetric monumentality over symmetric card grids.
    - Commit to generous voids OR controlled density. No comfortable middles.
    - Do not wrap everything in a container; some things are full-bleed.

motion:
  easing-entrance: "cubic-bezier(0.25, 0.1, 0.25, 1.0)"   # standard ease
  easing-settle:   "cubic-bezier(0.0, 0.0, 0.2, 1.0)"     # ease-out for resting states
  easing-reveal:   "cubic-bezier(0.16, 1, 0.3, 1)"        # scroll reveal
  duration:
    fast:    200ms     # hover, button-press
    normal:  500ms     # entrance, scroll reveal
    slow:    800ms     # hero choreography
  rules:
    - No bounce, no elastic, no spring physics.
    - No linear, no ease-in-out.
    - Vertical motion only on entrance (gravity, not wind).
    - Never animate CSS layout properties.
    - One orchestrated page-load sequence per view (≈1.3s total). Not scattered micro-interactions.

textures:
  grain-overlay:
    use: "dark sections only (blue-950 / dark-blue backgrounds)"
    opacity: 0.03
    blend-mode: overlay
    skip-on: ["white surfaces", "warm-grey surfaces", "photographs"]

photo-overlays:
  bottom-anchor:    "linear-gradient(to bottom, transparent 0%, rgba(26,39,46,0.85) 100%)"
  full-veil:        "linear-gradient(to bottom, rgba(26,39,46,0.5) 0%, rgba(26,39,46,0.3) 40%, rgba(26,39,46,0.7) 100%)"
  warm-cast:        "linear-gradient(135deg, rgba(241,90,41,0.06) 0%, transparent 50%)"
  directional:      "linear-gradient(135deg, rgba(26,39,46,0.9) 0%, transparent 70%)"
  rule: "Photo overlays use blue-950 base (#1A272E), never pure black."
```
