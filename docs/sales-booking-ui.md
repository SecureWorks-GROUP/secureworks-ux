# Sales Booking view

Ops > **Sales > Performance | Booking**. Booking is the captain's door: it reads the week,
shows what is proposed and what is out, and records a KEEP or Cut decision. It does not
send a customer text, write a diary or move a GHL stage.

## Send is the stamp, nothing else

`SEND_HOLD` stays on for Approve, Confirm, calendar writes and any customer send.
`attemptApprove()` still refuses those. **Send message** is the captain stamp: it POSTs
`sales_booking_stamp_write` with `{resource, week_start, stamp: {captain, approved, rejected,
decisions, stage_moves: []}}` (opportunity ids) and re-reads. Cut posts the same body with
the id under `rejected`. Approve/Confirm stay disabled.

On load, `pack: {present, as_of}` and `stamp: {present, as_of, approved, rejected, decisions,
stage_moves}` plus per-case `proposal` / `stamp_state` / `drafts` are consumed. Absent pack
renders as "No proposals published yet for this week", never as empty free capacity.

## Diary paint

`diary[]` from GHL calendars (`kind` busy|leave|personal, `blocks_capacity`, `title`).
CONFIRMED only when the event matches a case (opportunity or contact id, else exact
name and suburb on a queue row) or the title starts with `Scope:`. Everything else paints
PERSONAL or Busy, honours `blocks_capacity`, and counts nowhere in "Booked to quote this
week" or Scope booked. Company titles such as Payday SecureWorks, Outback Agreements and
SecureWorks are Busy.

**Tiles:** "Booked to quote this week" counts only diary events matched to a case, never GHL
stage rows. No matched diary reads 0 with "diary not read". "Quotes to send" is the quote-stage
count, labelled as that stage. Enquiries and Waiting stay stage-based and say so.

Switching scoper still drops the in-memory stamp; the next read supplies that scoper's
stored stamp.

## Stampable and execution-ready are different gates

Captain ruling 2026-09-16. **Execution-ready** means exact acceptance bound to a sent offer
id and slot revision. It gates **Confirm booking alone**, never the stamp board.

The stamp board is the captain's KEEP or CUT over **AI proposals**. A slot the engine labels
"AI-proposed date, customer date unspecified" is precisely what he stamps, so the engine's
refusal reason is shown on the card as the **why-stamp checklist**, never used to hide the
row. Coverage gaps (leave and travel unread) are warning chips, not a bar to stamping.
`sales-booking-assess.cjs` therefore keeps the candidate slot and records
`execution_ready:false, stampable:true, coverage_gaps[], warnings[]` instead of nulling the
proposal.

Only three things remove a stamp, and each says so on the board by name:

