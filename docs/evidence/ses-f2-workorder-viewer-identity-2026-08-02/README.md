# SES F2 — the card viewer no longer picks a work order by age

**Task:** `ses-f2-workorder-viewer-identity-v1` · **Date:** 2026-08-02 AWST
**Mode:** READ-ONLY against production. Every board and `job_detail` read was a GET;
non-GET requests were aborted by construction (see "Read-only proof" below). No stage
move, no record change, no backfill, no deploy. `ses_money_sealed_at` was never read
around, written or discussed as releasable.

**UI read at:** this branch's working tree; the pre-change baseline it is measured
against is `main` = `625dbc1` (`fix(ops): align make-safe UI with canonical board
truth (#227)`).

**Privacy:** every API response was redacted before it reached the browser, and the
embedded PDFs were replaced with a placeholder before any capture (a PDF's contents
cannot be redacted from outside it). No client name, phone, email or street line
appears in any artifact here. Suburb, job number, builder claim ref and PO are work
references and are retained.

---

## 1. The defect, reproduced on the captain's own two cards

`ops.html` filled the card's single "Work Order" slot with
`pickLatestMakesafeDoc(documents, isMakesafeWorkOrderDoc)` — **the most recently
created work-order row**, with no version check, no identity check and no reference
to the card's own purchase order — and `buildMakesafeDocList`'s `matchesNamedSlot`
filter then hid the loser as if it were a duplicate copy.

Read live, read-only, from `job_detail`:

| Card | Suburb | Recorded family | Work orders on the card (created_at) | Old rule showed | Old rule hid |
|---|---|---|---|---|---|
| `SWMS-26852` | Glen Iris | assessment_quote | PO-54000 `11:11:07.028`, PO-53995 `11:11:05.961` | **PO-54000** | PO-53995 |
| `SWMS-26759` | Myalup | ordinary_roof_portal | PO-54176 `01:45:16.777`, PO-54177 `01:45:16.741` | **PO-54176** | PO-54177 |

Both match the captain's spot-check exactly, including the 36 ms tie-break on
`SWMS-26759`: the document he saw was decided by a race.

## 2. What the board now shows

Screenshots below are the live make-safe document viewer, rendered by this branch's
own renderer from the live `job_detail` payload, with client identity redacted first
and the PDFs withheld from the capture.

| File | Shows |
|---|---|
| `swms-26852-viewer.png` | `SWMS-26852`: warning naming both POs, both chips, PO-54000 leading (1 / 2) |
| `swms-26852-viewer-second-workorder.png` | the same card with the previously HIDDEN PO-53995 selected (2 / 2) |
| `swms-26759-viewer.png` | `SWMS-26759`: warning naming both POs, both chips, PO-54176 leading (1 / 2) |
| `swms-26759-viewer-second-workorder.png` | the same card with the previously HIDDEN PO-54177 selected (2 / 2) |

The `*.html` files beside each PNG are the exact redacted DOM that was captured, so
the screenshots can be re-read rather than taken on trust.

**On "the right one selected": neither of these two cards can name a right one, and
the UI now says so instead of implying it.** Their builder ref is a CLAIM ref
(`MLB-26183`, `MLB-25765`), not a purchase order, and `purchase_orders` on both is
empty — so the card declares no PO for rule 1 to match. The viewer therefore applies
rule 2: it lists **both**, labels each by its own PO, and states plainly *"Nothing on
this card says which instruction it is, so none is preferred. Read the PO on each
before acting."* The leading chip is still the newest row, but it is no longer
presented as a decision. Which instruction each card actually is remains a records
question (audit `ses-family-truth-audit-v1` §1b, F3/F4) — not something the client
may invent.

Rule 1 is live-reachable, not dead code: live builder refs run the claim straight
into the PO (`MLB-27227PO-56922`), and where a card carries one, that work order
leads and is marked as the match. It is covered by
`tests/e2e/ops-makesafe-workorder-identity.spec.js`.

## 3. Board-wide census — `census.json`

Produced by `scripts/ses-f2-workorder-identity-census.js`, which reads all 440 cards
and their `job_detail` payloads through the same read-only route guard.

```
cards on board                                     440
  no work order at all                              19
  exactly one work order                           410
  MORE THAN ONE WORK ORDER                          11
of those 11:
  the old rule hid a DIFFERENT purchase order       10
  the card declares a purchase order of its own      0
  every work order is now listed                    11
  job_detail read errors                             0
```

The 11: `SWMS-26462`, `SWMS-26721`, `SWMS-26735`, `SWMS-26736`, `SWMS-26759`,
`SWMS-26852`, `SWMS-26853`, `SWMS-26855`, `SWMS-26902`, `SWMS-26957`, `SWMS-26998`.

Two are new relative to the family audit's nine AMBIGUOUS cards:

- **`SWMS-26902` (Ballajura)** carries PO-56252 and PO-55255 — two different POs on
  one card, so the old rule hid a different instruction here too. It is not in the
  audit's §1b list. **Flagged for the records track; this change does not touch it.**
- **`SWMS-26462` (Aveley, AJBR)** is the one genuine duplicate: `Works Order - AJBR
  67380.pdf` and `Works Order.pdf`, neither carrying a PO. It now shows both, labelled
  `Work Order · no PO on file name #1 / #2`, rather than silently one. That is a
  small cost of never dropping a document, and it is the honest side of the trade.

**Zero of the 11 declare their own PO,** so on today's board every one of them lands
on rule 2. That is a measurement, not a design choice: nothing on these cards can
name the right instruction.

## 4. Read-only proof

- `requests.json` — every ops-api request of the census run, with method and action.
  `non_get_requests_aborted: 0` and `violations: []`: the page never even attempted a
  write, and any attempt would have been aborted before leaving the browser.
- Every URL used `?noAutoIntake=1`, so loading the board did not POST
  `auto_approve_clean_intake_drafts`.
- Nothing was clicked on the live board. The two named cards were rendered by calling
  the renderer on a `job_detail` GET, not by clicking into the card.
- The `chrome-devtools-axi` session carried its own belt-and-braces guard: `fetch`
  and `XMLHttpRequest.open` were wrapped to refuse any non-GET. It recorded zero
  blocked calls, i.e. nothing tried.

## 5. How to re-derive everything here

```sh
npm ci && npx playwright install chromium
npm run serve:e2e &                                    # or any port
GIT_HEAD=$(git rev-parse --short HEAD) \
  E2E_BASE_URL=http://127.0.0.1:4173 \
  node scripts/ses-f2-workorder-identity-census.js     # census.json + requests.json
npx playwright test tests/e2e/ops-makesafe-workorder-identity.spec.js
```
