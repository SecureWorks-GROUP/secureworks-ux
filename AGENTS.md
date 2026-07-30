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

Trade App changes are guarded by a Playwright E2E suite that runs on every pull request (`.github/workflows/playwright-e2e.yml`). Run it locally with `npm ci && npx playwright install chromium && npm run test:e2e`. Changing `trade.html` markup or element IDs can break these specs. The suite also carries `tests/e2e/cal-workdays.spec.js` — a pure-node spec that extracts the code between `// <calendar-ops-core>` and `// </calendar-ops-core>` in `ops.html` and asserts against the REAL shipped functions, so renaming or moving those sentinels breaks CI. See `README-tests.md` for the covered flows and the copyable-template details.

## Ops Dash calendar drag (`ops.html`)

CP1 drag-to-reschedule is behind a feature flag: `?dragv2=1` or
`localStorage.sw_cal_dragv2='1'` (DEFAULT OFF, same pattern as `sw_cap1b_enabled`).
Flag off must stay byte-identical to the old behaviour — that is why V1
`buildMovePayload` (calendar-delta shift) lives alongside `buildMovePayloadV2`
(drop day = new START, duration preserved in WORKING days, weekend-skip); do not
"clean up" the V1 path while the flag exists. Weekends are opt-in: interior
Sat/Sun are breaks, a weekend counts only as a deliberately chosen endpoint.
Duration precedence: the rendered `scheduled_date..scheduled_end` span wins over
`duration_days` (legacy rows all carry the unused default 1 — a drag must never
collapse a visible multi-day bar). The reschedule SMS (`send_client_update`,
trigger `install_rescheduled`) fires ONLY from an explicit Yes in the confirm
modal, and only when the START day changed. The Schedule modal's real-crew
requirement is deliberately UNFLAGGED: `create_assignment` takes camelCase keys
and a required `userId` — name-only rows are invisible to the Trade App's
my-jobs filter and the backend rejects them.

The calendar has TWO views and BOTH must stay draggable: Crew (swimlane,
per-assignment blocks) and Schedule (`renderScheduleView`, job-grouped bars;
the active view persists in `localStorage.sw_cal_view_mode`, so one click on
the toggle silently sticks forever — this is how "drag is broken" shipped once
already: only Crew view had drag wiring). Schedule-view drops carry only a DAY
(no crew rows — a drop there never reassigns); bars float on a
`pointer-events:none` overlay above the day cells, so bars themselves must
accept `dragover`/`drop` and fall through to the cell under the pointer.
Drag regression checks live in `tests/e2e/cal-drag-real-input.spec.js` and use
ONLY trusted pointer input (Playwright `page.mouse` press-move-release) —
synthetic `dispatchEvent` checks pass even when a real user cannot drag, which
is exactly the masking that hid the Schedule-view gap. Keep it that way.

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
The four user-facing statuses are the ONLY vocabulary: New / Allocated / Complete
/ Archive (+ live "On site"). The legacy `.ms-*` run card, `.tjc-*` card bodies,
and the runsheet reorder controls are retired — do not revive them. The calendar
keeps its own `.ncal`/`.sh-*` timeline grammar (shares the type accents).

## Make-safe visibility & the manager view (`trade.html`)

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
permission logic — NOT trade.html. The calendar's Mine/Everyone `scope` is a
PRESENTATION lens only (`ncSeesAll()` → default `everyone` + unassigned rows for
managers); it filters rows the server already chose to send. Regression guards:
`tests/e2e/manager-visibility.spec.js` (manager sees unallocated+allocated) and
`installer-board-readonly.spec.js` (non-manager view-only). NB: board cards are
`role="button"` and their accessible names contain "Allocated"/"Nobody allocated",
so a `getByRole('button',{name:'Allocate'})` count matches cards too — target the
`button.act.primary` class for the real Allocate action.

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
