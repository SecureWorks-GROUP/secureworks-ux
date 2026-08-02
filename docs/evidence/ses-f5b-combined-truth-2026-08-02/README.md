# SES F5b — the three make-safe display fixes, checked together

**Task:** `ses-f5b-ux-link-hygiene-land-v1` · **Date:** 2026-08-02 AWST
**Mode:** READ-ONLY against production. Every board and `job_detail` read was a GET;
non-GET requests were aborted by construction. Nothing on the live board was clicked.
No stage move, no record change, no backfill, no deploy. `ses_money_sealed_at` was
never read around, written or discussed as releasable.

**UI read at:** this branch's working tree (`ui_read_at_commit` in `census.json`),
which is PR 230 rebased onto `main` = `e758dc1`.

**Privacy:** every API response was redacted before it reached the browser, so the
screenshots are of redacted data — the site line reads `[street redacted]` and the
client line `Client [redacted]`. No client name, phone, email or street line appears
in any artifact here. Suburb, job number, builder claim ref, PO and link host/path
shape are work references and are retained. Link tokens are masked to `<token>`.

Re-derive everything:

```sh
npm ci && npx playwright install chromium
npm run serve:e2e &                                       # :4173
GIT_HEAD=$(git rev-parse --short HEAD) \
  node scripts/ses-f5b-combined-truth-census.js
```

---

## 1. What was being checked

Three landed display fixes had never been seen on one card:

| | Fix | The claim |
|---|---|---|
| F2 | `#228` | every work order on a card is listed, each named by its own PO |
| F5 | this branch (PR 230) | no branding image, CDN object or SES tracker is offered as a Builder Portal link, and a genuine share survives even when expired |
| F3 | `#229` | the trade portal confirmation stays visible until current-cycle evidence exists |

## 2. Board-wide result (440 cards, one `job_detail` GET each, 0 errors)

| Measure | Count |
|---|---:|
| Cards carrying two or more work orders | **11** |
| ...on which every work order is listed | **11 / 11** |
| Cards where at least one stored link row was refused as a non-portal | **16** |
| Link rows refused board-wide | **62** |
| Cards where the trade portal confirmation is visible | 421 |
| ...that the pre-`#229` lifecycle rule would have hidden | 278 |
| Cards where the trade portal CTA resolved to a refused asset | **0** |
| **Cards exercising all three fixes at once** | **0** |
| Cards exercising at least two | 27 |

The 62 refused rows are `documents.primeeco.tech` (43), `s3*.amazonaws.com` CDN
objects (16) and `awstrack.me` open/click trackers (3) — matching
`ses-links-truth-audit-v1`'s 59 branding images + 3 trackers exactly, from the UI
side and by an independent path.

## 3. The honest finding: no live card carries all three

**The 11 multi-work-order cards and the 16 polluted-link cards are disjoint sets.**
The requested single-card check is therefore not satisfiable against today's board,
and this evidence does not pretend otherwise. What was verified instead:

**a. Live — F5 and F3 together, `SWMS-261079` (Floreat, `MLB-27148`, roof report).**
`ops-live-links-and-confirm-card.png`. Five stored link rows, four refused (three
`documents.primeeco.tech` images and one S3 CDN object), one genuine
`primeeco.tech/share/<token>` kept. The Builder links panel shows exactly one
**Builder Portal** button. The trade module over the same payload keeps the
confirmation visible and returns the share URL as the CTA — and the pre-`#229` rule
would have hidden that confirmation. The card's own trade admin note independently
describes the same defect: "U4 mixes one roof share link with four Prime image assets
as five candidates."

**b. Live — F2, `SWMS-26721` (Eaton, `MLB-25795`).**
`ops-live-multi-work-order-card.png`. Two work orders of two different builder
instructions, **PO-53893** and **PO-53896**, both listed and both named by their own
PO, with the warning stating that neither is preferred because the card declares no
PO of its own. Its four link rows are all genuine shares, so F5 refuses nothing here
— which is the point: the filter does not eat good links.

**c. All three at once, on a composed card.**
`ops-all-three-composed-card.png` + `trade-report-panel-composed.png`. Because the
board has no such card, one was composed from the two real payloads above — the
polluted link rows and trade state of `SWMS-261079` carried onto the two-work-order
document set of `SWMS-26721` — and rendered by the shipped `ops.html` and
`trade.html` code, unmodified. Both halves are real production data; only their
combination is composed, and it is labelled as such in `census.json`.

Measured on that one card:

| | Result |
|---|---|
| Work orders rendered | 2 of 2, `PO-53893` and `PO-53896`, warning shown, none hidden |
| Builder links kept | 1 (`Builder Portal`) |
| Builder links panel contains an image/CDN/tracker URL | **no** |
| Trade confirmation visible | **yes** ("Report completed on builder portal" control present) |
| Trade portal CTA | the genuine share URL, not a refused asset |
| Expired-link guidance shown | yes |

The three do not interfere: the link filter does not disturb the work-order slots,
and neither changes the confirmation's evidence gate.

## 4. Read-only proof

- `requests.json` — every ops-api request of the run with method and action.
  `non_get_requests_aborted: 0`, `violations: []`. Actions read: `pipeline`,
  `makesafe_board`, `makesafe_pipeline`, `makesafe_audit`, `list_intake_drafts`,
  `list_users`, `job_detail`. The page never attempted a write, and any attempt
  would have been aborted before leaving the browser.
- Every URL used `?noAutoIntake=1`, so loading the board did not POST
  `auto_approve_clean_intake_drafts`.
- Nothing was clicked. Both card details were produced by calling the renderer on a
  `job_detail` GET, not by opening the card. The trade panel is the pure
  sentinel-delimited `ReportDoneCore` evaluated on the served page — no login, no
  network call, and the confirmation control was never pressed.
- PDFs and storage objects were never fetched: a PDF cannot be redacted, so the
  document frames in the screenshots are deliberately blank.

## 5. Follow-up this measurement supports

- 62 polluted rows on 16 cards are still STORED. This branch hides them; stripping
  them is a separate captain-gated tranche (`ses-links-truth-audit-v1` §6).
- 0 of the 11 multi-work-order cards declare a PO of their own, so all land on
  "none is preferred" — unchanged from `#228`'s measurement.
