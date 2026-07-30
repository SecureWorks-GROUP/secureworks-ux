> **Docs hub:** read [`C:/Coding Projects/secureworks-docs/CLAUDE.md`](C:/Coding Projects/secureworks-docs/CLAUDE.md) first for the where-to-look table + canonical-source decision tree. **Live operational data** (jobs, invoices, contacts, POs) → Supabase `kevgrhcjxspbxgovpmfl`, never the wiki. **Historical/archived docs** (anything under `_archive/`, `strategy/dreaming/`, or carrying a "HISTORICAL SNAPSHOT" banner) are not current canon — cross-check `strategy/master-plan.md` v1.1 (2026-04-17) before acting on anything older than 2026-04.

---

# Claude Code Instructions — ops-dashboard / SecureSuite

## Bug Tracking

When Shaun says **"new bug"**, **"log a bug"**, **"add a bug"**, **"found a bug"**, or any similar phrase:
1. Ask for (or infer from context) the bug description and where it lives
2. Add it as a new row to the bug list in `C:\Users\shaun\.claude\projects\C--Coding-Projects-ops-dashboard\memory\bugs.md`
3. Confirm it's been logged with the bug number

When Shaun asks for the **bug list**, **"what bugs do we have"**, **"show me bugs"**, or similar:
1. Read `C:\Users\shaun\.claude\projects\C--Coding-Projects-ops-dashboard\memory\bugs.md`
2. Present the full table clearly, grouped by status (Open → In Progress → Fixed)

## Trunk Worktree (Do Not Work Here)

This directory (`/Users/marninstobbe/Projects/securedash`) is the trunk worktree. It must always be on `main` and clean. A pre-commit hook will refuse commits here.

For any work, create a named worktree:
- Via `gstack` (preferred): see `gstack` docs.
- Via raw git: `git worktree add ../securedash-<feature-name> -b <branch-name>`.

Why: previously, deploys from stale base worktrees caused production breakage. See `secureworks-docs/architecture/deploy-lane.md`.

> **Note:** This repo does not yet use Husky. The trunk guard is installed as a `.git/hooks/pre-commit` (per-clone, not tracked by git). Adopting Husky would make this hook portable across clones — tracked as a recommended follow-up.

## Testing

Trade App changes are guarded by a Playwright E2E suite that runs on every pull request (`.github/workflows/playwright-e2e.yml`). Run it locally with `npm ci && npx playwright install chromium && npm run test:e2e`. Changing `trade.html` markup or element IDs can break these specs. See `README-tests.md` for the covered flows and the copyable-template details.

## Trade App job cards (`trade.html`)

All job types (make-safe, fencing, patio, decking, reno) render through ONE card
grammar: the `UnifiedJobCard` module (search `// <unified-jobcard>`) → `.jc-*`
CSS. `.ql-*` is the shared quick-look sheet, `.dh-*` the full-view detail header.
`.jc.<type>` sets `--jc-a` (job-type accent from the `--jt-*` tokens); the
primary/Allocate action uses `var(--jc-a)`, never brand orange (captain ruling).
The allocate sheet (`#allocSheet`) is a DETACHED overlay — it can't inherit a
card's `--jc-a`, so `openAllocateSheet` stamps the job-type class onto it and
`.alloc-sheet.<type>` sets the var; keep that stamping or the Allocate button
silently falls back to orange.
Two status vocabularies exist, scoped by vertical — they are never merged. On
every make-safe surface the four user-facing statuses are the ONLY vocabulary:
New / Allocated / Complete / Archive (+ live "On site"). The separate fencing
field-work Board vertical has its own six column words: Ready / Scheduled / On
site / Done / Attention / Cancelled (`FencingBoardCore`, detail in
`trade-app.md`). Neither set may be renamed onto the other's surfaces.
The legacy `.ms-*` run card, `.tjc-*` card bodies, and the runsheet reorder
controls are retired — do not revive them. The calendar keeps its own
`.ncal`/`.sh-*` timeline grammar (shares the type accents).

## Trade visibility & the manager view (`trade.html`)

Make-safe visibility is 100% SERVER-DRIVEN by the `makesafe_board` feed
(`makesafe-board.v1`, edge function — not in this repo). The client applies NO
allocation-based hiding: `MakesafeTradeV5.board()` just renders whatever columns
the server sends, and the Board (`_renderBoard`, search `Make-safe Board v5`) shows
every card in every column. A MANAGER seeing all cards (allocated or not) is the
feed returning `permissions.sees_all_makesafes:true` / `can_allocate:true` for that
user; a non-manager gets `allocated_only` + `can_allocate:false` and a view-only
board (no `button.act.primary` Allocate action). Allocation ≠ visibility: an
assignment means "this person is doing the job", never "may see it". So if a real
manager (e.g. Hugo) can't see everything, the fix is his server role / the feed's
permission logic — NOT trade.html.

A managed-vertical lead (`users.managed_verticals`, e.g. Henry with `['fencing']`)
is NOT an ops manager — he keeps `role = lead_installer` and gains only his own
vertical. Widening stays server-side: the client asks through the authorized
`my_jobs?mode=all` (fencing Board vertical + My Jobs) and
`trade_calendar?type=fencing&mode=all` (`trade-calendar.v1`) paths and renders what
comes back. So for fencing the Everyone/Mine lens is an AUTHORIZATION request, not
a client filter; for make-safe the calendar `scope` stays a presentation lens over
rows the feed already chose to send (`ncSeesAll()` accepts `permissions.sees_all`
or `sees_all_makesafes`). Every per-viewer cache (job list, board, calendar) is
keyed by user + vertical + lens; keep those keys or a lens switch repaints the
broader payload. Fencing week selection must filter the complete assignment rows
before one-card-per-job dedupe, because one job may have valid visits in several
weeks. The Board ingests the backend `unscheduled` bucket and treats open-pool
rows as Unscheduled even when their transport date is synthetic. Successful
assignment lifecycle writes clear Board and Calendar planning caches through
`_invalidateAssignmentLifecycleCaches()`. Visibility still is not authority:
another crew's job detail is VIEW-ONLY (`// <foreign-job-readonly>`) and `api()`
refuses the write rather than queueing it. Surface-level detail lives in
`trade-app.md`.

Regression guards: `tests/e2e/manager-visibility.spec.js` (manager sees
unallocated+allocated), `installer-board-readonly.spec.js` (non-manager view-only),
`fencing-manager-visibility.spec.js` + `scripts/test-fencing-manager-visibility.js`
(managed fencing lead across multi-week/Unscheduled Board rows, My Jobs and
Calendar, other-crew read-only, one explicitly stubbed `allocate_job` write, and
own-assignment lifecycle refresh writes with no unapproved write).
NB: board cards are `role="button"` and their accessible names contain
"Allocated"/"Nobody allocated", so a `getByRole('button',{name:'Allocate'})` count
matches cards too — target the `button.act.primary` class for the real Allocate
action. Reattendance behavior is documented in `trade-app.md`, and Ops report
cycles in `ops-dashboard.md`; keep those documents authoritative rather than
duplicating the contracts here.

Gotchas:
- `trade.html`'s body script is IIFE-wrapped: only `window.*` fns are global. To
  QA internal renderers, serve over http (the browser extension blocks `file://`)
  and eval the sentinel-delimited modules in a harness.
- Inside the big `<style>` block, never write `*/` inside a `/* */` comment (e.g.
  a class name like `.tjc-*/.tjb-`). It closes the comment early and SILENTLY
  drops the next CSS rule — this once shipped every job-type accent as grey.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
