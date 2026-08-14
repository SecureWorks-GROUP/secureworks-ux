# Docs Ready review pane fix — evidence (2026-08-13)

> **HISTORICAL SNAPSHOT.** The pdf.js canvas stage viewer introduced here (ask 4)
> was superseded on 2026-08-14 by the native iframe reader — see
> `docs/evidence/makesafe-review-native-reader-2026-08-14/` and AGENTS.md.
> Asks 1–3 (compact holds, soft-hold arming, real PDF tiles) still stand.

Branch `fm/ses-review-pane-fix-v1`. Isolated UX fix to the make-safe **Docs Ready
review pane** (`_msSesRenderDetail` in `modules/ops-makesafe-reporting-cockpit.js`,
CSS `/* MAKE-SAFE DOCS READY REVIEW PANE */` in `ops.html`). Repairs tab and the
SES stage engine untouched; no send-backend change.

## What changed (the four asks)

1. **Compact holds.** The "ON HOLD" essay is gone. Each caveat is ONE line: route
   tag + the backend fact, verbatim. No per-blocker "what clears it" wall, no lede,
   no "there is no override" copy. Email-draft caveats are marked SOFT ("fills in on
   the next run").
2. **SEND not walled by email-draft caveats** (Captain ruling 2026-08-13). An
   email-draft-ONLY hold is a *soft* hold: the pane arms APPROVE AND SEND and the
   existing backend chain still guards the real send. A HARD blocker (missing
   invoice, off-schedule rate, missing WO/photo/SWMS) still locks the pack.
3. **Real PDF tiles.** Tiles show a real first-page render (pdf.js → canvas),
   labelled Report / Invoice / WO — not identical dummy glyphs.
4. **Inline viewer renders the selected PDF** on **light chrome** (same as the
   board). The old dark stage + native `<iframe>` (blank in headless Chrome, and
   blank in real Chrome when the signed URL is served `Content-Disposition:
   attachment`) is replaced by a pdf.js canvas viewer that always paints.

## Screenshots (offline render of the Bertram AJBR-70271 proof fixture)

| File | What it shows |
|---|---|
| `before-send-ready.png` | OLD: identical dummy tile icons, blank white box in a DARK stage. |
| `before-hold.png` | OLD: same dead stage under the send-ready shape. |
| `after-send-ready.png` | NEW: real first-page tiles, PDF painted in a LIGHT stage. |
| `after-hold.png` | NEW HARD hold: 3 compact caveats (1 line each), armed=off (real blockers). |
| `after-draft-only-hold.png` | NEW SOFT hold: calm "Still drafting" block, **APPROVE AND SEND armed** — proof SEND is not walled by email-draft caveats. |
| `after-documents.png` | Documents section crop. |

Regenerate: `node scripts/ses-review-pane-proof-shot.js <out-dir> <label>`.
It serves `ops.html` from disk, aborts all external network, and points the two
PDF artifacts at the real sample PDFs in `assets/` so the tiles and viewer paint
real bytes. No client personal data (suburb only) — same redaction as the other
read-only census scripts.

## Guards

- `modules/ops-makesafe-reporting-cockpit.smoke.mjs` — new assertions: PDF tile
  preview hook, the compact caveat block, the email-draft-only soft hold arming
  SEND (UI + the client gate not refusing the press).
- Full ops-makesafe Playwright specs pass (65). The trade/board specs that fail in
  this worktree fail identically on the clean tree (a login/`fill` timeout in the
  environment), i.e. pre-existing and unrelated to this change.
