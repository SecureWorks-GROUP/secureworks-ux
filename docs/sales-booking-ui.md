# Sales Booking view

Ops > **Sales > Performance | Booking**. Booking is the captain's door: it reads the week,
shows what is proposed and what is out, and records a KEEP or CUT decision. It sends
nothing.

## Nothing here writes

`SEND_HOLD` is on. Opening a case is a thread read only: `selectCase` loads
`ghl-proxy?action=get_conversation` and posts nothing. Send message, Approve offer,
Confirm booking and every calendar write render **disabled** carrying `HOLD_REASON`,
and `attemptApprove()` refuses on the hold even if a click reaches it. A **stamp is not a send**: KEEP and CUT write a local
`stamp.json`-shaped record (`captain, profile, week_start, approved, rejected, decisions,
sent:false, calendar_written:false`) that ops auto-book reads on a separate authorised run.
Switching scoper drops the stamp so one scoper's decisions cannot be carried onto another.

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

- **An enumerated CRM row is not demand.** `isAssessed()` is false until the engine has
  derived a status. Unassessed rows are still findable, in their own queue group, tagged
  "Not assessed", and excluded from the tiles and the stamp board. On the live week that is
  493 of 500 rows for Nithin: a tile reading 500 was the lie this rule removes.
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
time and name, then address and suburb, then job.

## Queue

Grouped by stage: Scope to be booked, Scope booked, Visited quote to send, Enumerated not
yet assessed, plus a fold for quoted and archived. Each row carries name and suburb, job,
enquiry date with days waited, and an urgency tag.

## Preview

`node scripts/sales-booking-preview.mjs` then `http://127.0.0.1:4174/ops.html#booking`.
Reads the live Microsoft calendar through `sw-mcp` and live GHL threads; customer send
stays held. Sign-in is required for the in-page GHL thread only. The preview attaches
only the cancelled GHL enquiry (`status: repair`) to the diary event whose subject
already matches `/jason|marangaroo/i` (`sales-booking-repair-event.cjs`). Other open
enquiries keep `event_id` null, so a booked same-suburb visit cannot become their diary.

Design source: the captain-approved end-state prototype after three rounds of feedback
(`data/booking-endstate-prototype-20260916/`). Evidence:
`docs/evidence/sales-booking-door-2026-09-16/`.
