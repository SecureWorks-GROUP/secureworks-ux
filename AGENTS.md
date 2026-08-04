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

Trade App and Ops Dash changes are guarded by a Playwright E2E suite that runs on every pull request (`.github/workflows/playwright-e2e.yml`). Run it locally with `npm ci && npx playwright install chromium && npm run test:e2e`. Changing `trade.html` or `ops.html` markup or element IDs can break these specs. The suite also carries `tests/e2e/cal-workdays.spec.js` — a pure-node spec that extracts the code between `// <calendar-ops-core>` and `// </calendar-ops-core>` in `ops.html` and asserts against the REAL shipped functions, so renaming or moving those sentinels breaks CI. See `README-tests.md` for the covered flows and the copyable-template details.

## Ops Dash calendar drag (`ops.html`)

CP1 drag-to-reschedule is behind a feature flag that is now DEFAULT ON. Kill
switch: `?dragv2=0` or `localStorage.sw_cal_dragv2='0'`; `?dragv2=1` / `'1'`
still force it on.
Flag off must stay byte-identical to the old behaviour — that is why V1
`buildMovePayload` (calendar-delta shift) lives alongside `buildMovePayloadV2`
(drop day = new START, duration preserved in WORKING days, weekend-skip); do not
"clean up" the V1 path while the flag exists. One Captain-authorized exception
(ruling cp1-askuser-2): the flag-off Schedule-modal create computes its end date
with `localDateStr`, not `toISOString()` — the UTC conversion rolled local
midnight back a day in Perth (UTC+8) and wrote inverted 1-day spans; same
intended calendar-day span, now in local time, so do not "restore" byte-identity
by reverting it. Weekends are opt-in: interior Sat/Sun are breaks, a weekend
counts only as a deliberately chosen endpoint.
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
(no crew rows — a drop there never reassigns): a single-assignment move pins
the event's own `user_id` (`opts.pinnedUserId` on `moveAssignment`), never a
display-name lookup that could land on a deactivated or duplicate-named user —
Crew-view callers deliberately keep name resolution because it powers
cross-row reassignment; a multi-assignment move builds all plans first, then
shows ONE combined "Crew Unavailable" confirm across every affected crew
(Captain ruling — never one modal per crew). With dragv2 ON a single-assignment
move (either view, shared `moveAssignment`) runs the SAME span-depth check —
every painted day of the moved span (`CalOpsCore.movedSpanV2`, the only
derivation of a moved span, shared by warning and write) through the shared
`collectSpanClashes`/`confirmClashesOrProceed` helpers, one combined confirm,
identical wording (ruling cp1-askuser-2); flag off keeps the drop-day-only
check. With dragv2 ON the Schedule view lays active dates via
`CalOpsCore.paintedSpanDates`, so weekend-crossing jobs render as broken
segments like the Crew view and dragging EITHER segment reschedules the whole
job; flag OFF keeps the every-calendar-day loop byte-identical. Bars float
on a `pointer-events:none` overlay above the day
cells, so bars themselves must accept `dragover`/`drop` and fall through to
the cell under the pointer.
Drag regression checks live in `tests/e2e/cal-drag-real-input.spec.js` and use
ONLY trusted pointer input (Playwright `page.mouse` press-move-release) —
synthetic `dispatchEvent` checks pass even when a real user cannot drag, which
is exactly the masking that hid the Schedule-view gap. Keep it that way.

## Ops make-safe board (`ops.html`)

The board's data source is `ops-api?action=makesafe_board` (`makesafe-board.v1`,
projection `ops`) — the same canonical feed the Trade board uses, and the only one
carrying `canonical_stage` (declared `board_stage` + the captain display ledger).
Column placement comes from `canonical_stage` and nothing else; the client
re-derives no stage. Search `// <makesafe-board-canonical>` in `ops.html`.
This is the board's primary feed; it did not previously have a
`makesafe_board` fallback. Do not describe the migration as fallback logic.
`makesafe_pipeline?history=all` is still fetched alongside, but only as a
presentation join over the identical job set (`MAKESAFE_ENRICH_FIELDS`) for the
close-out fields the canonical projection drops — has_wo, invoice_status,
requesting_company_slug, intake date, suburb, family label. Never put a stage,
status or column key in that whitelist, and never let it decide which cards exist:
that is exactly the overlay-blindness this migration removed. When either the
feed's `intake_exceptions.degraded` marker or the enrichment join is missing, the
board says so in a banner (`renderMakesafeFeedNotices`) rather than losing data
silently. Guard: `tests/e2e/ops-makesafe-canonical-board.spec.js`; verification
evidence in `docs/evidence/ops-makesafe-canonical-board-2026-08-01/`.
The make-safe MAP and CREW WEEK PLANNER overlays still read `makesafe_pipeline`
directly and remain overlay-blind — migrating them is follow-up work.

