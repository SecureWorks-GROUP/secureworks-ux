# Fencing Stratco week, filed read of 13 September 2026

What this folder holds, and what it is not.

## What it is

`stratco-week-filed-read.json` is a checked-in, privacy-scrubbed copy of the
filed Stratco calendar read for the week starting Monday 14 September 2026,
taken at 20:04 Perth on Sunday 13 September 2026. It is the authority for the
Stratco panel on the Sales Performance surface and the Stratco flags on the
Sales Booking surface.

It is a **filed** read. Nothing in this repository re-derives it, and no surface
that renders it claims it is live.

Source of truth, in `secureworks-wiki`:

- Report: `coding/work/campaigns/ceo-ops/lanes/FENCING_SALES/STRATCO-CALENDAR-TRUTH-2026-09-13.md`
- Evidence: `coding/work/campaigns/ceo-ops/lanes/FENCING_SALES/evidence/2026-09-13-stratco-calendar-readback.json`
- Booking authority: `coding/work/campaigns/ceo-ops/lanes/FENCING_SALES/CAPTAIN-RULING-2026-09-11-STRATCO-BOOKING.md`

Customer names and street addresses are deliberately not carried across. Suburb,
Stratco ref and provider event id only, which is the same rule
`tests/e2e/fixtures/ses-docs-ready-bertram.js` follows.

## The four numbers

| Figure | Value |
|---|---|
| Visits agreed | 8 |
| In calendar | 6 |
| Initial booking threads unanswered | 5 |
| Agreed versus calendar breaches | 2 |

Four things the read does not measure are named as unmeasured on the surface,
never as zero: Khairo's own calendar, which two agreed visits have no event at
all, operational leave, and non-primary calendars.

## The two breaches

- **Woodlands 231399.** Customer agreed Friday 18 September 08:30. The calendar
  reads Tuesday 15 September 11:45 to 12:30. Wrong day and wrong time, and the
  Friday 08:30 slot is missing from the calendar entirely.
- **Balga 231211.** Customer agreed 11:30. The calendar reads Tuesday 15
  September 11:15 to 11:45. Fifteen minutes early.

Both had been wrong for over 51 hours at the read. Neither can be fixed by any
desk: the tool catalog exposes `sw_create_scope_booking` and calendar reads only,
with no move or cancel action for a scope event. That is a captain decision.

## Screenshots

`shots/performance-stratco-week-1512x1100.png` is the Performance surface.
`shots/booking-stratco-week-grid-1512x1250.png` is the Booking week grid with
the breaches, the missing Friday slot, both zero-travel seams and the
unreachable protected band in place.
`shots/booking-stratco-week-flags-1512x1250.png` is the written flags beneath
that grid, each naming its full event id.

Captured with `chrome-devtools-axi` against
`node scripts/fencing-stratco-week-preview.mjs`. No sign-in, no live Ops read,
no network call to a provider.

## Reproducing it

```
npm run preview:stratco-week
```

Then open the two links it prints. Nothing needs a credential.

## What did not happen

Calendar writes 0. SMS sent 0. Customer contact none. No production deploy, no
merge, no backend change. This lane is read only.
