# MakeSafe review pane: preview owns the height (2026-08-13)

Captain report (screenshot, job SWMS-261133 / MLB-RR-26836): the scrollable
document preview in the middle of the "review & send" pane rendered as a
~40px sliver while the APPROVE AND SEND stamp and its four-line explanation
kept ~250px of the pane. He could not read the documents he was approving.

## What changed (layout only, no behaviour)

- `.msr-stage` height is now viewport-relative:
  `clamp(280px, calc(100vh - 560px), 920px)` (was `clamp(240px, 42vh, 460px)`,
  which was fine on a full-page shot but starved inside the real
  fixed-height overlay).
- The approve foot is one compact band: stamp and note sit side by side,
  smaller stamp (9px/24px padding, 13.5px word), tightened tick and fold
  spacing, foot padding halved.
- The visible note is one short sentence that still ends with
  "Irreversible. Your press, every time." The full
  "Records your invoice approval and your send approval..." sentence moved
  verbatim into the "What one press does" disclosure. No approval semantics,
  hash-versioning text, or press flow changed.

## Measured (viewport-realistic captures, board-overlay mount)

| Window | Body viewport | Stage visible when scrolled to | Approve foot |
|---|---|---|---|
| 1512x900 before | 234px | 228px | 249px |
| 1512x900 after | 355px | 340px (full stage) | 128px |
| 1512x760 before | 94px | 88px | 249px |
| 1512x760 after | 215px | 209px | 128px |

At the captain's 1042px-tall screen the stage resolves to ~482px.

## Captures

`before-*` / `after-*` at 1512x900 and 1512x760; `-top` is the pane as it
opens, `-stage` is the document stage scrolled into reading position.

Regenerate with:

```
node scripts/ses-review-pane-viewport-shot.js <out-dir> after
# before: git archive HEAD into a tree, then SHOT_ROOT=<tree> ... before
```
