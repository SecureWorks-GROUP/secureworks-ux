# Sales Booking door, real-data preview, 16 Sep 2026

Captured from `node scripts/sales-booking-preview.mjs` against the **live** Microsoft
calendars (via `sw-mcp`) and **live** GHL threads. No fixtures: the module refuses a
`fixture:true` envelope.

| Shot | What it shows |
|---|---|
| `nithin-week-14sep.png` | Nithin, week of 14 Sep. 5 real provider events. Cancelled Marangaroo slot reads CANCELLED and stays blocked. 7 assessed enquiries; 493 enumerated CRM rows named and excluded from the tile. |
| `marnin-week-14sep.png` | Marnin, week of 14 Sep. 11 real provider events, 776 line, Stratco lane stated as an offering rule over real off-lane bookings. |
| `stamp-board-marnin.png` | Held actions, Stamp KEEP / CUT, and the `stamp.json` the terminal reads with `sent:false, calendar_written:false`. |

## Finding the captain should see before tomorrow

On the real week of 14 Sep the engine produced **zero execution-ready proposals** for
either scoper. Every assessed enquiry was refused with its own reason, read from the live
thread:

| Case | Engine's reason |
|---|---|
| Carlisle | Customer named a weekday without a calendar date. A slot on that weekday is an AI proposal. |
| Merriwa | Customer named a weekday without a calendar date. A slot on that weekday is an AI proposal. |
| Mt Hawthorn | Yes is not bound to a preceding sent offer id and slot revision. |
| Fremantle | Qualified yes is not exact acceptance. |
| Scarborough | Customer date unspecified. Any chosen day is an AI proposal, not a customer-stated date. |
| Marangaroo | Calendar, leave or travel coverage is missing. Not execution-ready. |

So the stamp board is correctly empty: there is nothing execution-ready to stamp. That is
the engine holding the line, not the surface failing. The gating input is coverage
(operational leave and travel are unread) plus threads that never named a date. Worth
knowing before the surface is expected to produce stampable lines in the morning.

## Capture method

The preview serves `ops.html` behind the standard auth gate. For an offline capture the
gate's injected stylesheet (`#swAuthGateStyle`) is removed in-page, exactly as
`scripts/ses-loop-overlay-shot.js` already does. No credentials are used and no write is
issued; every request is a read.
