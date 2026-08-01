# Ops make-safe board → canonical `makesafe_board` (Phase C4) — verification evidence

Captured 2026-08-01 by serving this branch's `ops.html` on `127.0.0.1:4179` and pointing it
at the production ops-api. The capture harness blocked every non-GET request to
`/functions/v1/**` at the browser-context level, so the run was strictly read-only
(one `POST auto_approve_clean_intake_drafts` was attempted on board entry and blocked).

Feed identity confirmed live in the page: `contract_version: makesafe-board.v1`,
`projection: ops`, `parity: { ok: true, checked: 440, errors: [] }`.

## Counts — before vs after

| Column | Before (`makesafe_pipeline`) | After (`makesafe_board`) |
|---|---|---|
| New | 64 | 36 |
| Allocated | 35 | 30 |
| Trade Report In | 12 | 12 |
| Docs Ready | 30 | 24 |
| Completed This Week | 2 | 2 |
| Archive | 264 (`history=all`) / 126 as shipped | 303 |
| Cancelled | 33 | 33 |
| **Total rows** | **440** (`history=all`) / **302** as shipped | **440** |

Both feeds return the identical 440-job set at `history=all`, so the only difference is
placement: **42 cards** sit in a different column because the captain display ledger
(`status_application`) is now applied — 39 into Archive, 3 into Allocated. The shipped
board also under-fetched Archive (126 vs 303) because it never asked for full history.

## Named checks

| Card | Before | After |
|---|---|---|
| `SWMS-261124` (ruled archive) | Docs Ready | **Archive** ✔ |
| `SWMS-261118` → survivor `SWMS-261065` | New | **Archive** ✔ |
| `SWMS-26998` → survivor `SWMS-26736` | Allocated | **Archive** ✔ |
| `SWMS-26791` → survivor `SWMS-26787` | Docs Ready | **Archive** ✔ |
| `SWMS-261123` (roof report) | Docs Ready | Docs Ready — unchanged ✔ |

All three duplicate-survivor losers are absent from every live column and present exactly
once in Archive.

## Card-level differential (440 cards, old renderer vs new, same live payloads)

Of the 398 cards that did not change column, the full set of rendering differences is:

- **all 398** — the `REP` doc tile is now spelled `REPORT` (requested rename).
- **163** — unallocated cards stop rendering a crew chip built from the backend's literal
  `crew_label: "Unassigned"` sentinel with the caption "On the job"; they now use the real
  empty-crew chip ("Unassigned · no crew yet" / "Needs allocation"). 49 of those also stop
  claiming a Trade stage of "Allocated" when nobody is allocated.
- **6** — allocated cards list crew in assignment order instead of the enriched label's
  order; `SWMS-26416` also drops a duplicate ("Kim Muiruri + Marnin + Kim" → "Kim + Marnin").
- **3** — `SWMS-26847`, `SWMS-26846`, `SWMS-26001` read "Report submitted: PDF missing"
  instead of "awaiting trade report", because the canonical feed reports the service
  report's own status (`submitted`) rather than the job-level `processed` rollup.

Assignment-date lines, builder names, refs, intake dates, age/SLA pills, doc counts and
type labels are byte-identical on every unmoved card.

## Screenshots

| File | What it shows |
|---|---|
| `00-before-declared-stage-board.png` | The board on `main`: `SWMS-261124` still in Docs Ready, all three duplicate losers in live columns |
| `01-after-canonical-board.png` | The board on this branch: canonical columns, card key open, degraded banner, truth strip |
| `02-card-key-open-by-default.png` | Card key legend, open by default, with the `Report` tile spelled out |
| `03-degraded-intake-exception-banner.png` | The non-blocking "Intake exception panel degraded" banner (live production state) |
| `04-swms-261123-roof-report-unchanged.png` | `SWMS-261123` still in Docs Ready |
| `05-swms-261124-under-archive.png` | `SWMS-261124` under Archive |
| `06-duplicate-survivor-loser-archived.png` | Duplicate-survivor loser `SWMS-26998` under Archive |

## Regression guard

`tests/e2e/ops-makesafe-canonical-board.spec.js` — 11 specs covering canonical placement,
the enrichment join's inability to move a card, the whitelist containing no stage key, the
degraded banner, the contract-version gate, the builder fallback and the legend defaults.
