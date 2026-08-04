# MakeSafe review & send cockpit — v3 (2026-08-04)

The third-pass redesign: calm hierarchy in the captain's decision order —
identity, one next action, primary stamps at the top, document tabs (the
invoice is a document, a tab like the report) over one fit-to-page stage,
emails as full-width readable cards, calm photo grid, feedback last.

Screenshots are captured offline from the shipped renderer via
`scripts/ses-docs-ready-review-shot.js` + the Bertram AJBR-70271 fixture
(`tests/e2e/fixtures/ses-docs-ready-bertram.js`) — no network, no client
personal data (suburb + job/builder refs and builder routing addresses only).

- `before-*.png` — the pane at base commit 6629dbf
- `after-*.png` — v3 on `fm/makesafe-reporting-cockpit-fable-ux-v3`
- Reference design targets (read-only): `docs/evidence/cockpit-blueprint-targets/`
- Regenerate: `node scripts/ses-docs-ready-review-shot.js docs/evidence/ses-cockpit-v3-2026-08-04 after`

The pane's design contract lives in `AGENTS.md` (Docs Ready review pane
paragraph); behavioural contracts in
`modules/ops-makesafe-reporting-cockpit.smoke.mjs`.