1. The slot is blocked: cancelled in the thread with the diary event still present.
2. The time is still held by another cancelled booking awaiting delete readback
   (`blockingDiaryEvent()`, occupancy, so it holds against any customer's proposal).
3. There is no proposed time at all.

`stampBlockReason()` is the single predicate; the board, the detail panel and `stampCase()`
all consult it, so a stale click cannot record what the markup refuses.

The checklist dedupes **by meaning**, not by exact text (`checklistTopic()`): the engine
emits the same fact as a warning, a review reason and a structured gap list, and letting all
three through produced exactly the essay the captain has already rejected once.

## Captain defaults for v1 (2026-09-16)

Recorded in `CAPTAIN_DEFAULTS` and rendered on the page so they can be flipped, not
re-derived.

| Default | Value | Where to flip |
|---|---|---|
| Scopers | Nithin plus Marnin | `V1_SCOPERS`; Khairo stays fully configured in `RESOURCES` |
| Scopes done window | this week plus last | `CAPTAIN_DEFAULTS.scopes_done_window`, drives the tile subtitles |
| Stratco sender line | 776 | `RESOURCES.marnin.sender` |
| Stamp board | agent-driven, human-typed later | `CAPTAIN_DEFAULTS.stamp_board` |

Marnin's line was **unresolved** between Fencing Sales 772 and Group Ops 776. The captain
settled it at 776 for v1. That is a recorded default (`sender_default`), not code guessing:
both source claims stay in `sender_candidates` so the flip needs no archaeology.

## Data

`SalesBooking.load` calls `opsFetch('sales_booking_read', {resource, week_start,
scoper_user_id})`. There is no in-page fixture fallback and a `fixture:true` envelope is
refused. The backend ships scoper events as `diary[]` (`kind: busy|leave|personal`); PR
#312's preview ships them as `events[]`. `diary()` reads both and de-duplicates by id, so
the surface works before and after the backend lands.

GHL threads use `ghl-proxy?action=get_conversation` with `opsAuthHeaders`, aborted on
case or resource switch.

## What the surface refuses to claim

- **An enumerated CRM row is not demand.** `isAssessed()` is true when the row matches a
  pinned GHL stage (exact `stage_id` if present, else exact `stage_name`), or when a
  reason/proposal is already on the row. Live `sales_booking_read` cases carry `stage_name`
  and placeholder `status: needs_decision` only; they have no `stage_id`, reason, or
  proposal today. Unmapped rows stay findable under **Enumerated, not yet assessed**, tagged
  "Not assessed", and stay off the demand tiles and the stamp board.
- **`needs_decision` is not Act today.** Urgency is booked, quote outstanding, waiting, then
  the wait-based labels. Act today comes only from a proposal or a repair status. A later
  backend proposal field will affect cards and urgency only, never grouping.
- **An unread enquiry date is not today.** `daysWaiting()` returns null and the row says
  "Enquiry date not read".
- **A cancelled visit is not a confirmed booking.** `diaryLayerFor()` lets the case's
  derived layer beat the raw provider kind, so a thread-cancelled job whose Outlook event
  survives paints CANCELLED and keeps the slot blocked until the delete reads back.
- **A desk rule is not the diary.** An off-lane day with real provider events shows
  "Outside the <name> lane" rather than hatching real bookings closed.
- **An empty diary is not spare capacity.** Coverage gaps are named, not smoothed.
- **The customer is promised a window, never a minute.** Both `suggestedDraft()` in the UI
  and the engine's own draft in `sales-booking-assess.cjs` write a 60 to 90 minute arrival
  window in the scoper's voice, with a spoken date rather than an ISO one. No em dashes.
- **No card hides another.** `packLanes()` puts overlapping calendar cards side by side. Two
  AI proposals on the same hour both render; a proposal concealed under another is a line the
  captain never gets to stamp.

## The week grid

Five layers, each with a stage tag on the card: Confirmed booking, Proposed (not sent),
Offered (waiting on reply), Cancelled (still in diary), Personal. Cards read stage, then
time and name, then address and suburb, then job. Previous / Next week (`data-booking-week`)
re-reads that week's diary and keeps the requested Monday on the grid, even when the pack's
own `week_start` is an earlier week. Proposals whose windows fall outside the shown week
stay off the grid until that week is opened, but they stay listed on the queue and stamp
board with their calendar day and arrival window.

GHL cases in the live read may carry `suburb: null`. Display, search, drafts and
name-and-suburb diary matching take suburb from the proposal when the case has none.

## Queue

Grouped by the live GHL pipeline stages copied into `RESOURCES.*.pipeline_stages`
from wiki `harness/ops/skills/secureworks-scope-booking/profiles/{patio-nithin,fencing-stratco-marnin}.json`
(PR https://github.com/SecureWorks-GROUP/secureworks-wiki/pull/438). Scope-needing
stages and booked-not-yet-visited stages render first. Quoted, won, lost and
archived stages fold under **Show quoted and archived**. Rows with no matching
stage stay in **Enumerated, not yet assessed**. Tiles count follow-through from
those stages (still to book, waiting, booked, quotes), not the whole CRM.
Waiting-on-reply is the patio stage **Contacted Waiting on Response** by exact
name (and the id when present). Fencing waiting is `thread_facts.classification`
only, so a fencing row with no proved text is never Waiting.
`sales_booking_read` may take ~20s; the client waits 60s. A failed calendar
(`diary_read.read_ok:false`) shows "Calendar not connected" and still paints the
queue and thread facts. Coverage gaps render verbatim.

## Preview

`node scripts/sales-booking-preview.mjs` then `http://127.0.0.1:4174/ops.html#booking`.
Reads the live Microsoft calendar through `sw-mcp` and live GHL threads, then overlays
the published engine pack when `SALES_BOOKING_PACK_PATH` or a live `sales_booking_read`
is available, so proposal suburbs and later-week windows match production. Customer send
stays held. `node scripts/sales-booking-preview.mjs --verify` prints the marnin pack
census (proposals / offers / slot labels) and exits. Sign-in is required for the in-page
GHL thread only. The preview attaches only the cancelled GHL enquiry (`status: repair`)
to the diary event whose subject already matches `/jason|marangaroo/i`
(`sales-booking-repair-event.cjs`). Other open enquiries keep `event_id` null, so a
booked same-suburb visit cannot become their diary.

Design source: the captain-approved end-state prototype after three rounds of feedback
(`data/booking-endstate-prototype-20260916/`). Evidence:
`docs/evidence/sales-booking-door-2026-09-16/`. Live-door fix:
`docs/evidence/booking-door-live-fix-2026-09-17/`.
