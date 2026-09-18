# Booking / auto-book UI hardening, 18 Sep 2026

Offline renders of the shipped door (`modules/ops-sales-booking.js` + `.css`) for the
Design desk. Nothing sent, no calendar write, Move held.

| Shot | What it shows |
|---|---|
| `nithin-pipeline-board.png` | Patio pipeline, six live stage columns. Two orange cards: thread says Contacted Waiting on Response, diary says Scope Booked. Move is held. |
| `marnin-rate-limited.png` | Fencing week with a degraded roster. Coverage names GHL 429. Pack offers still on the stamp board. Pipeline uses real fencing stage names. |
| `nithin-detail-and-board.png` | First viewport after selecting the waiting card. |
| `nithin-mobile.png` | Same Nithin door at 390×844. |
| `sale-book-lane.png` | Sale cockpit BOOK lane: Book scope is primary, Move held, ranked slots are chips, confirm sheet with editable SMS held, calendar needs-time-first with week nav and weekdays only. |

## Speed

Measured in this worktree on 18 Sep.

| What | Before | After |
|---|---|---|
| Live fencing first load (17 Sep pass 5, signed-in) | 28.2 s | unchanged: first load is still the backend read |
| Client `renderHTML` of a 121-row fencing week (avg of 20, node) | 4.23 ms | 4.73 ms (pipeline board added) |
| Scoper / week already read once | waits the full read; door goes blank | paints the cached week immediately, then refreshes. Node proof: cache is on screen before the in-flight `opsFetch` resolves. |

The 28 s first load is a backend bound (25 s server cap + render). This change does not
claim to cut that. Repeat waits paint the requested week's cache first. Last-good on
429/timeout is same-week only — see `docs/sales-booking-ui.md`.

## Captain boundaries on this change

Send is still held. Nothing in the new confirm sheet or the editable SMS can actually send. No calendar write path was added. Move stage is still disabled.

## Round trip

`scripts/sales-booking-local-api.test.mjs`: `sales_booking_stamp_write` then
`sales_booking_read` against the same store file returns the KEEP and empty `stage_moves`.
Door test: KEEP, wipe local stamp, `load()`, KEEP and the GHL card are still there.
