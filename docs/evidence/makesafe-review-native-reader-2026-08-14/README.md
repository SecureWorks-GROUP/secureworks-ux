# Make-safe review pane: native reader, just tall (2026-08-14)

Captain supersession, 2026-08-14: bring back the browser's BUILT-IN PDF viewer
in the reader box, exactly as pre-13-Aug, just taller. This replaces the
13-Aug custom canvas viewer line (PRs 262/264/265 and the withdrawn bounded
zoom viewer on PR 267). Acceptance: "the old reader, just tall."

## What changed

- `.msr-stage` is the pre-13-Aug fixed-height dark box again, but TALL:
  `--msr-stage-h: clamp(420px, 65vh, 900px)` (the single knob to tweak;
  mobile override `clamp(300px, 55vh, 640px)` in the same file, `ops.html`).
- PDFs embed via the native iframe pattern (`<iframe src="...#view=Fit">`),
  so the stage shows Chrome's built-in viewer with its own toolbar, wheel
  scroll and Ctrl+wheel zoom. No custom zoom cluster, no canvas viewer, no
  pending-zoom logic — `_msPdfFillViewer` and the stage hydration path are
  gone. pdf.js remains for TILE THUMBNAILS only.
- Corner chrome as before: OPEN DOCUMENT badge top-left (`.msr-stage-open`),
  FIT TO PAGE tag top-right (`.msr-stage-tag`).
- The compact APPROVE AND SEND foot (PR 264) is untouched below the stage.
- Images/html previews render the pre-13-Aug way (contained / full-box).

## Shots (viewport screenshots, pane mounted under ~350px of board chrome)

| shot | shows |
|---|---|
| `before-*-fit.png` | main (13-Aug canvas viewer): page-width canvases, stage GROWN to the document (1800px stage, 10294px content @900) — the "PDF too big" state |
| `before-*-foot.png` | the 2830px pane-body trek to the approve foot |
| `after-*-fit.png` | native Chrome PDF viewer (toolbar, 1/5 pages, thumbnails) inside the bounded tall stage — 585px @900, 494px @760 — with OPEN DOCUMENT + FIT TO PAGE corners and the approve foot visible below |
| `after-*-foot.png` | pane body back to 1615px @900: the foot is one small scroll away, the document scrolls inside its own reader |

Measured contract (script output, both viewports):

- after: stage bounded true (scrollHeight == clientHeight), native iframe true
  with `sample-report-5p.pdf#view=Fit`, tag "fit to page", hatch
  "Open document ↗", foot visible true.
- before: bounded false, canvas pages 5, tag "page width".

## Repro

    node scripts/ses-review-pane-native-shot.js <out-dir> after
    SHOT_ROOT=<pre-fix tree> node scripts/ses-review-pane-native-shot.js <out-dir> before

Notes for future captures: the script launches `channel: 'chromium'`
(new-headless full browser) because the default headless SHELL has no PDF
viewer; and it must NOT register a catch-all `page.route` — interception
starves the native PDF viewer's stream and the iframe stays blank.

Known trade-off (recorded, ruled acceptable): the native plugin can refuse to
render a signed URL served with `Content-Disposition: attachment` (the
pre-#262 "grey empty pane"); the OPEN DOCUMENT hatch remains the escape.
