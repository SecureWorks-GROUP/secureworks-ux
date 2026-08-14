# pdf.js (vendored)

Mozilla pdf.js **legacy UMD build**, pinned to **v3.11.174**.

Files:
- `pdf.min.js` — the library (exposes `window.pdfjsLib`).
- `pdf.worker.min.js` — the worker (set as `pdfjsLib.GlobalWorkerOptions.workerSrc`).
- `LICENSE` — Apache-2.0.

Loaded LAZILY (only when the make-safe Docs Ready review pane opens) by
`modules/ops-makesafe-reporting-cockpit.js` (`_msPdfEnsureLib`). It renders the
document-tile first-page thumbnails to `<canvas>` — TILES ONLY: a native
`<iframe>` gives no thumbnail. The inline stage does NOT use it; it embeds the
browser's built-in PDF viewer (Captain ruling 2026-08-14 — see
`<makesafe-pdf-preview>` in the module and the review-pane section of
AGENTS.md).

To update: `npm pack pdfjs-dist@<version>`, then copy `legacy/build/pdf.min.js`
and `legacy/build/pdf.worker.min.js` here and bump the version above.