The JOB DETAIL obeys the same rule: it never derives a make-safe's stage from
substatus. `resolveMakesafeDetailStage` takes `canonical_stage` off the
`job_detail` payload if that producer ever carries one (it does not today), else
the stage the canonical feed published for that job id, else says "Stage not
confirmed" — and the Next step forward-move buttons are gated on that stage, so a
terminal (archive/cancelled/completed) or unconfirmed card offers no move. A bare
`board_stage` is the DECLARED stage and is deliberately not trusted here.
FRESHNESS IS PART OF THAT CONTRACT: the remembered stage is a read, so every
make-safe transition this page performs (`advanceMakesafeSubstatus`, board drag,
cancel, reopen) calls `afterMakesafeStageTransition()`, which DROPS the whole map,
re-reads the canonical feed and repaints the open detail from that response.
If EITHER the canonical read or the `job_detail` read fails, that job id is marked
in `_makesafeStageReadFailedIds` and `resolveMakesafeDetailStage` refuses to name
a stage for it — so the badge reads "Stage not confirmed" and no forward move is
offered, never the pre-write stage. That mark lives in the RESOLVER, not on the
payload and not with the callers: `refreshJobDetail()` is called from ~10 places
that know nothing about make-safe stages, and each replaces `_currentJobData`, so
a payload-borne flag is silently dropped by the next ordinary refresh. Only a
canonical read that actually SUCCEEDED clears it (`clearMakesafeStageReadFailures`
inside `ensureMakesafeCanonicalStages`); a successful `job_detail` is not evidence
about the board's stage. Do not add a stage argument to `refreshJobDetail` — the
point is that no caller can forget one. Search
`// <makesafe-detail-canonical-stage>`.

Two claims on a make-safe surface are canonical-row-or-nothing. The BOARD CARD's
family tag comes from `getMakesafeCardFamilyLabel` — canonical `ses_family` /
`ses_family_label` or "Family not determined", with no path to the
`inferMakesafeFamilyFromText` regex. (`getMakesafeTypeLabel` keeps that legacy
chain for the detail / calendar / list surfaces, whose feeds carry no
`ses_family` at all.) PACK EXISTENCE comes from `makesafeHasDraftedPack`, which
reads only the canonical row's `pack` block (`drafted`, `state`, `sent`,
`sent_at`) — never the `resume_action` / `pack_status` enrichment fields, and
never `stage + substatus`, which describe a column and a workflow flag rather
than a document. Docs Ready keeps its name and meaning (captain decision C.4 is
still open) but a card the canonical row cannot prove has a pack says "No pack
drafted", and the column states how many packs exist.

Guard: `tests/e2e/ops-makesafe-ui-truth.spec.js`. Live verification evidence in
`docs/evidence/ses-b2-ui-truth-2026-08-02/`, regenerated end to end by
`scripts/makesafe-ui-truth-census.js` — that script is also the pattern for any
read-only live-board measurement here: it routes every request, aborts non-GETs,
and redacts client data out of every response body before it can reach the DOM or
a screenshot. Read-only sessions against the live board must use
`ops.html?noAutoIntake=1`: loading the board otherwise POSTs
`auto_approve_clean_intake_drafts`.

A STORED LINK IS NOT A PORTAL BECAUSE IT SAYS IT IS. 20% of live `external_links`
rows (59 of 299, all `kind: builder_portal`) are branding images, email signatures
or SES open/click trackers that Claude extraction lifted out of email HTML
(`ses-links-truth-audit-v1`). `urlIsBuilderPortalLink` / `urlLooksLikeAssetOrTracking`
in both `ops.html` and `trade.html` (`// <makesafe-portal-link-hygiene>`) mirror the
ops-api merge-boundary predicate: a URL is offered as a portal only if it is
http(s), carries a share/report-style path segment, and is neither an image
extension nor an `awstrack.me` host. Ops applies it once inside the SHARED
`collectMakesafeExternalLinks`, so the job-detail Builder links panel and the board
card link row are filtered from one place; trade applies it in
`normaliseTradeExternalLinks` and in `ReportDoneCore.portalUrl()`, so a polluted
`kind=builder_portal` row can never become the "Open builder report portal" CTA.
LIVENESS IS NEVER CHECKED: an expired share is an AGED JOB, not a broken link
(captain domain fact — Prime shares expire around 30 days), so it stays visible and
the trade panel explains the builder-resend path. This is display hygiene only; it
strips no stored rows, and cleaning up the 62 polluted rows is a separate
captain-gated tranche. Guard: `scripts/test-f5-portal-link-hygiene.js` (runs before
Playwright via `npm run test:e2e`) plus the card-face case in
`tests/e2e/ops-makesafe-ui-truth.spec.js`. Live evidence, and the read-only census
that scores this fix ALONGSIDE the work-order identity and trade-confirmation fixes
on every card at once, in `docs/evidence/ses-f5b-combined-truth-2026-08-02/`
(`scripts/ses-f5b-combined-truth-census.js`). Note its finding before assuming a
single card can demonstrate all three: on today's board the multi-work-order cards
and the polluted-link cards are DISJOINT sets.

