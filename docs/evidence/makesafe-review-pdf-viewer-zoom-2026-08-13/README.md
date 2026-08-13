# MakeSafe review pane: bounded PDF viewer with zoom (2026-08-13)

Captain feedback (verbatim), after PR 265 (stage grows with the document) and
PR 264 (compact approve foot) both landed on main:

> "the PDF is now too big. I want that scrollable and magnifiable/smallerizable
> PDF scroll that you get like before. But the pdf itself doesnt need to be
> fixed as big"

## What changed

- `.msr-stage` is a BOUNDED viewer again: `height: clamp(300px,
  calc(100vh - 560px), 920px)` (the same viewport-relative formula PR 264
  measured and shipped, generous — never the pre-fix ~40px sliver). The
  document scrolls INSIDE the stage; the pane body no longer grows to the
  document's full height, so the compact approve foot stays a glance away.
- Zoom cluster on the stage (pdf/image documents): `−` shrink, `FIT PAGE`
  reset, `+` magnify (`_msStageZoom`, levels 0.5–2.0, fit default). Zoom
  re-paints the pdf.js canvases at the new width from the cached document, so
  magnified text is sharp, not CSS-stretched blur, and it works past the
  signed URL's 300s life (bytes already fetched).
- The Open-document hatch and the zoom cluster sit on a sticky zero-height
  rail (`.msr-stage-bar`) so they stay reachable while the document scrolls
  under them. PR 264's compact approve foot and PR 265's other improvements
  (detached-fragment paint, family tiles, soft SEND) are untouched.

## Capture method

`scripts/ses-review-pane-zoom-shot.js` — the board-overlay mount under ~350px
of chrome (same harness as `ses-review-pane-viewport-shot.js`), shooting the
viewport, with the report artifact pointed at a REAL 5-page PDF
(`assets/sample-report-5p.pdf`). "before" is `git archive 670393b` (main after
PR 264+265). Two viewports: 1512x900 and 1512x760.

## Measurements

| build | viewport | stage height | stage content | internal scroll | page width walk | approve foot visible |
|-------|----------|--------------|---------------|-----------------|-----------------|----------------------|
| before | 1512x900 | 1800px (200vh cap) | 10294px | yes, but the pane body carries most of it | no zoom controls | yes (128px) |
| before | 1512x760 | 1520px | 10294px | " | no zoom controls | yes (128px) |
| after | 1512x900 | 340px | 10294px | yes — pane body does not move | fit 1446 → +x2 2169 → −x2 940 → fit 1446 | yes (128px) |
| after | 1512x760 | 300px | 10294px | yes — pane body does not move | fit 1446 → +x2 2169 → −x2 940 → fit 1446 | yes (128px) |

`ses-review-pane-viewport-shot.js` re-run on the after tree reproduces PR
264's approved numbers exactly: stage 340px @900 / 300px @760 (209px visible),
foot 128px. `ses-review-pane-qa-v2-shot.js` (family tiles + soft SEND guard)
still passes. Cockpit smoke: all checks ok.

## Shots

- `before-*-fit.png` / `before-*-scrolled.png` — the merged-main stage: the
  document owns up to 200vh of pane scroll.
- `after-*-fit.png` — bounded stage, fit-to-page default, `− / FIT PAGE / +`
  cluster top right, approve foot on screen.
- `after-*-scrolled.png` — mid-document INSIDE the stage; sticky rail and foot
  still on screen.
- `after-*-zoomin.png` / `after-*-zoomout.png` — magnified (1.5x, horizontal
  scroll reachable) and shrunk (0.65x) states.
