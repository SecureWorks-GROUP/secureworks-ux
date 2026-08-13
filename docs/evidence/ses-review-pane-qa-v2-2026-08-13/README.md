# Docs Ready review pane — QA v2 (fm/review-pane-qa-v2)

> Stage sizing (fix 1 below) superseded by
> `docs/evidence/makesafe-review-pdf-viewer-zoom-2026-08-13/`: the stage is a
> BOUNDED viewer again (viewport-relative height, zoom cluster, document
> scrolls inside). Fixes 2–4 remain current; owner contract in `AGENTS.md`.

Captain live proof 2026-08-13 ~15:46 Perth: PR 262's review pane was still
unusable live. This branch is the isolated UX follow-up. No pack-build rewrite,
no send, no backend stage-engine change.

## Why these are offline captures

The live make-safe board requires an operator Supabase session
("Require operator identity before loading public dashboard shells", #258). The
background agent has no such session (every `ops-api` call returns 401), so the
live five-card QA could not be driven from here. Instead this uses the
documented OFFLINE pattern (the same one behind
`scripts/ses-review-pane-proof-shot.js` and the Bertram fixture): serve
`ops.html` from disk and render the SHIPPED `_msSesRenderDetail` against
family-shaped fixtures whose signed URLs point at real localhost sample bytes.
The fixtures mirror the SHAPES the captain named (identity facts only — suburb +
job number + builder routing, never client name / phone / street).

Regenerate:

    node scripts/ses-review-pane-qa-v2-shot.js docs/evidence/ses-review-pane-qa-v2-2026-08-13

The script is also a GUARD: it fails (non-zero exit) if any family behaviour
regresses (SWMS X on a temp fence, a dropped report tile, an unarmed soft hold).

## What each capture proves

| File | Family | Proves |
|---|---|---|
| `mlb-ellenbrook.png` | MLB physical | Report + SWMS + Invoice(DRAFT) + WO tiles, all with real first-page previews; report PDF paints readable page-width; SEND armed. |
| `mlb-invoice-selected.png` | MLB physical | The SELECTED Invoice PDF PAINTS in the stage (the Stratton "blank white" bug), page-width readable — not a blank frame. |
| `mlb-report-unminted.png` | MLB physical | Report artifact present but signed URL not minted → a Report tile STILL EXISTS with an honest "on the pack, link could not be loaded" state, never the silent drop that read as "no report submitted". |
| `ajs-heathridge.png` | AJS temp fence | NO SWMS tile and NO SWMS red X (family lie fixed); the three "… EMAIL — no draft on current docket" caveats are a calm blue SOFT hold ("Still drafting"); APPROVE AND SEND is ARMED. |
| `roof-mosman.png` | Roof portal | The Prime capture renders as a readable page-width IMAGE (not a toothpick sliver); the Report tile is N/A ("the portal form is the report"), no MakeSafe report PDF demanded. |

## The fixes (all UX, `ops.html` + `modules/ops-makesafe-reporting-cockpit.js`)

1. **Readable default zoom + scroll the pack.** `.msr-stage` no longer a short
   `height: clamp(...)` inner-scroll box (which slivered tall pages and trapped
   the wheel). It has a generous min-height, grows with the document, and the
   whole `.msr-body` scrolls. Tag relabelled "page width".
2. **Selected PDF paints, never blank.** `_msPdfFillViewer` paints into a
   detached fragment and swaps it in only after the first page renders; a
   0-width host falls back to a readable default instead of a 1px canvas.
   Document images render page-width via `.msr-doc-img`, never height-crushed.
3. **Tiles match family.** `_msSesSwmsNotApplicable` suppresses the SWMS
   tile/cross for temp-fence families (backend `family_evidence.swms`, else a
   temp-fence fallback). A named report/SWMS role present in the pack but with
   no minted signed URL renders an honest `doc_unavailable` tile instead of
   vanishing. Roof capture path unchanged (report N/A + capture-is-report).
4. **Soft SEND.** `_msSesBlockerIsSoftDraft` now catches the live phrasing
   "… EMAIL — no draft on CURRENT docket" (the interior word the old regex
   missed), so email-draft-only holds classify SOFT and never wall SEND. Still
   anchored on "email"/"no draft on docket" — a missing report DOCUMENT stays
   hard. The stamp still fails closed on the backend control flags inside
   `sesApproveAndSend`, so this is presentation + gate relaxation, not a bypass.

## Guards

- `modules/ops-makesafe-reporting-cockpit.smoke.mjs` — new assertion 11a3 covers
  the live "no draft on current docket" soft classification.
- `scripts/ses-review-pane-qa-v2-shot.js` — asserts the family-tile + soft-SEND
  behaviours on every run.
