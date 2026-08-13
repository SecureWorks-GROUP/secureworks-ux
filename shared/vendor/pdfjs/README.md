# pdf.js (vendored)

Mozilla pdf.js **legacy UMD build**, pinned to **v3.11.174**.

Files:
- `pdf.min.js` — the library (exposes `window.pdfjsLib`).
- `pdf.worker.min.js` — the worker (set as `pdfjsLib.GlobalWorkerOptions.workerSrc`).
- `LICENSE` — Apache-2.0.

Loaded LAZILY (only when the make-safe Docs Ready review pane opens) by
`modules/ops-makesafe-reporting-cockpit.js` (`_msPdfEnsureLib`). It renders the
document-tile first-page thumbnails and the inline PDF viewer to `<canvas>`, so
the pane never depends on the browser's native PDF plugin (which is absent in
headless Chrome and, with `attachment` content-disposition, refuses to render a
signed URL inline — the "grey empty pane" bug this replaced).

To update: `npm pack pdfjs-dist@<version>`, then copy `legacy/build/pdf.min.js`
and `legacy/build/pdf.worker.min.js` here and bump the version above.
