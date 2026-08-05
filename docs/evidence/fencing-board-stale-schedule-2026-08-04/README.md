# Trade App board showed stale schedule dates after an Ops Dash reschedule

Captain-reported 2026-08-04 with screenshots. Bug, authority level 2, CODING uniform.

Diagnosis was read-only against live data (Supabase `kevgrhcjxspbxgovpmfl`, SELECT only)
plus read-only inspection of the `secureworks-backend` checkout. No live writes, no SMS,
no deploys, no GHL/Xero writes.

## Summary

The three jobs in the screenshots are **fencing** jobs, not make-safe, so the surface at
fault is the fencing Board (`FencingBoardCore` in `trade.html`), not the make-safe board.

Every one of them carries **two** non-cancelled assignment rows: the real crew row, and a
ghost `role:'observer'` row that mirrors the job onto an ops manager's own list. The ghost
row is not moved when the crew row is rescheduled. Both calendar surfaces exclude ghosts by
construction; the fencing Board does not, and its one-card-per-job dedupe hands the tie to
the stale row.

## Trigger, masking condition, symptom

- **Initiating trigger.** An Ops Dash calendar reschedule (drag or Schedule modal) updates
  the crew's `job_assignments` row. It does not touch the ghost observer row on the same
  job. Confirmed by `updated_at`: on SWF-26813 the crew row moved at `2026-08-04 06:15:15`
  while the ghost row still reads its `2026-07-28 02:42:41` creation stamp.
- **Masking condition.** Not a cache. `_fieldBoardCacheByKey` is an in-memory TTL that dies
  on reload, and the make-safe feed cache is 90s in memory. What masks the fresh write is a
  **second, older row for the same job** that the Board is willing to treat as the job's
  schedule. Because both rows carry `status:'scheduled'`, `FencingBoardCore.priority()`
  returns 3 for each, the dedupe's `priority(row) > priority(current)` test is false, and
  the row seen FIRST wins. `my_jobs` orders by `scheduled_date` ascending, so the first row
  seen is always the earlier one, and the stale ghost wins deterministically.
- **Visible symptom.** The board card renders `whenLabel` / `timeMiss` off that winning row
  (`UnifiedJobCard.fromJobAssignment`), so it shows the ghost's old date and, because ghosts
  carry no `start_time`, its "no time set" tail.

## Earliest meaningful divergence

The divergence is the `is_ghost` rule, applied by every schedule surface except one.

| Surface | Reads | Ghost rows |
|---|---|---|
| Ops Dash calendar | `ops-api?action=calendar` -> `calendar_events` view | excluded |
| Trade App calendar | `ops-api?action=trade_calendar` -> `calendar_events` view | excluded |
| Trade App fencing **Board** | `ops-api?action=my_jobs` -> `job_assignments` **raw** | **included** |

```sql
-- pg_get_viewdef('public.calendar_events')
   FROM job_assignments ja ...
  WHERE ja.is_ghost = false;
```

`myJobs()` in `supabase/functions/ops-api/index.ts` selects `job_assignments` with only
`.neq('status','cancelled')` and an org scope. So the Board is the only schedule surface in
the product that never learned the rule. The Trade App's own calendar and its own Board
disagree with each other for the same job, which is what pins the defect to the Board.

## Live data (read-only, 2026-08-04)

`job_assignments` for the three screenshotted jobs. `is_ghost` is a column; it is not in any
trade payload. `role` is, and the two agree on every live row.

| Job | role | is_ghost | scheduled_date | start_time | updated_at |
|---|---|---|---|---|---|
| SWF-26813 (Hocking) | observer | true | 2026-08-05 (Wed) | null | 2026-07-28 |
| SWF-26813 | lead_installer | false | **2026-08-06 (Thu)** | null | **2026-08-04** |
| SWF-261042 (Leeming) | observer | true | 2026-08-07 (Fri) | null | 2026-07-28 |
| SWF-261042 | lead_installer | false | **2026-08-11 (Tue)** | null | **2026-08-03** |
| SWF-26972 (Iluka) | observer | true | 2026-08-07 (Fri) | null | 2026-07-30 |
| SWF-26972 | lead_installer | false | **2026-08-07 (Fri)** | null | 2026-08-04 |

`role = 'observer'` and `is_ghost = true` are biconditional across the whole table:
119 ghost rows, all `observer`; 0 non-ghost rows carry `observer`.

```
 is_ghost | role           | count
 f        | lead_installer | 1035
 f        | helper         |   42
 f        | crew           |   15
 f        | lead           |    1
 t        | observer       |  119
```

Blast radius on the fencing Board today, counted as "job where the earliest ghost date
precedes the earliest crew date": 4 fencing jobs and 4 patio jobs. Zero jobs have only
ghost rows, so no card disappears from applying the rule.

## Why this explains BOTH the stale cards and the agreeing card

One mechanism, three outcomes, decided entirely by where the untouched ghost date sits
relative to the crew date:

- **SWF-26813** ghost 5 Aug, crew 6 Aug. Both fall in the week of Mon 3 Aug, so
  both survive the week filter and the dedupe tie picks the earlier ghost. Card reads
  Wednesday while the calendar reads Thursday. Matches the screenshot.
- **SWF-261042** ghost 7 Aug, crew 11 Aug. `forSelection` filters by week BEFORE deduping,
  so in the week of Mon 3 Aug the crew row is filtered out entirely and only the ghost
  remains. The card is not merely stale, it is a card the calendar does not draw at all,
  reading "Fri 7 Aug - no time set" because ghosts have a null `start_time`. Matches the
  screenshot including its wording.
