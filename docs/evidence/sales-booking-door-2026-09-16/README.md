# Sales Booking door, real-data preview, 16 Sep 2026

Captured from `node scripts/sales-booking-preview.mjs` against the **live** Microsoft
calendars (via `sw-mcp`) and **live** GHL threads. No fixtures: the module refuses a
`fixture:true` envelope.

| Shot | What it shows |
|---|---|
| `nithin-week-14sep.png` | Nithin, week of 14 Sep. 5 real provider events plus 5 AI proposals. The cancelled Marangaroo slot reads CANCELLED and stays blocked. Four Monday proposals share the column rather than hiding each other. 7 assessed enquiries; 493 enumerated CRM rows named and excluded from the tile. The detail panel carries the real arrival-window draft. |
| `marnin-week-14sep.png` | Marnin, week of 14 Sep. 11 real provider events, 776 line, Stratco lane stated as an offering rule over real off-lane bookings. |
| `stamp-board-nithin.png` | Five stampable AI proposals (Carlisle, Merriwa, Mt Hawthorn, Fremantle, Scarborough) with evidence chips, the why-stamp checklist, and KEEP / CUT live. Withheld lines named with their reason, including Marangaroo and Jason blocked. |

## How the stamp board reads on the real week

Every one of these is an **AI proposal**: the customer did not name the day, and calendar,
leave and travel coverage was not read. Under the captain's ruling that is exactly what he
stamps, so each line is offered with its reasons on the card rather than withheld.

| Case | Proposed | Why it is a caution, not a refusal |
|---|---|---|
| Carlisle | Tue 15 Sep, arrive 1:00 to 2:30pm | Weekday named without a calendar date |
| Merriwa | Fri 18 Sep, arrive 8:00 to 9:30am | Weekday named without a calendar date |
| Mt Hawthorn | Mon 14 Sep, arrive 12:00 to 1:30pm | Yes is not bound to a preceding sent offer id |
| Fremantle | Mon 14 Sep, arrive 1:00 to 2:30pm | Qualified yes is not exact acceptance |
| Scarborough | Mon 14 Sep, arrive 1:00 to 2:30pm | Customer date unspecified |

Every line carries the coverage caution (calendar, leave and travel unread) and "No exact
acceptance yet, so this stamp offers a time. It does not confirm one."

Withheld and named on the board, never dropped:

- **Marangaroo** and **Jason** (2): cancelled in the thread with the diary event still
  present. Blocked until the delete reads back. No KEEP / CUT.
- **Arlette Bruggeman, Eva Suh, Aaron Koh, Jennifer** (4): booked visits with no proposed
  time, so there is nothing to stamp.
- **493 enumerated CRM rows**: the engine has not assessed them yet.

Confirm booking is unavailable on every line, which is correct: execution-ready means exact
acceptance bound to a sent offer, and none of these have it. That gate is separate from the
stamp, and both are hard-held in any case.

## Capture method

The preview serves `ops.html` behind the standard auth gate. For an offline capture the
gate's injected stylesheet (`#swAuthGateStyle`) is removed in-page, exactly as
`scripts/ses-loop-overlay-shot.js` already does. No credentials are used and no write is
issued; every request is a read.
