# Ops calendar day-cell rules — `ops.html` (2026-09-04)

The Schedule view's month grid drew a vertical rule between day columns but no
horizontal rule between week rows, so job bars, "Shaun away" strips and multi-day
cards ran across the grid with nothing to say which day a card sat on.

The between-week line was styled with `.cal-schedule-week + .cal-schedule-week
{ border-top: … }`, but `renderScheduleView` emits a bar-overlay div after EVERY
week, so two week divs are never adjacent siblings — that selector only ever
reached the first week row (the header div is itself a `.cal-schedule-week`). In
a month range that left six rows of day cells with zero horizontal separation.

## What shipped

- `.cal-schedule-cell` gains `border-bottom: 1px solid var(--sw-border)` beside
  its existing `border-right`, so the rule is drawn by the CELL — the thing that
  must be delineated — rather than by a sibling selector the overlay breaks.
- `.cal-schedule-grid > .cal-schedule-week:nth-last-child(2) .cal-schedule-cell`
  drops that bottom rule on the LAST week row, whose cells sit directly inside
  the grid's own 2px border; a rule there separates nothing and would read as a
  3px bottom edge against 2px on the other three sides. It is `:nth-last-child(2)`
  and not `:last-child` because each week div is followed by its bar-overlay div,
  so no week is ever the grid's last child.
- The adjacent-sibling selector is deliberately KEPT — it still draws the header
  separator, and removing it shrinks the grid by 1px.
- The Crew (swimlane) view is deliberately untouched: it already rules its cells
  through the grid container's `gap: 1px` over a `var(--sw-border)` background.

Geometry is unchanged, which is the load-bearing claim: cells are
`box-sizing: border-box` with a `min-height`, so the border consumes content box,
not outer box.

## Regenerating

```
npm ci
npx playwright install chromium
node scripts/cal-month-border-shot.js docs/evidence/ops-calendar-day-borders-2026-09-04/after month
```

The out dir and the range mode are both optional; they default to
`docs/evidence/ops-calendar-day-borders-2026-09-04/after` and `month`. Pass `2w`
or `1w` as the second argument to re-check the other two ranges, which share the
`.cal-schedule-cell` class and gain the same rule:

```
node scripts/cal-month-border-shot.js /tmp/cal-2w 2w
node scripts/cal-month-border-shot.js /tmp/cal-1w 1w
```

The harness spawns its own `python3 -m http.server` on 127.0.0.1, aborts every
request that is not that local origin, and refuses to run if the port is already
bound by someone else's server (which would serve a different checkout's
`ops.html`). Nothing is fetched — no Supabase, no CDN.

## The fixture

`scripts/cal-month-border-shot.js` carries the fixture inline and renders the
SHIPPED `renderScheduleView` / `renderSwimlaneView` against it. August 2026,
week beginning Mon 3 Aug, with:

- five assignments across patio / fencing / decking, four of them multi-day and
  one (Cara Chen, 11–13 Aug) `confirmed` so the confirmed bar styling is covered;
- crew leave producing the "Shaun away" (12–13 Aug) and "Henry away" (19 Aug)
  day strips, plus one `unavailable` crew day;
- invented names, suburb and street only — no client data.

## The shots

`before/` is the genuine pre-fix baseline, captured from the unmodified code, and
has NOT been regenerated. `after/` is regenerated from the shipped code.

- `before/month-schedule.png` — month Schedule view with NO horizontal rules: a
  flat white field from the header line straight down. Its bottom ~48px are
  covered by the fixed Jarvis ambient bar, because the harness did not yet hide
  that chrome when this baseline was taken.
- `after/month-schedule.png` — the same render with a 1px `var(--sw-border)` rule
  between every pair of week rows, and the grid's bottom edge still a single 2px
  border (no rule stacked inside it). The Jarvis bar is now hidden for the shot,
  so this pair differs in that chrome as well as in the rules; the region the fix
  is judged on — the week rules — is in the shared area both shots cover.
- `before/month-crew-swimlane.png` / `after/month-crew-swimlane.png` — the Crew
  month view, byte-identical, proving it was correctly left alone.

Both pairs are 1400×571 (Schedule) and 1400×375 (Crew) before and after: the
image dimensions are the geometry check made visible.
