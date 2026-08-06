# The portal roof capture as a document tab — Docs Ready review pane

**Date:** 2026-08-06 · **Proof card:** Mindarie `SWMS-261081` (`MLB-27100`, family
`ordinary_roof_portal`) · **Surface:** `modules/ops-makesafe-reporting-cockpit.js`,
the "review & send" pane.

Suburb and job reference only. No client name, phone, email or street address
appears here, and **no capture, screenshot of a capture, or extract from one is
committed to this repo** — the committed screenshots render a drawn facsimile
(`tests/e2e/fixtures/ses-roof-capture-mindarie.js`).

---

## The bug, confirmed before changing anything

Both contributing causes named in the brief were checked live.

1. **Server-side labelling is thin.** Not changed here (the producer lives in the
   backend repo). See "What is still invisible by default" below.
2. **The client had its own role-to-tab allowlist.** Confirmed: it was
   `_msSesDocsFromArtifacts`, which mapped exactly six roles
   (`xero_invoice_pdf`, `supporting_report_pdf`, `swms_artifact`,
   `source_attachment`, `completion_photo`, `sibling_photo_evidence`) and
   dropped every other artifact — including `portal_roof_report_screenshot`,
   which the pack served with a working signed URL. That is why an Invoice tab
   appeared despite the server labelling no such role: the client had always
   been deciding tabs on its own.

Live pack read for `SWMS-261081` (read-only, `get_ses_reviewable_pack`):
14 artifacts, `suppressed_artifacts: []`, of which **three carry document
bytes** — `portal_roof_report_screenshot`, `source_attachment`,
`xero_invoice_pdf`. The other eleven are JSON/text/HTML plan artifacts.

## The fix shape chosen: CLIENT ONLY, and structural rather than one more entry

The client no longer holds a role allowlist. `_msSesArtifactIsDocumentBytes`
decides what may become a document — **PDF or image bytes with a signed URL** —
and the role name is consulted only to give the tab a good NAME. A role this
screen has never heard of now appears under its stored file name and says so,
instead of vanishing.

A client-only fix was chosen because the server label lives in another repo and
the backend worker could not close this from that side; this unblocks the
Captain today without waiting on a producer change. Making it a media-type rule
rather than "add two more roles to the list" is what keeps the trap from
re-arming.

### What is still invisible by default

- **A new role whose bytes are JSON, text or HTML gets no tab.** That is
  deliberate — those are plan artifacts (`invoice_proposal`, `*_email_draft`,
  `review_spec`, `release_payload`, `review.html`), and the routes and invoice
  sections render their content. But it means a future producer that ships a
  readable document as HTML would still be invisible here.
- **`sesReviewArtifactDisplayLabel` is unchanged and still returns `null` for
  13 of 14 roles.** So the tab NAME for any role the client has not been taught
  is the stored file name, not a human label. Teaching the server to label its
  own artifacts remains worth doing; it is now a cosmetic gap rather than an
  invisibility one.

## Two identical documents: ONE tab, and it says so

Identical bytes (same `content_hash`) collapse to a single tab whose stage
reads `N identical copies stored (same bytes) — shown once`. Two tabs would read
as two different observations of the roof, which is worse than one. Captures
whose bytes **differ** each keep a tab (the `<makesafe-workorder-identity>`
rule: no surface may pick one and hide the rest), and captures with no recorded
hash are never merged, because identity cannot be claimed without evidence.

**Nothing was deleted or deduplicated in storage.** The duplicate rows stand
exactly as they are.

## Provenance and honesty

- The capture states **when it was taken** and **what the observer saw**,
  quoted verbatim from the pack's own `portal_roof_report` manifest.
- A capture that predates the card's current re-attendance, or that names a
  different attendance cycle, is labelled **"from an earlier attendance visit"**.
  On a re-attended card whose capture names no visit, the pane says exactly that
  rather than implying the capture is current.
- **"No extractable text" is never treated as "empty".** The stage says the
  capture is an image of the form and points at the full-size read.
- **A card that owes a capture and has none says so** in an amber block where
  the tab would have been (`.msr-evidence-gap`), quoting the backend's own
  reason and recovery action when it supplies them. No document from any other
  card is ever substituted.
- **No gate changed.** `controls.approve_invoice` / `controls.send_it` are
  untouched; this pane only shows more of what already exists.

## Live verification (read-only)

The branch was served locally and driven with `chrome-devtools-axi` against the
LIVE API. Opening `SWMS-261081` in the review pane:

```
tabs                 ["Roof Report Capture", "Invoice", "Work Order"]
active tab           Roof Report Capture
stage image          1200x800 natural, rendered on the stage, "Open document" hatch present
stage meta           ROOF REPORT CAPTURE · Captured 06 Aug 2026, 08:31 am
what the observer saw  submitted/locked observed, 21 of 23 fields answered
```

Before this change the same pane showed only `["Invoice", "Work Order"]`.

No write action was invoked: the session called `makesafe_board`,
`list_ses_docs_ready_reviews`, `query_ses_review_cockpit`,
`get_ses_reviewable_pack` and one signed-URL read of the capture manifest.

## Finding: the pack's capture PROVES SUBMISSION, it is not the form

This is the one place the brief's premise did not survive contact with the live
data, and it is recorded here because it changes what the Captain can do with
this screen.

- The pack's `portal_roof_report_screenshot` is a **66 KB, 1200x800 observation
  placard** produced by `capture_portal_evidence.py/v1`. Rendered, it reads
  *"Prime portal observation — This form has been locked or submitted"* over four
  fields (card, builder reference, observed state, observed at) and a panel
  marked **"Job details panel redacted before capture"**. It is evidence that the
  form was submitted and locked. **It is not the roof report form.**
- The readable roof report is a **4-page, image-only PDF stored on the job**
  (`job_documents`, `type: roof_report`) — the artifact the brief describes.
  It is stored **twice**, byte-identical
  (`sha256:1711bd6421d7a240822d874969540aff6ca781be942a9ce70f652b1f36f3e8a2`,
  534,248 bytes each), the original and a `- RETAKE` copy whose only difference
  is the file name. **That pair is not in the pack**, so the review pane — which
  renders the byte-exact pack and nothing else — cannot show it.

So this change makes the capture the pack HAS visible, correctly labelled. It
does not put the readable form on the review screen, because the pack does not
carry it. Closing that needs one of:

- **the backend** attaching the stored `roof_report` PDF to the docket as a pack
  artifact (then it becomes a tab here with no further client change — that is
  the point of the media-type rule); or
- **a Captain-level ruling** that this pane may show a job document that the
  hash-bound docket does not include, clearly marked as outside the pack.

The second crosses the pane's byte-exact-pack boundary, so it was not taken
unilaterally.

## Reproduce

```
node modules/ops-makesafe-reporting-cockpit.smoke.mjs        # the behavioural guards
node scripts/ses-roof-capture-review-shot.js <out-dir> roof  # the screenshots below
```

- `roof-capture-present.png` — the capture as a first-class tab, open, its
  provenance stated, the form readable on the stage (drawn facsimile).
- `roof-capture-missing.png` — the same roof card with no capture: no tab, and
  the gap stated in words with the backend's reason and recovery action.
