# MakeSafe review & send cockpit — v4 (2026-08-04)

Fourth-pass redesign: a **compact, one-screen** Docs Ready review so the
captain can approve Bertram without endless scrolling.

## What changed vs v3

| Concern | v3 | v4 |
| --- | --- | --- |
| Primary actions | Stamps near the top | Stamps in a panel foot at the **bottom** (APPROVE INVOICE → SEND IT) |
| Emails | Full-width cards, full body, "why this" essays | **Condensed**: one-line To/Cc/Subject, short excerpt, attachment **chips** |
| AJS shape | Always three backend routes | **2-email intended shape** when AJS still has 3 routes, labelled as a **preview** (not what SEND IT sends today), with the real routes kept below in a collapsed **"What SEND IT actually sends today"** fold. Truth when backend lands 2. |
| Density | Tall stage, everything open | Compact stage + an **"Open document"** hatch to a full-size read; photos / trade notes / feedback **collapsed by default** (Feedback auto-opens for a non-empty thread or a failed read) |
| Identity | Client + street when present | Job number + suburb only on this surface |

Non-negotiables preserved: bind only to `approve_invoice.enabled` /
`send_it.enabled` / hold reasons; no combined Approve-and-Send (410); disabled
actions stay visible with their reason; no board/queue column changes.

## Screenshots

Offline capture from the shipped renderer via
`scripts/ses-docs-ready-review-shot.js` + the Bertram AJBR-70271 fixture
(`tests/e2e/fixtures/ses-docs-ready-bertram.js`) — no network, no client
personal data (suburb + job/builder refs and builder routing addresses only).

- `before-*.png` — the pane at the v3-merged tip (`ddcb115` / PR 239 base)
- `after-*.png` — v4 on `fm/cockpit-bertram-approve-ui-v1`
- Reference design targets (read-only): `docs/evidence/cockpit-blueprint-targets/`
- Regenerate: `node scripts/ses-docs-ready-review-shot.js docs/evidence/ses-cockpit-v4-2026-08-04 after`

## Guards

- Behavioural contracts: `modules/ops-makesafe-reporting-cockpit.smoke.mjs`
- Design contract: `Agents.md` (Docs Ready review pane paragraph)
- CSS: `ops.html` `/* MAKE-SAFE DOCS READY REVIEW PANE */` (class prefix `.msr-`)
