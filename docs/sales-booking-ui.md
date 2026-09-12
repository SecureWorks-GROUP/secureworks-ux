# Sales Booking view

Isolated branch `patio/sales-booking-20260912`, stacked on Fencing PR311. Not live.

Ops > **Sales > Performance | Booking**. Booking uses Ops tokens (warm canvas `#F8F6F3`, orange `#F15A29`, Helvetica Neue). Performance keeps its own shell.

## Data

`SalesBooking.load` calls `opsFetch('sales_booking_read', {resource, week_start, scoper_user_id})`. The isolated preview injects `SALES_BOOKING_PREVIEW_URL` and reads live Microsoft calendars through `sw-mcp`. There is no in-page fixture fallback.

GHL threads use `ghl-proxy?action=get_conversation` with `opsAuthHeaders`, aborted on case/resource switch. Patio sender is 774, not the incumbent 776 default.

## Queue (flow amendment)

Default list is not-yet-scoped work, including booked visits until they happen. Filters: Ready to contact, Waiting for reply, Follow-up due, Booked, Needs a decision, plus Archived and Completed. Audit coverage sits behind the selected case.

## Selected case

Chat, proposed time and editable draft are one panel. Approve offer before exact acceptance; Confirm booking after. Both are held. Time edits revise the draft unless the human edited it, in which case the conflict is flagged. Changing an accepted slot invalidates exact acceptance. Drafts are keyed by request, not contact. An accepted offer stays on the calendar and cannot be archived until a provider event exists or the commitment is withdrawn. Switching to a diary block with no GHL contact clears the previous thread.

## Sender routing

Patio 774 is source-backed. Marnin is **unresolved** between Fencing Sales 772 (CIO 11 Sep calendar note) and Group Ops 776 (joint audit / OPS automated booking-path exemption). The UI must not guess. Khairo uses the OPS fencing sales line 772 with that source cited.

## Preview

`node scripts/sales-booking-preview.mjs` then open `http://127.0.0.1:4174/ops.html#booking`. Sign-in is still required for the GHL thread. Calendar reads go through the local preview action. Customer send remains held.
