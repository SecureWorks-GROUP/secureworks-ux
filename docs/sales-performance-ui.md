# Sales > Performance

The live mount is `#salesPerformanceRoot` in `ops.html`, loaded through `__swOpsStampAssets`. `modules/ops-sales-performance.js` owns rendering and calls the existing authenticated `opsFetch('sales_performance_read', {week_start})`. Default load omits `week_start`. `modules/ops-sales-booking.js` owns the Sales subtab and `#performance` restore. Styles are scoped in `modules/ops-sales-performance.css`.

The renderer consumes published `rows` keyed by `week_start` and `lane` (`fencing`, `patio`). The row's `metrics` carries daily lead-source series, quote and win evidence, reply clocks, pipeline snapshots, actions, and prior measures. `coverage.gaps` overrides readings. It does not infer acceptance from CRM stage or deposit invoices, combine lane medians, compare first enquiries with CRM creations, or compare all quotes with tracked documents.

All / Fencing / Patio and lead-source controls operate on the selected week. In All, Quotes sent, Quoted value and Won use both lanes when both are measured. If only one lane is measured, that lane’s figure is shown with `(fencing)` or `(patio)` in the label, the same way Reply time already names fencing. A dash is only for both lanes missing or the selected single lane missing. Last-week comparisons for those three KPIs follow each KPI’s own cover. The opening story uses one leading lane label, the other-lane missing clause, and that lane’s lost and tracked figures only when those three covers all share the same single measured lane. When any of them is combined or the covers disagree, lost and tracked stay a dash and any remaining single-lane figure is named on its own phrase. The missing-row notice follows that same shared cover. Source filters use published daily series and source-tagged actions, wins and quote rows; unsegmented pipeline and reply measures become unavailable. Declared gaps override derived totals. Genuine zero and absent values remain different.

The six figures compare like-for-like flattened prior keys when present. Same-shape prior clones are not read. A labelled single-lane KPI compares that lane’s prior only. Ages are calculated at the Monday after the selected week, keeping historic reports reproducible. Urgent Stratco commitments also count in their owner's total. Cash landed stays separate from accepted work.

A compact per-rep table sits directly under the six numbers. It always has one row each for Khairo, Nithin and Marnin, filtered by the active lane and lead source, sorted by won value then customers waiting. Won count and value come from `wins.rep`. Customers waiting and Over a week come from `actions.owner`. Quotes sent and Quoted value come from `quote_rows.rep` when that field is present; otherwise those cells stay a dash labelled “not in store yet”. The table has no bars.

Customer identity uses `action.contact_id` to read an optional authenticated envelope `contacts_by_id[id].name`; otherwise it uses the stored suburb, then `Customer`. Names embedded in `metrics.actions` or `metrics.wins` are never rendered. No extra contact read is made. The supplied example has no contact IDs or suburbs, so the offline review deliberately uses `Customer`.

The `sales-performance:render` event and `#salesPerformanceNotes` mount remain available. The former tier-table adapter and measure drill events were removed with that presentation; no other checked-in module consumes them.

## Offline review and evidence

Run `python3 scripts/sales-performance-preview.py`, then open `http://127.0.0.1:4187/ops.html#performance`. This serves the actual Ops host with a synthetic auth session and the example reporting envelope, intercepts external reads, refuses external writes and adds a same-origin CSP. No credentials, provider access or report publication is involved. This harness is local review only and is not used by production.

For the report alone, serve the repo and open `tests/fixtures/sales-performance.html`. Both paths use `tests/fixtures/sales-performance-week.json`, split from the supplied edition specimen into row-owned lane measures. Customer names, including the name inside one action's owed text, are omitted.

`npm run test:sales-booking` covers the reporting adapter and existing Sales workspace tests. Browser evidence is in `docs/evidence/sales-performance-tab-20260922/`. It verifies the actual host at 1320px and 390px, light and dark, an 11px minimum report text size, no horizontal overflow, the per-rep table, All-view labelled fencing quotes and wins with that lane’s lost, tracked and last-week figures, filters, quote expansion, safe section navigation, empty/error recovery, and the signed-in reader's selected-week parameters.

The Design desk's final 8/10 approval and the no-mistakes/PR pipeline are separate handoff gates; these local checks do not claim either. Live backend contents and the optional contact-name enrichment were not accessed.
