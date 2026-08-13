# MakeSafe review pane: compact approve foot (2026-08-13)

> The #265 stage behaviour referenced below (grows with the document) was
> superseded by `docs/evidence/makesafe-review-pdf-viewer-zoom-2026-08-13/`
> (bounded viewer with zoom). The compact foot this record proves is
> unchanged and current; owner contract in `AGENTS.md`.

Captain report (screenshot, job SWMS-261133 / MLB-RR-26836): the document
preview in the "review & send" pane was an unreadable sliver while the
APPROVE AND SEND stamp and its four-line explanation kept ~250px of the
pane, and he asked for the button block to shrink so the document area
could grow.

PR #265 (merged first) fixed the STAGE half of that complaint: the document
renders at page width and the stage grows with it, so the whole pane body
scrolls as one page. But the pinned approve foot was untouched, and because
it sits OUTSIDE the scroll body it still ate ~250px of every window - at a
760px-tall laptop window the visible document area was 88px.

This change is the FOOT half, layout only, no behaviour:

- The approve foot is one compact band: stamp and note sit side by side,
  smaller stamp (9px/24px padding, 13.5px word), tightened tick and fold
  spacing, foot padding halved.
- The visible note is one short sentence that still ends with
  "Irreversible. Your press, every time." The full
  "Records your invoice approval and your send approval..." sentence moved
  verbatim into the "What one press does" disclosure. No approval semantics,
  hash-versioning text, or press flow changed.

## Measured (viewport-realistic captures, board-overlay mount, on top of #265)

| Window | Body viewport | Visible document when reading | Approve foot |
|---|---|---|---|
| 1512x900 before | 234px | 228px | 249px |
| 1512x900 after | 355px | 349px | 128px |
| 1512x760 before | 94px | 88px | 249px |
| 1512x760 after | 215px | 209px | 128px |

"Before" here is current main (with #265's grown stage): the stage itself is
1800px tall, but the foot capped the window onto it. The foot compaction
gives every window ~120px more readable document.

## Captures

`before-*` / `after-*` at 1512x900 and 1512x760; `-top` is the pane as it
opens, `-stage` is the document stage scrolled into reading position.

Regenerate with:

```
node scripts/ses-review-pane-viewport-shot.js <out-dir> after
# before: git archive <base> into a tree, then SHOT_ROOT=<tree> ... before
```
