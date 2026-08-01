# PLAN v2 Batch 2 — UI truth, verified on the live board (2026-08-02)

Branch `fm/ses-b2-ui-truth-v1`. Authority: `ses-plan-v2-synthesis-v1` §D "Batch 2" + §D.0.
Ground truth being corrected: `ses-ui-ground-truth-v1` (2026-08-01, 417 rendered cards).

## Every number here is reproducible

One command produces this whole directory except this file:

```
npm run serve:e2e &                                  # serves this working tree on :4173
node scripts/makesafe-ui-truth-census.js --shots
```

The script opens the real board — this working tree's `ops.html`, the live
`ops-api` feeds — measures it card by card, and writes what it measured. Nothing
below is counted by eye off a screenshot. The artifacts are:

| File | What it is |
|---|---|
| `census.json` | population identity, every total quoted below, the privacy scan result |
| `cards.csv` | the per-card DOM ↔ canonical-feed join every total is computed from (440 rows) |
| `requests.json` | every `ops-api` request of the session: method, action, HTTP status |
| `console.json` | every console message of the session |
| `*.png` | the captures listed at the bottom, taken in the same session |

**Write safety is enforced, not asserted.** Every request the page makes is routed
through the script; a non-GET is aborted and fails the run. `requests.json` records
10 requests, all GET, zero non-GET. The board is opened as
`ops.html?noAutoIntake=1#jobs` because loading it otherwise POSTs
`auto_approve_clean_intake_drafts`.

**Privacy is enforced, not asserted.** Every response body is redacted *before* it
reaches the browser, so client data never enters the DOM and therefore cannot enter
a capture:

- client names → `Client [redacted]`;
- street lines → `[street redacted]` (an address keeps only its suburb tail);
- phone numbers → `[phone redacted]`;
- email addresses → `[email redacted]`;
- embedded document previews (work-order and invoice PDFs, whose contents this
  script cannot redact) are never loaded, and are replaced with a placeholder
  before any capture.

Retained on purpose: **suburb, builder name, builder reference and job number** —
work references, not client identity. After rendering, the DOM is scanned for
phone / email / street patterns and the run fails if any survive: this session
scanned **0 emails, 0 phone numbers, 0 street lines**.

## Results

Population: the **440** `makesafe-board.v1` rows the board rendered with Archive
and Cancelled expanded (new 36, allocated 30, trade report in 12, docs ready 24,
completed 2, archive 303, cancelled 33). The 10 cards in the Intake column are
intake *drafts*, not canonical rows, and are excluded.

| Check (Batch 2 exit criteria) | Result |
|---|---|
| Family-tag agreement vs canonical `ses_family` | **440 / 440 agree, 0 disagree** (was 74 wrong of 407). The 407-card figure is the same population with Cancelled collapsed. |
| Detail badge vs board column | **0 / 440 contradict.** The pre-change client derivation, emulated over the same 440 rows, contradicts the column on **325** of them — **59** of those would have offered a forward move on a card the board had already archived, cancelled or completed. |
| `ses_family_label` vocabulary | one spelling per family across all 440 rows (`MakeSafe` 176, `Temporary Fence MakeSafe` 126, `Roof Report` 61, `Assessment / Quote Report` 54, `Restoration` 1, and 22 rows whose canonical family is `unknown`, rendered "Family not determined"). |
| Docs Ready honesty | 24 cards. **1** has a drafted pack by canonical truth (`pack.state: sent`); the other **23** render the "No pack drafted" chip, and the column header reads "1 of 24 with a drafted pack". |
| Links on the card face | **269 builder-link anchors across 122 of the 440 cards** (was 0 anchors on 407 cards). |
| Acceptance shot per family | 6 shots below, one per `ses_family` present on the board. |
| Console | 4 messages, **0 errors**. |

### Corrections to the first version of this file

The first version of this README asserted three numbers this census does not
support. They are corrected above, and the artifacts show why:

- "24 / 24 with no drafted pack" → **23 of 24**. One Docs Ready card's canonical
  row carries `pack.state: sent`. The earlier figure came from the report-drafts
  feed, which is the enrichment side-channel this batch was told not to use as
  evidence; the canonical row is the admissible source and it disagrees.
- "94 anchors on the visible board" → **269**, because this census expands Archive
  and Cancelled and so counts all 440 cards, not the default subset.
- "80 material contradictions" → replaced with **59**, under a definition the
  script actually computes: a pre-change detail stage that was live while the
  board column was terminal.

### The 6 ground-truth spot-checks, re-verified

Every column below is a field in `cards.csv`; the "before" column is
`legacy_detail_stage`, the stage the pre-change derivation produced for that row.

| Job | Board column | Detail badge before | Detail badge now | Forward-move button now |
|---|---|---|---|---|
| SWMS-261099 | Archive | New (declared `new`, canonically archived) | **Archive** | none — "moving it would undo the archive ruling" |
| SWMS-261059 | Docs Ready | Docs Ready | **Docs Ready** | its own live next step only |
| SWMS-26980 | Trade Report In | Docs Ready | **Trade Report In** | its own live next step only |
| SWMS-261109 | Trade Report In | Docs Ready | **Trade Report In** | its own live next step only |
| SWMS-26934 | Allocated | New | **Allocated** | its own live next step only |
| SWMS-26597 | Archive | Completed | **Archive** | none |

## Screenshots

| File | Shows |
|---|---|
| `00-board-docs-ready-honesty.png` | The board: Docs Ready 24 with "1 of 24 with a drafted pack", "No pack drafted" on the cards with none, canonical family tags, builder-link chips on card faces |
| `01-family-assessment-quote.png` | `assessment_quote` — "Assessment / Quote Report" |
| `02-family-ordinary-roof-portal.png` | `ordinary_roof_portal` — "Roof Report" |
| `03-family-physical-makesafe.png` | `physical_makesafe` — "MakeSafe" |
| `04-family-restoration.png` | `restoration` — "Restoration" |
| `05-family-temporary-fencing.png` | `temporary_fencing` — "Temporary Fence MakeSafe" |
| `06-family-unknown.png` | `unknown` — "Family not determined", not a text guess |
| `10-detail-archived-SWMS-261099-header.png` | The counterpart to ground truth `shots/13`: the archived card now opens **Archive · archived**, not "New · 4 days old" |
| `11-detail-archived-SWMS-261099-next-step.png` | Next step on the same card: no forward move, against the trade note saying it must stay archived |

## Out of scope here (unchanged on purpose)

- The per-family **evidence/chip recipe** and any per-family required-link rule —
  captain decision C.4, deliberately not implemented (D "what could go wrong").
- Roof primary-link selection / classifying `builder_portal` links (G5, C.4);
  the card renders every link the row carries, including undifferentiated ones.
- The Docs Ready column keeps its name and meaning; only the false implication
  that a pack exists was removed.
