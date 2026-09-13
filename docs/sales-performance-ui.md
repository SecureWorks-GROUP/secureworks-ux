# Performance view integration

`ops.html` routes desktop/mobile Performance beside Materials and restores `#performance` / `sw_ops_tab`. `modules/ops-sales-performance.js` calls the existing authenticated `opsFetch('sales_performance_read', {week_start})` once per selection; default omits week_start. No direct provider calls or writes occur in this module.

The adapter reads current desk payloads verbatim. Patio reads the conversation artifacts (`enquiries_in`, elapsed median/worst, unanswered_no_reply, queues.answered). Fencing reads opportunity creations, substantive_non_template response clocks, unanswered text counts and document-evidenced quote sends. CRM closed-won is never displayed as the accepted-job measure. Each empty stage retains its reason and collector gaps are available under Coverage map. Source calculations and retrieval times are separate. Missing lane rows are checked independently of the latest-calendar-week flag.

Rolling counts sum A1/C1 over returned calendar slots and show n of 4. The Patio contact rate recomputes from total answered queue membership / total eligible enquiries and requires four complete collection denominators. Snapshot counts and medians are not added. Current response outcomes are observed at collection time, not a historic week-end snapshot; that collector limit remains in coverage.

## Extension seams (Patio drilldown/notes owner)

- `window.SalesPerformance.state`: `{data, week, section, loading, error, request}`. `data` is the unchanged read envelope.
- `SalesPerformance.load(week?)` rereads; `SalesPerformance.render()` redraws the current shell.
- Bubbling `sales-performance:render` from `#salesPerformanceRoot`: detail `{data, week_start}`. It fires after a successful redraw. Use it to mount notes under `#salesPerformanceNotes` (`data-performance-notes`). Loading/error states intentionally have no notes mount.
- Bubbling `sales-performance:drill`: detail `{lane, week_start, measure, label, queueKey, row, trigger}`. `trigger` allows focus restoration. `row` can be null. Measure IDs are the approved A1–A4, B1–B3, C1–C4, H and R display rows.
- Actual queue keys are retained: Patio enquiries/answered/unanswered_no_reply/hygiene; Fencing quality_cases/quotes/cash_chain/hygiene/fencing_overdue. A1 Fencing has no matching retained named queue; use source IDs/coverage instead of substituting a different population. The default display queue key is only a lookup hint, not proof that the queue exists or matches a numerator. Consumers must inspect `row.queues` and the source definition.
- There is no drill panel or notes editor in the shell. The next owner adds each once.

## Verification

`node --test modules/ops-sales-performance.test.cjs`: eleven tests covering empty/partial/stale states, missing vs zero, rolling sums and denominator requirements, week isolation, XSS escaping, request race, authenticated host fetch, and nav/restore wiring.

Synthetic-only browser fixture and captures: `.impeccable/review/`. Captured at 1440×1000 and 390×844 using the installed Chrome and cached Playwright-core after the preferred chrome-devtools-axi bridge failed before launch. No installs. View title, width, section position and document overflow were read before capture. No page-level horizontal overflow in either size. Response plots fit the phone width; the shared ticks, two-hour target and median/worst values remain visible without chart scrolling.

The current host-* screenshots and host-proof.json verify the actual ops.html host with every network request intercepted, a synthetic signed-in cloud object, and fictional report queues. They cover hash restore, saved-tab restore, desktop/mobile Performance button activation, selected-week GET parameters, 503 display and Retry recovery. They assert no page/plot overflow and an opening heading within the first 200 pixels at both sizes. The real login exchange, live role enforcement, provider response correctness and other Ops routes were not exercised. Parent owns independent approved-mockup review. Detector returned no findings. No backend deployment, report publication, notes write, commit or push was performed.

## Finish-review fixes

The opening now includes available lead, response, unanswered and quote-value evidence while naming different populations. The funnel restores outer-end values, fine row rules and compact spacing. Response plots use a shared tick scale, two-hour marker and visible median/worst hierarchy. Patio unanswered age bars and Fencing open/over-24-staffed-hour squares render only from retained queue ages; incomplete membership produces a specific distribution gap. Measures are grouped by tiers with compact unavailable chips and paired mobile lane cells. Week buttons replace the select; rolling measures keep Patio left and Fencing right.

Host capture exposed an incumbent inline display:flex on inactive Approvals. A Performance-only body class hides that inactive view and the overflowing mobile search control, preserving the brand and other routes. The mobile table caption has an explicit full-width block layout. No detector rerun was made.

## Fencing Stratco week panel (filed read)

`#fencingStratcoWeekRoot` sits above `#salesPerformanceRoot` inside `#viewSales`
and is painted by `modules/ops-fencing-stratco-week.js`. It is deliberately NOT
mounted into `#salesPerformanceNotes`: that seam is wiped on every Performance
render and is absent in the loading and error states, and this panel must stay
readable when the weekly report cannot load at all. The `sales-performance:drill`
/ `sales-performance:render` / `#salesPerformanceNotes` seams are untouched; the
module only listens to `sales-performance:render` to repaint itself.

Its figures come from a FILED read of 20:04 Perth, Sunday 13 September 2026,
checked in at `docs/evidence/fencing-stratco-week-2026-09-13/` and copied into
the module so the browser needs no fetch. `ops-sales-performance.test.cjs`
asserts the copy still equals the file, so the two cannot drift.

Three rules hold this surface:

- Every figure carries the read time and the evidence file it came from.
- A figure with no evidence renders as unmeasured, never as zero. Four are named
  that way today, including Khairo's own calendar, which was not read.
- A filed figure is never dressed as a live one. Where a live read is present,
  `reconcile()` matches it by event id and states any difference rather than
  smoothing it away. `reconcile(read, surface)` takes the surface so the panel,
  which has four tiles and no grid, never describes a week of blocks.
- A figure the filed evidence cannot rebuild carries a caveat on its own tile.
  Visits agreed is the one: the read states 8 and its own thread record
  enumerates 7, so the tile says "Not settled" and the eighth is named in the
  unmeasured column. The 8 is not changed to a 7 and the eighth is not invented.
  Settling it needs the agreement threads re-read, not a different number here.

The whole page, not only this panel, is held to the no-em-dash rule: the empty
measure cell reads "No reading" rather than a dash glyph, and the guard in
`ops-sales-performance.test.cjs` runs over `SalesPerformance.renderHTML` in all
four of its states.

Guard: `modules/ops-fencing-stratco-week.test.cjs` (22 tests: the four figures,
each breach by ref, agreed time, calendar time and full event id, both
zero-travel adjacencies, the protected band's travel reason, unmeasured versus
zero, filed versus live reconciliation, scope, and the no-PII / no-em-dash rule).
It runs under `npm run test:stratco-week` and `npm run test:sales-booking`, and
inside `npm run test:e2e`.

Search `<fencing-stratco-filed-read>`.
