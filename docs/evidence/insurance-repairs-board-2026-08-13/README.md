# Insurance Repairs board — ops.html (2026-08-13)

New, **parallel** pipeline tab in `ops.html`: **Repairs**, sitting next to Patio.
It is NOT the make-safe (SES) board — repair-family work minted from a RAPID
REPAIR / repair work order lands here, never in the make-safe Docs Ready / TRI /
Prime columns.

## What shipped (secureworks-ux only)

- A `Repairs` pipeline tab next to `Patio` (`setPipelineTab('repairs')`).
- ONE cohesive **light** kanban, nine columns left to right:
  **WO In → Scoping → Quoted → Variation → Approved → Materials → Scheduled → On Site → Complete**.
- A quiet section label — **Quote** over the first four columns (in-job quoting
  against an existing work order), **Job** over the remaining five — separated by
  a wider gap. Same `.kanban-col` chrome and `renderKanbanCard` cards as
  Fencing/Patio/Approvals.
- Captain UI lock honoured: **no** dark Sales column / sales drawer, **no**
  inverted theme, **no** dark cards. No council, no deposit column in v1.
- Repair rows are recognised by family/type (`type|ses_family|family === 'repair'`)
  and re-bucketed by `repair_stage` (server field, wins) → `board_stage` → a
  status fallback map. Non-repair rows are ignored. An unrecognised stage shows a
  subtle "Unmapped" column only when non-empty (no silent drop).

See the `<insurance-repairs-board>` block in `ops.html` (`renderRepairKanban`).

## Coordination (cross-lane)

The intake → board feed that routes repair-family rows to this board (and OFF the
make-safe board) is owned by the backend sibling lane
**insurance-repairs-intake-board-v1**. This UX renders whatever repair rows the
`pipeline` feed returns; it deliberately does NOT add a client filter to the
make-safe board (that board stays 100% server-driven).

## Screenshots

- `01-repairs-empty-columns.png` — the clean empty state: exactly the nine light
  columns with Quote/Job section labels.
- `02-repairs-with-cards.png` — repair rows landing in the correct columns
  (Repair One → WO In, Repair Two/Three → Quoted, Repair Four → On Site), a patio
  row correctly excluded.

## Guard

`tests/e2e/ops-repairs-board.spec.js` — asserts tab position next to Patio, the
nine columns and their order, the Quote/Job labels, absence of the dark Sales
drawer, and correct repair-stage bucketing. Regenerates both screenshots.
