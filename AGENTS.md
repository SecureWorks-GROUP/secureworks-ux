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

## Ops Insurance Repairs board (`ops.html`)

A NEW pipeline tab (`Repairs`, next to Patio) that is PARALLEL to and separate
from the make-safe (SES) board. Repair-family work (RAPID REPAIR / repair WO)
lives here, never in the make-safe Docs Ready / TRI / Prime columns. It is ONE
cohesive LIGHT kanban (same `.kanban-col` chrome + `renderKanbanCard` as
Fencing/Patio) with nine fixed columns: WO In → Scoping → Quoted → Variation →
Approved → Materials → Scheduled → On Site → Complete, split by a quiet
`Quote`/`Job` section label over the first four / last five columns. Captain UI
lock: NO dark Sales drawer, NO inverted theme, NO dark cards, no council/deposit
in v1 — do not port Patio's dark Sales column here. Search
`// <insurance-repairs-board>` (`renderRepairKanban`, `REPAIR_STAGES`,
`isRepairJob`, `repairStageOf`). Placement prefers the server `repair_stage`
(then `board_stage`, then a status fallback map); non-repair rows are dropped and
an unrecognised stage surfaces in a subtle "Unmapped" column rather than
vanishing. The intake→board FEED that routes repair rows here (and off the
make-safe board) is owned by the backend sibling lane
`insurance-repairs-intake-board-v1`; this UX adds NO client filter to the
make-safe board (it stays server-driven). Guard:
`tests/e2e/ops-repairs-board.spec.js`; evidence in
`docs/evidence/insurance-repairs-board-2026-08-13/`.

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
The make-safe MAP pairs its location feed with `makesafe-board.v1` by job id,
and the CREW WEEK PLANNER reads the canonical board rows directly. Both take
stage and substatus only from that canonical feed: a missing stage is “Stage not
confirmed”, never “New”; the planner's active/backlog and age ordering use those
same canonical values. Guard: `tests/e2e/ops-makesafe-stage-retirement.spec.js`.

Archive is on demand (backend `column_scope=active` default): the default feed
omits Archive cards but publishes `column_counts.archive` + `archive` meta. The
column badge must use that census, never `cards.length` while not loaded — a
fake zero looks like data loss. Load control: `include_archive=1` via
`loadMakesafeArchive()`. Search `// <makesafe-archive-on-demand>`; guard
`tests/e2e/ops-makesafe-archive-on-demand.spec.js`.
Three things follow from that and are part of the contract, not polish.
ARCHIVE IS STICKY: `_makesafeArchiveWanted` is set when the Captain loads history
and cleared only by closing the column, and `fetchMakesafeBoardData()` — the ONE
board read on this page, used by the default load, the 5-minute auto-refresh, the
post-transition reload and the archive load alike (`opts.includeArchive` is their
only difference) — re-requests `include_archive=1` while it is set, so a refresh
can never take history back mid-review. That function returns `null` when a newer
board read superseded it; the loser commits nothing. A CAPPED PAGE IS NOT THE
ARCHIVE: when `archive.returned`/the delivered cards fall short of the census the
state is `partial`, and the badge reads `loaded/total` with the shortfall named —
the mirror of the forbidden fake zero. THE LIST VIEW OWES THE SAME HONESTY:
`renderJobList` opens with `renderMakesafeArchiveListNotice()` (census, reason,
same load control) rather than quietly dropping ~301 rows out of the table, and
it syncs the toolbar census itself rather than inheriting the kanban renderer's
call. Because that notice is an ON switch it also carries the OFF switch
(`unloadMakesafeArchive`, which clears the flag then re-reads active scope) — the
kanban toggle is unreachable from the table, so without it the session-long
~301-card fetch could be started and never stopped. A board that answers
`include_archive=1` with no history at all lands in the error state naming what
came back, never a repainted "Load archive" shell that reads as a dead click.
The JOB DETAIL's stage lookup is scope-aware for the same reason: a job the
default read did not name is re-read with `include_archive=1`
(`ensureMakesafeCanonicalStageForJob`, tracked by
`_makesafeCanonicalStagesCoverArchive`) BEFORE anyone concludes its stage is
unknown — otherwise every archived make-safe opens as "Stage not confirmed".

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
THE REVIEW/SEND DOOR IS THE DRAFTED PACK, NOT THE QUEUE.
`makesafeCardHasReviewAffordance` / `openMakesafeJob` open the same overlay for
any Docs Ready card with a canonical drafted pack (`_makesafeCanonicalPackById`).
Queue membership is not the door — a drafted card missing `_msSesReviewQueue`
used to click into job detail. An assessment with no pack must stay on job
detail; do not invent a pack. Card chips prefer pack artifacts
(`makesafeChipFactsFromSesPack` / `_makesafePackChipById`) over enrichment
`has_wo` / `missing_docs`; READY TO SEND is withheld when the chips still say
WO missing and pack facts have not loaded. Hours and wording edits on the
overlay (`_msSesRenderSendEditors` / `_msSesApplySendPreview`) are RECORDED on
the exact docket revision via `record_ses_review_feedback` (the Feedback
channel), so the revised pack carries them; until it lands, the edited values
overlay the view as a preview keyed to that docket revision
(`_msSesSendPreview`, invalidated by `_msSesPreviewOf` on any revision/hash
change) and APPROVE AND SEND is locked — the press may never send content
different from what is shown. Retyping the pack's original values WITHDRAWS
the recorded edit: a countermanding note is recorded on the same docket, the
lock clears, and the press re-arms only from a fresh pack read — never from
the stale context. Only an explicitly labour line
(`_msSesInvoiceLineIsLabour`) is rescaled by an hours edit — never "the first
line" and never a bare "hour" match. Guard:
`tests/e2e/ops-ses-loop-overlay.spec.js`;
proof shots `docs/evidence/ses-loop-ux-overlay-v1/`.

