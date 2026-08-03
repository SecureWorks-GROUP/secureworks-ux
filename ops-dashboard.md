# Ops Dashboard (ops.html)

## Status: LIVE
**File**: `dashboard/ops.html`
**User**: Shaun (Operations Manager)
**Auth**: Supabase magic link
**API**: `ops-api` edge function (--no-verify-jwt)

## 5 Tabs
1. **Today** — AI morning brief, attention items (actionable), today's assignments, upcoming week
2. **Calendar** — Full calendar view, crew assignments, drag scheduling, crew utilisation sidebar
3. **Jobs** — Job list with filters, slide-out detail panel, status pipeline, scope data
4. **Financials** — Job P&L, PO tracking, invoice status, Xero push
5. **Materials** — PO creation, supplier list, delivery tracking, scope-to-PO extraction

## Key Features
- AI chat sidebar (Claude sonnet via ops-ai)
- Morning brief (auto-generated, 30-min cache)
- Actionable attention items (click to schedule/invoice/create PO)
- Complete + Invoice cascade (mark job complete → auto-create Xero invoice)
- Scope-to-PO material extraction (auto-populates PO from scope_json)
- Assignment completion cascade (complete buttons, prompt when all done)
- Crew utilisation (bar chart, colour-coded green/amber/red)
- Make-safe cards render the server-supplied stage; cards without a trustworthy stage show an escaped **Waiting on Captain** action message instead of a browser-inferred status.
- Make-safe job detail keeps one job card while listing each attendance-cycle trade report separately. Opening a visit report shows only photos bound to that report's `attendance_cycle_id`; unbound media is not guessed onto a multi-visit report.
- Calendar Schedule view clamps an inverted assignment span (`scheduled_end` before `scheduled_date`) to a single day at its start, so a bad row never paints its bar over a lane-mate; long bar labels ellipsize inside their own bar (guarded by `tests/e2e/ops-schedule-lane-overlap.spec.js`).