- **SWF-26972** ghost 7 Aug, crew 7 Aug. The tie is still resolved in the ghost's favour,
  but the two dates are equal, so the defect is invisible. This is the proven-path contrast:
  the agreeing card is not on a different code path, it is the same defect with nothing to
  show. That is why "some cards agree and some are stale" without any pattern in job type,
  builder or crew.

## Counterfactual

Smallest change that flips the symptom: drop `role:'observer'` rows at the Board's row
intake, the same rule `calendar_events` applies. Verified in both directions by
`scripts/test-fencing-board-ghost-rows.js`, which prints what each surface read before it
asserts. With the one-line intake filter reverted:

```
  SWF-26813   calendar=2026-08-06  board[wk 2026-08-03]=2026-08-05  board[wk 2026-08-10]=-
  SWF-261042  calendar=2026-08-11  board[wk 2026-08-03]=2026-08-07  board[wk 2026-08-10]=2026-08-11
  SWF-26972   calendar=2026-08-07  board[wk 2026-08-03]=2026-08-07  board[wk 2026-08-10]=-
AssertionError: a drag-rescheduled job reads the crew row date, not the stale observer date
```

With the filter in place:

```
  SWF-26813   calendar=2026-08-06  board[wk 2026-08-03]=2026-08-06  board[wk 2026-08-10]=-
  SWF-261042  calendar=2026-08-11  board[wk 2026-08-03]=-           board[wk 2026-08-10]=2026-08-11
  SWF-26972   calendar=2026-08-07  board[wk 2026-08-03]=2026-08-07  board[wk 2026-08-10]=-
```

## Hypothesis that was tested and REJECTED

The brief's stated hypothesis was that the CP1 drag-to-reschedule backend merged 2026-08-03
(backend PR 367, ux PR 213) writes one field while the Trade App reads another. Falsifier
stated in advance: if the drag path were the cause, a job rescheduled by another means would
be immune, and the crew row would show a field the Board does not read.

It does not hold.

- The crew row's `scheduled_date` is the same single field both surfaces read. There is no
  second date field, and no field the drag misses.
- SWF-261042 was last written `2026-08-03 08:30:49`, before the drag path was in use for
  these cards, and it is stale in exactly the same way. The defect predates CP1 and is
  reachable from the Schedule modal and from allocate writes too.
- The drag write path is correct. It moves the crew row, and both calendars immediately
  show the new date. Nothing is wrong on the write side.

CP1 is a plausible-looking coincidence of timing, not the cause. What CP1 plausibly did was
make rescheduling cheap enough that more jobs were moved in one week, which is why several
stale cards surfaced together on 2026-08-04.

## Disconfirming evidence, recorded not explained away

- The rule is applied on `role`, which is a PROXY for `is_ghost`. It is exact on today's
  data (119/119, no false positives) but it is a proxy, and a ghost row written with some
  other role would defeat it. The durable fix is server-side and is flagged below rather
  than assumed away.
- Patio jobs carry the same defect shape (4 live). They are not on the fencing Board, so
  this change does not reach them. Not fixed here, see below.
- The My Jobs list renders one card per assignment row with no dedupe, so an ops manager on
  the Everyone lens sees the observer row as a separate card there. That is a different
  symptom on a different surface, was not reported, and is deliberately untouched.

## Fix

`trade.html`, `FencingBoardCore`: `isObserverRow()` plus a drop at `buildBoard`'s row
intake, before the pool/assigned split, so an observer row can never become a card, a crew
name, or the row an Allocate write targets. Dropped rows are counted into
`observerRowsDropped` rather than vanishing silently, matching the existing
`poolMergedIntoAssigned` / `unmappedCount` diagnostics on the same function.

## Not fixed here, for firstmate to route

- **Backend hardening (`secureworks-backend`, not touched by this branch).** `myJobs()`
  should apply the `calendar_events` rule at source, or at minimum publish `is_ghost` so no
  client has to infer it from `role`. That fixes patio and every future consumer at once.
  This is a read-path change in ops-api, so it is out of scope for a secureworks-ux worktree.
- **Patio jobs** (4 live with the same divergence) reach the trade UI through other surfaces
  and are unaffected by this Board fix.

## Verification

Per `harness/verification/coding-validation-gate.md`.

- **Changed:** `trade.html` (FencingBoardCore intake + predicate + diagnostic counter),
  `scripts/test-fencing-board-ghost-rows.js` (new), `.github/workflows/pr-check.yml` (wires
  the new guard), `AGENTS.md` (cross-surface invariant), this note.
- **Ran, all green:** the new guard, both directions (asserted failing with the fix
  reverted, passing with it applied); the 8 node contract scripts in `pr-check.yml` and
  `npm run test:e2e`'s pre-Playwright set; the full Playwright suite, 124 passed 2 skipped
  0 failed.
- **Not tested:** no live browser session against the deployed Trade App, and no write was
  performed to move a real job, because the brief forbids live mutation. The reproduction is
  therefore a faithful offline replay of the live rows above, not a live click-through.
  Confirming on the deployed board needs the captain to reload it after this ships.
- **Status: PR-only.** Nothing is deployed. GitHub Pages serves `main`, so the fix is not
  live for Shaun or the crew until this branch merges.