Guard: `tests/e2e/ops-makesafe-ui-truth.spec.js`. Live verification evidence in
`docs/evidence/ses-b2-ui-truth-2026-08-02/`, regenerated end to end by
`scripts/makesafe-ui-truth-census.js` — that script is also the pattern for any
read-only live-board measurement here: it routes every request, aborts non-GETs,
and redacts client data out of every response body before it can reach the DOM or
a screenshot.

LOADING THE BOARD IS A READ AND MUST STAY ONE. `loadJobs()` used to await
`auto_approve_clean_intake_drafts` (`triggered_by: 'ops_board_autoload'`) before
fetching the board, so opening the board batch-approved intake drafts — which
CREATE LIVE MAKE-SAFE JOBS — with nobody ticking anything, and made click-to-paint
~32s against a ~3s board API. Advancement is now the explicit "Advance clean"
control on the INTAKE column (`runMakesafeCleanIntakeSweep`, trigger
`ops_intake_review_sweep`); the unattended path is the backend's own clock
(`makesafe-ses-poll` every 2 minutes, plus `makesafe_reporting_intake_pass`), not
this page. The old `?noAutoIntake=1` / `?autoIntake=0` escape hatch is GONE
because it is no longer needed — a read-only live-board session needs no opt-out.
ops-api independently refuses live approval for any non-allow-listed trigger, so a
stale cached copy of this page cannot resurrect it. Guard:
`scripts/test-makesafe-intake-sweep-explicit.js`.

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
next action (derived from the backend control flags alone), the compact
caveat block when held (amber for a hard hold, calm blue for an email-draft-only
soft hold), then document tabs over ONE compact stage — THE INVOICE
IS A DOCUMENT here (the bound Xero PDF, else the proposal rendered as an
invoice page; never a separate section) and MULTIPLE WORK
ORDERS EACH GET A TAB (`<makesafe-workorder-identity>`: no surface may pick
one and hide the rest; discriminated by `extractPoRef` when possible) — then
missing documents named in one line (RV-1; SWMS stays "not in this pack",
never "not required" — EXCEPT where the family owes no SWMS, when it shows NO
tile and NO cross at all: `_msSesSwmsNotApplicable` reads the backend
`family_evidence.swms` not_applicable state, else a temporary-fencing family
fallback. Captain ruling 2026-08-13: a SWMS red X on an AJS temp-fence job is a
family lie), condensed email previews (one-line To/Cc/Subject +
short body excerpt + attachment chips only — no "why this" essays). THE HOLD
BLOCK IS BACKEND-SOURCED AND COMPACT (Captain ruling 2026-08-13, no yellow
novel): blockers come from `cockpit.verdict.blockers` (structured entries that
may carry `evidence.route_kind`) and fall back to the legacy
`sections.status.reasons` strings only when that list is absent or yields no
readable fact — a blockers array that all normalises away must never silence the
reasons. Each caveat renders as ONE line: a short route tag + the fact VERBATIM
(never paraphrased). There is NO per-blocker "what clears it" paragraph, no lede,
and no "no override" copy — those were the essay the captain rejected
(`_msSesBlockerClears` survives only inside the dedupe key). SOFT vs HARD is the
load-bearing split (`_msSesClassifyHold` / `_msSesBlockerIsSoftDraft`, the ONE
place it is derived): an email-draft wall is SOFT — it must NEVER wall SEND. The
match covers every live phrasing, not just "email draft"/"no draft on docket":
`_msSesBlockerIsSoftDraft` also catches "… EMAIL — no draft on CURRENT docket"
(the interior word the old regex missed, which HARD-locked SEND live on
2026-08-13). It stays anchored on "email"/the "no draft on docket" idiom, never
on the bare word report/invoice, so a missing REPORT DOCUMENT is still hard.
A hold with ANY hard blocker (missing invoice,
off-schedule rate, missing WO/photo/SWMS) is a HARD hold: amber, the stamp is
disabled, the next action reads "Review N caveats". An email-draft-ONLY hold is
SOFT: calm blue "Still drafting", and arming falls through to the backend control
flags alone (`armed = !hardHold && (approve_invoice||send_it)`), so APPROVE AND
SEND arms when the invoice is ready. `sesApproveAndSend` relaxes the same gate
(hard-hold-only), and the backend chain still guards every real write/send, so
this is a client gate relaxation, not a bypass. Dedupe is over exactly what
renders (fact, case-insensitively + route tag + resolved clear path), so the
backend habit of emitting one blocker per route collapses while a genuinely
route-specific hold survives. THE INLINE STAGE IS THE BROWSER'S BUILT-IN PDF
READER, JUST TALL (Captain ruling 2026-08-14, superseding the 13-Aug custom
canvas viewers): a PDF embeds via `<iframe src="...#view=Fit">` in a
fixed-height dark stage whose height is the single knob
`--msr-stage-h: clamp(420px, 65vh, 900px)` in `ops.html` (mobile override in the
same file). Do NOT reintroduce a custom canvas/zoom viewer on the stage — the
native toolbar owns scroll and zoom. Corner chrome: OPEN DOCUMENT top-left
(`.msr-stage-open`), FIT TO PAGE tag top-right. Known, ruled-acceptable
trade-off: the native plugin can refuse a signed URL served
`Content-Disposition: attachment` (the pre-#262 "grey empty pane"); the
Open-document hatch is the escape. PDF TILE THUMBNAILS are still painted by
pdf.js (`<makesafe-pdf-preview>`, vendored lazily at `shared/vendor/pdfjs/`,
tiles fall back to the page glyph if it cannot load) because an iframe gives no
thumbnail. Headless captures of the stage need the FULL browser
(`channel: 'chromium'`; the headless shell has no PDF viewer) and no catch-all
`page.route` (interception starves the viewer's stream) — see
`scripts/ses-review-pane-native-shot.js`. A named DOCUMENT
role (`supporting_report_pdf`/`swms_artifact`) that ships in the pack with NO
minted signed URL renders an honest `doc_unavailable` tile ("on the pack, link
could not be loaded"), never the old silent drop that read as "no report
submitted" while `closeout.report` was true. Every pdf/image stage still carries
an "Open document" link to a full-size read in a new tab — keep that escape hatch if
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
the flex column). THE FOOT IS ONE COMPACT BAND (captain ruling 2026-08-13,
`docs/evidence/makesafe-review-pane-layout-2026-08-13/`): small stamp beside a
one-line note that always keeps the irreversibility warning visible, with the
full press sentence folded verbatim into "What one press does" — decoration
never keeps its size at the document preview's expense (viewport-realistic
capture pattern: `scripts/ses-review-pane-viewport-shot.js`; full-page shots
hide foot-vs-preview bugs). APPROVE INVOICE then SEND IT, always visible; armed ONLY by
`controls.approve_invoice.enabled` / `controls.send_it.enabled`; a disabled
stamp has no id and no onclick, both action functions re-check the flag, and
an enabled stamp's note renders the backend's own `plan` text verbatim. A
DISABLED STAMP OWES A REASON: its note is `controls.<stamp>.disabled_reason`
verbatim when the backend sends one (that is how an invoice already AUTHORISED
in Xero reads as "already authorised" instead of a silent grey stamp), and only
when that field is absent does it fall back to the local hold-lock / Xero
status / not-unlocked copy. A missing field means honest fallback text, never a
placeholder implying a value that is not there. Note the money semantics that
copy must respect (Option B, backend PR 563): the agents mint the Xero DRAFT
invoice, so APPROVE INVOICE AUTHORISES an existing draft — it does not create
one. The mockup's single combined "Approve & send pack" button is the RETIRED 410 path
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

WHAT BECOMES A DOCUMENT TAB IS DECIDED BY BYTES, NEVER BY A ROLE ALLOWLIST.
`_msSesDocsFromArtifacts` used to map six known artifact roles and silently drop
the rest, so the portal roof capture was invisible on the review screen while
the pack served it with a working signed URL — and the server label is no help
(`sesReviewArtifactDisplayLabel` still returns null for 13 of 14 roles, in the
backend repo). `_msSesArtifactIsDocumentBytes` now admits any artifact carrying
PDF or IMAGE bytes; the role is consulted only for the tab's NAME, and an
unrecognised role renders under its stored file name and says the role is
unlabelled. JSON/text/HTML artifacts stay non-documents — they are plan files the
routes and invoice sections already render — so a future readable document
shipped as HTML would still be invisible. Search
`// <ses-pack-document-visibility>`.
The capture's own facts come from the pack's JSON `portal_roof_report` manifest,
read off its signed URL once per load (`_msSesHydratePortalCaptureFacts`); a
failed read says so and never lets an undated capture read as a fresh one.
IDENTICAL BYTES ARE ONE PIECE OF EVIDENCE: captures sharing a `content_hash`
collapse to ONE tab that states the copy count (a retake that only changed a
file name broke the producer's idempotency), while captures whose bytes differ
each keep a tab, per `<makesafe-workorder-identity>`. A capture from an earlier
attendance cycle is labelled as one, and a card that OWES a capture (backend
`family_evidence.roof_report_capture`) and has none states the gap where the tab
would be, quoting the backend's reason and recovery action — missing evidence
must look missing. Search `// <ses-roof-capture-provenance>` and
`// <ses-roof-capture-absence>`; guards in the module smoke; evidence in
`docs/evidence/ses-roof-capture-document-tab-2026-08-06/`.
KNOWN GAP recorded there: for `ordinary_roof_portal` cards the pack's
`portal_roof_report_screenshot` is a producer PLACARD proving the form was
submitted and locked, not the form itself; the readable 4-page roof report lives
only in `job_documents` (`type: roof_report`) and is not in the pack, so this
pane cannot show it. Do not "fix" that by joining job documents into the pack's
tab strip without a Captain ruling — this pane renders the byte-exact pack.

The LIVE PORTAL READER THUMB on roof/assessment cards (kanban + Docs Ready
cockpit header) shows the board's stored Prime/PrimeEco screenshot and an honest
chip WITHOUT a human opening the portal: Locked / Filling n-of-n / Link gone /
Locked · link gone. The chip's LATEST result decides reachability, the SHOWN shot
decides "was it ever locked" — a later `unreachable` never erases a prior `done`
(an expired link after lock is an aged job, not waiting). The thumb opens the
STORED screenshot only; the Prime share URL is never carried here (it expires
~30 days and would read as a dead click). Source: the canonical board row's
`portal_capture` block (backend sweep lane owns writing it from
`makesafe_portal_capture_revisions`); the UX reads only those fields and derives
the chip. Search `// <makesafe-portal-live-thumb>` in `ops.html`; the cockpit
header calls `renderMakesafePortalThumbForJob`. Only a signed http(s) read (or an
inline `data:image` from the offline harness) is showable — never a storage key
or `data:text/html`. Guard: `tests/e2e/ops-makesafe-portal-live-thumb.spec.js`;
visual proof `scripts/ses-portal-thumb-shot.js` +
`tests/e2e/fixtures/ses-portal-thumb-glendalough.js` (drawn facsimile, never the
live capture), evidence in `docs/evidence/ses-portal-live-thumb-2026-08-13/`.

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

Trade Today deliberately borrows make-safe assignments from This Week/Upcoming
and past-dated work from Needs Report. Those borrowed strips are report-debt
views, not history: filter them through `shouldShowTodayMakesafeLeftover`, which
reuses `isOpenMakesafePoolJob` and `isReportSubmittedForTradeCard` so archived or
terminal jobs and submitted/post-trade reports cannot leak back in. A live
make-safe that still owes the trade's report remains visible even after the
attendance assignment is complete. All and History keep their historical scope.
Guard: `scripts/test-trade-today-run-list.js` (wired into `npm run test:e2e`).

## Crew roster & lead installer (`trade.html`)

The authoritative crew and lead-installer contract, including absence semantics,
authority boundaries, shared-renderer ownership, and regression coverage, lives
in [`trade-app.md`](trade-app.md#job-detail-view). Keep this file focused on
cross-session invariants; update the owner document when the product contract
changes.

## Trade visibility & the manager view (`trade.html`)

Canonical make-safe BOARD PLACEMENT is 100% SERVER-DRIVEN by the `makesafe_board`
feed (`makesafe-board.v1`, edge function — not in this repo).
`MakesafeTradeV5.board()` renders every returned card in its returned column and
never derives stage or action rights locally. A manager's full board still comes
from `permissions.sees_all_makesafes:true` / `can_allocate:true`; a non-manager's
canonical rows may still be `allocated_only` + `can_allocate:false`. FINDABILITY
is deliberately broader than those columns: a typed MakeSafe Board search also
uses authenticated `search_all_jobs`, keeps only make-safe hits absent from the
feed, and renders them in the uncolumned **MakeSafe database matches** list. Never
merge those search rows into canonical columns because that feed carries no stage.
They may open the report path, but search visibility grants no Allocate or write
authority.

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
(`// <all-tab-full-feed>`). A typed All query is available to every authenticated
trade and can open an unallocated make-safe; global results render ONLY on All.
Today, Assigned, This Week, Active, and History remain assignment/day-scoped.
Surface-level detail lives in `trade-app.md`.

A GHOST `role:'observer'` ASSIGNMENT ROW IS A WATCHER AND NEVER SPEAKS FOR A
JOB'S SCHEDULE. Ops staff are mirrored onto a job so it shows in their own list;
that row is not moved when the crew's real assignment is rescheduled, so its date
goes stale the moment anyone drags the job on the Ops Dash calendar. Both
calendars (ops.html and the Trade calendar, via `trade_calendar`) read the
`calendar_events` view, which is defined `WHERE is_ghost = false`, so neither can
see one. `my_jobs` selects `job_assignments` RAW — only `.neq('status','cancelled')`
— so the fencing Board is the one surface that receives ghosts and must apply the
rule itself: `FencingBoardCore.isObserverRow` drops them at intake and reports
`observerRowsDropped` rather than dropping them silently. Match on `role`, not
`is_ghost`: the feed does not publish `is_ghost`, and on every live row the two
agree. This matters because the Board's one-card-per-job dedupe ranks by
`status` alone, so a ghost TIES with the real crew row and the feed's
`scheduled_date`-ascending order then hands the tie to the staler date. Guard:
`scripts/test-fencing-board-ghost-rows.js` (runs in `pr-check.yml`).

Regression guards: `tests/e2e/manager-visibility.spec.js` (manager sees
unallocated+allocated), `installer-board-readonly.spec.js` (non-manager view-only),
`fencing-manager-visibility.spec.js` + `scripts/test-fencing-manager-visibility.js`
(managed fencing lead across multi-week/Unscheduled Board rows, My Jobs and
Calendar, other-crew read-only, one explicitly stubbed `allocate_job` write, and
own-assignment lifecycle refresh writes with no unapproved write),
`all-jobs-feed.spec.js` (All-tab company feed paging and server-lens authority),
and `trade-makesafe-search-visibility.spec.js` (unallocated make-safe search/open
from All and Board while Today remains assignment-scoped).
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