## Calendar drag-to-reschedule (CP1, flag `dragv2`)
Feature flag: DEFAULT ON (Captain-approved team-wide enable). Kill switch: `?dragv2=0` for one page load or `localStorage.sw_cal_dragv2 = '0'` persistently; `?dragv2=1` / `'1'` are still accepted so old bookmarks keep working. Off = the pre-CP1 calendar-delta drag, byte-identical (single Captain-authorized exception: the flag-off create-span fix below). When ON:
- **Move**: drag the card body; the drop day becomes the new START and the job's length is preserved in WORKING days laid forward skipping weekends (Fri 2-day job dropped on Wed = Wed–Thu).
- **Resize**: drag either edge handle onto a day; the other edge holds, span never inverts. Same weekend-skip counting (Fri job pulled one day longer = Fri + Mon).
- **Both views drag**: Crew (swimlane, per-assignment blocks) and Schedule (`renderScheduleView`, job-grouped bars; the active view sticks in `localStorage.sw_cal_view_mode`). Schedule-view drops carry only a DAY — that view has no crew rows, so a drop never reassigns. A single-assignment bar routes through the same move path as the Crew view (confirmed lock, span-depth availability warning, V2 payload, SMS offer) but pins the event's own `user_id` (`opts.pinnedUserId` on `moveAssignment`/`doMoveAssignment`), so a display-name lookup (deactivated user, duplicate names) can never resolve to a different person and silently turn the move into a reassign; Crew-view callers omit `opts` and keep name resolution — that is what powers cross-row reassignment there. A multi-crew bar moves every assignment under it, each keeping its working-day offset, with ONE SMS offer for the job: every per-assignment plan is built up front (a plan that isn't a pure move is refused before anything is written), then ONE combined availability check runs across every affected crew member's moved working-day span — a single "Crew Unavailable" / "Schedule Anyway" confirm (the same shared `collectSpanClashes` / `confirmClashesOrProceed` helpers single moves use) lists each clash as name — day — status (Captain ruled one combined modal, never one per crew), cancel writes nothing, and a mid-move failure reloads the calendar so the view matches what was actually written.
- **Availability warning is span-depth (Captain ruling cp1-askuser-2)**: with dragv2 ON, a single-assignment move in EITHER view (shared `moveAssignment`) checks every painted day of the moved working-day span — not just the drop day — at the same depth as a multi-crew bar move: `CalOpsCore.movedSpanV2` derives the moved span (the ONLY derivation — the warning and the write share it so they can never disagree), `collectSpanClashes` collects each clashing crew-day, and `confirmClashesOrProceed` shows one combined "Crew Unavailable" confirm however many clashes. Flag off keeps the original drop-day-only check; edge-resizes keep the target-day check.
- **Schedule-view handles/overlay**: edge-resize handles render only on bars mapping to exactly ONE assignment (a multi-crew bar has no single edge to resize) and only on true endpoints, not week-clipped continuations. Bars float on a `pointer-events:none` overlay above the day cells, so bars accept `dragover`/`drop` and the drop resolves the day cell beneath via `elementsFromPoint`. Confirmed bars are locked in both views (toast points to the popup's Reschedule).
- **Weekends are opt-in**: interior Sat/Sun are breaks — a weekend-crossing bar paints Mon–Fri, breaks, resumes Monday as ONE logical job. A weekend day counts only when deliberately chosen as an endpoint (drop or edge-drag onto Sat/Sun). In the Schedule view this break render is itself flag-gated: dragv2 ON lays each job's active dates via `CalOpsCore.paintedSpanDates`, so the existing contiguous-run splitter breaks a weekend-crossing job into segments (Fri | Mon) exactly like the Crew view, and dragging EITHER segment reschedules the whole job; flag OFF keeps the original every-calendar-day loop byte-identical.
- **Reschedule SMS prompt**: after a drop or start-changing resize, a confirm asks "Do you want to send [client] a reschedule update?" — Yes calls `send_client_update` with trigger `install_rescheduled`. Nothing sends without that explicit Yes; an end-day extension never prompts.
- **Duration source**: the rendered `scheduled_date..scheduled_end` span wins when `scheduled_end` exists (legacy rows carry an unused `duration_days` default of 1 — a drag must never collapse a visible multi-day bar); `duration_days` is used only when there is no span. Every dragv2 write carries all three fields so `duration_days` becomes real from first use.
- **Unflagged real-crew fix**: the sidebar-drag Schedule modal now requires picking a real crew member from the user list (`create_assignment` with camelCase keys + `userId`). Free-typed names created `user_id NULL` rows the Trade App's my-jobs filter can never show; the backend rejects name-only installs. If the boot-time crew fetch failed or is still in flight, opening the modal retries `loadCrewList()` and repopulates the select (a toast says close-and-reopen if it still fails) — without options the select is a dead end, since a real `userId` is required to create.
- **Flag-off create-span fix (Captain ruling cp1-askuser-2)**: the Schedule modal's flag-off end date is computed with `localDateStr`, not `toISOString()` — the UTC conversion rolled local midnight back a day in Perth (UTC+8), so a 1-day create wrote `scheduled_end` the day BEFORE `scheduled_date` (the inverted spans the Crew view silently drops). Same intended calendar-day span, correct in local time; the dragv2 branch lays working days via `CalOpsCore.layWorkingDays` as before.
- Crew-change drags keep the G2 allocation semantics (delete + `create_assignment` with NO confirmationStatus, so the new installer gets the allocation SMS) — only the span/duration math changed.
- Pure date math lives in the `// <calendar-ops-core>` block; guarded by `tests/e2e/cal-workdays.spec.js` (extracts and evaluates the shipped code). Drag itself is guarded by `tests/e2e/cal-drag-real-input.spec.js` — trusted pointer input only, both views (synthetic-event checks once masked a Schedule view with no drag wiring at all), including a weekend-crossing fixture that must render as broken segments in BOTH views and reschedule the whole job when either segment is dragged, plus Perth-pinned (UTC+8) checks that a flag-off modal create writes the intended local span and that a single-crew move onto mid-span leave raises the combined warning.

## ops-api Actions
See edge-functions.md for full list. Key ones:
- `schedule`, `update_assignment`, `delete_assignment` — calendar CRUD (dragv2 updates carry `scheduled_date` + `scheduled_end` + `duration_days`)
- `create_assignment` — camelCase payload from the Schedule modal (`jobId`, `userId`, `crewName`, `scheduledDate`, `scheduledEnd`, `durationDays`, …); `userId` required for installs
- `send_client_update` — client comms; calendar reschedule uses trigger `install_rescheduled` (explicit-confirm only; server dedups per job + new date)
- `create_po`, `update_po`, `push_po_to_xero` — purchase orders
- `create_wo`, `update_wo` — work orders
- `job_detail` — full job data with assignments, POs, WOs, scope, invoices
- `morning_brief` — AI-generated daily summary
- `complete_and_invoice` — compound action (mark complete + Xero invoice)
- `scope_to_po` — extract materials from scope_json into PO line items

## Data Quality Issues (audit 3 March 2026)
- **site_suburb/site_address**: NULL on 100% of jobs — location features non-functional
- **scope_json**: empty on all jobs — scope-to-PO extraction has no data yet
- **pricing_json**: GHL totals only (no line items) — cascade creates single-line Xero invoices
- **137 legacy jobs**: bulk-moved from `complete` → `invoiced` (GHL imports, already invoiced via Tradify)
- **Attention items**: "not_invoiced" now includes `job_ids` for click-to-action (was missing)

## ops-ai Edge Function (AI Chat Backend)
- **File**: `supabase/functions/ops-ai/index.ts` (~595 lines)
- **Model**: claude-sonnet-4-6 with tool_use (max 5 tool rounds)
- **Dual context**: `view: 'ops'` (9 tools) or `view: 'ceo'` (7 tools)
- **Ops tools**: search_jobs, get_schedule, get_job_detail, search_invoices, get_attention_items, create_assignment, update_job_status, complete_and_invoice, draft_communication
- **CEO tools**: get_dashboard_summary, get_job_profitability, get_marketing_summary, get_trends, get_sales_breakdown, search_invoices, get_debt_followup
- **Write actions require confirmation**: create_assignment, update_job_status, complete_and_invoice return action cards — frontend shows Confirm/Cancel buttons
- **Auto-context**: pulls ops_summary (ops view) or dashboard_summary (ceo view) into system prompt
- **Calls ops-api and reporting-api internally** via service role key
- **Conversation**: last 20 messages sent, localStorage stores last 50

## Chat Sidebar (Frontend)
- Present on both `ops.html` and `ceo.html`
- Floating FAB button (bottom-right, branded orange)
- 400px slide panel with markdown rendering
- Quick prompts (ops: morning brief, attention, stale invoicing, schedule; ceo: month summary, margins, overdue AR, type analysis)
- Action cards for write ops with Confirm/Cancel
- localStorage persistence: `sw_ops_chat` / `sw_ceo_chat`

## Assignment Cascade Flow (Feature 6)
1. Job detail panel shows "Complete" button next to each non-complete assignment
2. `markAssignmentComplete()` calls `opsPost('update_assignment', {status:'complete'})`
3. Backend checks if ALL assignments for that job are now complete
4. If yes, returns `{all_complete: true, suggest_status: 'complete'}`
5. Frontend shows toast: "All assignments complete — mark job as complete?"
6. Three options: Complete + Invoice (opens cascade modal) | Complete Only | Not Yet

## Depends On
- `ops-ai` edge function for chat + morning brief (needs ANTHROPIC_API_KEY secret — NOT SET YET)
- `ops-api` edge function for all data (deploy with --no-verify-jwt)
- Supabase auth for login (magic link)
