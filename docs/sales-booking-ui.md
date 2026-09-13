# Sales Booking view

Isolated branch `patio/sales-booking-20260912`, stacked on Fencing PR311. Not live.

Ops > **Sales > Performance | Booking**. Booking uses Ops tokens (warm canvas `#F8F6F3`, orange `#F15A29`, Helvetica Neue). Performance keeps its own shell.

## Data

`SalesBooking.load` calls `opsFetch('sales_booking_read', {resource, week_start, scoper_user_id})`. The isolated preview injects `SALES_BOOKING_PREVIEW_URL` and reads live Microsoft calendars through `sw-mcp`. There is no in-page fixture fallback.

Conversation interpretation is `sales-booking-assess-v2.1`. Authoritative path is structured ops-ai output plus deterministic validation. Customer facts (inbound only) are separate from candidate scheduling. "Afternoons work" records a time-of-day preference; an AI may suggest a verified-free afternoon labelled `AI-proposed date, customer date unspecified`. It must not rewrite that day as a customer-declared window or exact acceptance. Initial outreach may propose a slot pending approval. Missing calendar/leave/travel still blocks Ready. Exact acceptance still binds a preceding sent offer id and slot revision.

GHL threads use `ghl-proxy?action=get_conversation` with `opsAuthHeaders`, aborted on case/resource switch. Patio sender is 774, not the incumbent 776 default.

## Queue (flow amendment)

Default list is not-yet-scoped work, including booked visits until they happen. Filters: Ready to contact, Waiting for reply, Follow-up due, Booked, Needs a decision, plus Archived and Completed. Audit coverage sits behind the selected case.

## Selected case

Chat, proposed time and editable draft are one panel. Approve offer before exact acceptance; Confirm booking after. Both are held. Time edits revise the draft unless the human edited it, in which case the conflict is flagged. Changing an accepted slot invalidates exact acceptance. Drafts are keyed by request, not contact. An accepted offer stays on the calendar and cannot be archived until a provider event exists or the commitment is withdrawn. Switching to a diary block with no GHL contact clears the previous thread.

## Sender routing

Patio 774 is source-backed. Marnin is **unresolved** between Fencing Sales 772 (CIO 11 Sep calendar note) and Group Ops 776 (joint audit / OPS automated booking-path exemption). The UI must not guess. Khairo uses the OPS fencing sales line 772 with that source cited.

## Preview

`node scripts/sales-booking-preview.mjs` then open `http://127.0.0.1:4174/ops.html#booking`. Sign-in is still required for the GHL thread. Calendar reads go through the local preview action. Customer send remains held.

## Fencing Stratco week flags (filed read)

The week grid for Marnin's fencing resource carries the filed Stratco read of
20:04 Perth, Sunday 13 September 2026 in place: the two breaches outlined over
their own events, the agreed Friday 08:30 slot that has no event, both Tuesday
zero-travel seams, and the protected 13:00 to 15:30 band marked unreachable by
travel. Beneath the grid, `flagsHTML` writes each one out with its full event id.

Owned by `modules/ops-fencing-stratco-week.js`. This module calls it through two
one-line seams, `stratcoOverlay(dayIndex)` and `stratcoFlags()`, and keeps the
calendar's geometry (`PX_PER_HOUR`, `DAY_START`) as the only source of scale.
Both no-op on any other scoper or week.

Three rules hold this surface:

- **No control.** There is no move or cancel tool for a scope event, so every
  flag ends at the captain and the overlay renders no button, input or form.
- **The send hold covers every write shaped call, not only the ones with a
  button.** `enqueueReassess` posts `sales_booking_on_event` and fires on its
  own the moment a GHL thread loads, with no press. It is an assessment queue
  enqueue rather than a send or a calendar write, but the hold is absolute, so
  it returns `{held: true, sent: false, reason: 'send_hold'}` and records the
  skipped call on `state.lastHeldEnqueue` instead of writing. Guards in
  `modules/ops-sales-booking.test.cjs` assert that loading a cancel-shaped
  thread posts nothing and that the whole surface performs no authenticated
  POST while the hold is on.
- **A filed block says filed.** When the live read cannot paint the week, the
  overlay paints the filed events so an unreachable calendar does not read as an
  empty week, and marks every painted block `filed`. When the live read does
  carry the week it paints no events at all, only the flags.
- **A read that did not happen is never a count.** `readResultExists()` is the
  one predicate: `state.data` is null while loading, after a failed read, and
  before the first attempt, and none of those is a zero. The grid header reads
  "Provider events not read" and the queue badge reads the same rather than 0,
  and both name which of the three it is. Only a read that came back may print a
  count, and then it says whose count it is. Search
  `<read-happened-or-it-did-not>`. This matters because `sales_booking_read` is
  not deployed, so the failed read is the normal production state, not an edge
  case. Both Stratco seams pass `{status, events, error}` rather than a bare
  array so the module can tell the three apart.
- **The fixture refusal stands.** `load()` still rejects `data.fixture`. This
  overlay is not a fixture and does not go through the read path.

`npm run preview:stratco-week` opens both surfaces with no credential and no
live Ops read; `scripts/sales-booking-preview.mjs` remains the live-read path.
Search `<fencing-stratco-filed-read>`.

Guards for the read-honesty rule live in `modules/ops-sales-booking.test.cjs`:
a failed read, a read in flight, a read that came back empty and a read that
was never attempted are four distinct statements and none of them prints a zero
the surface does not have.