A make-safe card can carry the work orders of TWO DIFFERENT builder instructions —
11 of 440 live cards do, and on 10 the two carry different POs. So NO make-safe
surface may pick one work order and hide the rest. `buildMakesafeWorkOrderSlots`
lists every work order on the card, preferring the one whose file name carries the
card's own PO where it declares one and otherwise ranking none, and the viewer
warns by count and by PO (`// <makesafe-workorder-identity>`); the intake review
screen does the same over a draft's attachments (`intakeWorkOrderPdfs`, replacing
"first attachment wins"). Identity comes from the PO alone: the file name embeds
the builder CLAIM ref too (`work_order_MLB-26183PO-54000_...`) and both work orders
of a claim share it, so only `extractPoRef` can discriminate. Supplier
`purchase_orders` are a different numbering namespace from the builder PO and are
deliberately not consulted. Guard:
`tests/e2e/ops-makesafe-workorder-identity.spec.js`; live evidence + the board-wide
census in `docs/evidence/ses-f2-workorder-viewer-identity-2026-08-02/`
(`scripts/ses-f2-workorder-identity-census.js`).

The Docs Ready "review & send" pane (`showMsReportingDetail` /
`_msSesRenderDetail` in `modules/ops-makesafe-reporting-cockpit.js`, feedback
composer in `modules/ops-makesafe-feedback-notes.js`) is built to the captain's
blueprint at secureworks-wiki
`coding/work/campaigns/makesafe-system/MAKESAFE-SYSTEM-BLUEPRINT.html`
(acceptance criteria RV-1..RV-11), with its visual/interaction model ported
from the approved references in `docs/evidence/cockpit-blueprint-targets/`
(the job-view mockup's State A/B honesty pair + the lavish review sample).
Its design system lives in `ops.html` under
`/* MAKE-SAFE DOCS READY REVIEW PANE */` (class prefix `.msr-`); CALM IS THE
INSTRUCTION — one type family, tight scale, one accent at a time. Compact is
the product goal: the captain should scan the whole pack in a couple of
seconds without endless scrolling. The reading order is a design contract:
identity (job number + suburb — no client name/street on this surface), ONE
next action (derived from the backend control flags alone), the single amber
hold block when held (blockers numbered, deduped case-insensitively — the
backend can emit one blocker per route — each with the verbatim fact plus a
plain-English "what clears it" line), then document tabs over ONE compact
stage — THE INVOICE IS A DOCUMENT here (the bound Xero PDF, else the proposal
rendered as an invoice page; never a separate section) and MULTIPLE WORK
ORDERS EACH GET A TAB (`<makesafe-workorder-identity>`: no surface may pick
one and hide the rest; discriminated by `extractPoRef` when possible) — then
missing documents named in one line (RV-1; SWMS stays "not in this pack",
never "not required"), condensed email previews (one-line To/Cc/Subject +
short body excerpt + attachment chips only — no "why this" essays). The stage
is deliberately short for density, so every pdf/image stage carries an "Open
document" link to a full-size read in a new tab — keep that escape hatch if
you touch `_msRenderDocStage`, and keep it behind `_msOpenDocFullSize`: signed
pack URLs live 300s, this pane never auto-refreshes, and a calm read easily
outlasts them, so the hatch shares `_msSesPackUrlsStale` with the tab switcher
and re-reads the pack before it hands a new tab a link (fresh pack: it returns
true and the anchor's own href opens natively). For AJS builders, when the backend still builds
three routes, the pane HEADLINES the intended two-email shape (report+invoice,
then photos) labelled plainly as a preview and never as what SEND IT will send
today, AND keeps the real routes on the same surface in a collapsed "What SEND
IT actually sends today" fold — a synthesized shape may never REPLACE the
truth on a money-and-send screen. `_msSesAjsIntendedEmails` therefore consumes
at most one report / invoice / photo route and returns everything else as
`leftovers`, which render as their own cards: a fourth route or a duplicate
kind (a second builder instruction's invoice) is never dropped, the same rule
as `<makesafe-workorder-identity>`. Its merged Cc is filtered against the
merged To so no address is printed on both, while a Cc-only address survives.
When the backend has landed two routes, the truth IS the headline and there is
no preview framing and no fold. Photos, trade notes and feedback are collapsed
by default; the photo set stays READ-ONLY inside its fold (the release revision
fixes it, and a toggle that cannot change anything is a fake control — settled
Captain ruling) — but the Feedback fold is not allowed to hide anything: the
feedback module calls `_msSesOnFeedbackThreadRendered` on every thread render,
which opens the fold and badges its summary when the thread is non-empty or
`list_draft_notes` failed. THIS PANE RENDERS INTO TWO HOSTS (inline Approvals
panel + board overlay) that can hold the same job's ids at once, so every
per-job element lookup goes through `_msSesScopedEl`, which resolves inside
`ctx.panelId` — the panel that owns the open detail — before falling back to
document scope; the feedback module routes its thread host and composer through
it too (`_msNotesEl`). A bare `getElementById` here writes to whichever copy is
first in the DOM, which is the hidden one. PRIMARY ACTIONS sit in a pinned
panel foot at the BOTTOM — a flex sibling OUTSIDE the scroll body, deliberately
not `position:sticky` (sticky overlays content on a full-page shot and fights
the flex column) — APPROVE INVOICE then SEND IT, always visible; armed ONLY by
`controls.approve_invoice.enabled` / `controls.send_it.enabled`; a disabled
stamp has no id and no onclick, both action functions re-check the flag, and
an enabled stamp's note renders the backend's own `plan` text verbatim. The
mockup's single combined "Approve & send pack" button is the RETIRED 410 path
and is deliberately not ported (settled Captain ruling). Guard: the module's
own `ops-makesafe-reporting-cockpit.smoke.mjs` (run with
`node modules/ops-makesafe-reporting-cockpit.smoke.mjs`) encodes literal UI
copy as behavioral contracts — expect to update its string assertions
deliberately when this pane's wording changes, not to route around them.
`scripts/ses-docs-ready-review-shot.js` +
`tests/e2e/fixtures/ses-docs-ready-bertram.js` capture this pane offline (no
network) from a fixture built off the live Bertram AJBR-70271 job (job
identity/builder-routing facts only; no client name/phone/street) — the
reusable pattern for any future before/after screenshot pair of a make-safe
surface.

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

## Crew roster & lead installer (`trade.html`)

The authoritative crew and lead-installer contract, including absence semantics,
authority boundaries, shared-renderer ownership, and regression coverage, lives
in [`trade-app.md`](trade-app.md#job-detail-view). Keep this file focused on
cross-session invariants; update the owner document when the product contract
changes.

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
refuses the write rather than queueing it. The My Jobs All tab is the same story
on the job table instead of the assignment table: an empty query asks
`search_all_jobs` for the whole company feed only when the viewer already holds
the Everyone lens, and it is painted only when the server answers
`lens: 'company'` — scroll paging then follows the server's `next_offset`
(`// <all-tab-full-feed>`). Surface-level detail lives in `trade-app.md`.

Regression guards: `tests/e2e/manager-visibility.spec.js` (manager sees
unallocated+allocated), `installer-board-readonly.spec.js` (non-manager view-only),
`fencing-manager-visibility.spec.js` + `scripts/test-fencing-manager-visibility.js`
(managed fencing lead across multi-week/Unscheduled Board rows, My Jobs and
Calendar, other-crew read-only, one explicitly stubbed `allocate_job` write, and
own-assignment lifecycle refresh writes with no unapproved write), and
`all-jobs-feed.spec.js` (All-tab company feed paging, server-lens authority,
installer All tab unchanged).
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
- In `ops.html`, NEVER derive an assignment's span end as
  `scheduled_end || scheduled_date`. A row whose `scheduled_end` precedes its
  `scheduled_date` is inverted, and a `day >= start && day <= end` sweep then
  matches zero days and drops the job silently, while Schedule view's lane packer
  and percentage widths garble it instead. Read every span through
  `CalOpsCore.spanEnd(ev)`, which clamps a backwards range to a single day at its
  start. The write side has the mirror rule: serialise a computed end Date with
  `localDateStr`, never `toISOString().slice(0, 10)` — Perth is UTC+8, so UTC
  serialisation lands the previous day, which is what minted these inverted spans
  in the first place. Guards: `tests/e2e/ops-inverted-span-surfaces.spec.js` and
  `tests/e2e/ops-schedule-lane-overlap.spec.js`.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
