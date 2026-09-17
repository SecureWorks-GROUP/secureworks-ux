# Booking door live fix — 17 Sep 2026

Before (live Pages at 12:55 Perth): Approvals (Council / MakeSafe Intake) sat above
Sales, the door stayed on "Reading the provider calendar…" / "Source not retrieved",
and every tile and the work queue read 0.

| Shot | What it shows |
|---|---|
| `after-loading.png` | Approvals gone. Progress state while the read runs. No fake empty week. |
| `after-nithin.png` | Patio stages from the wiki profile. Quoted work folded. Calendar paints. |
| `after-marnin-calendar-403.png` | Failed Outlook read shows "Calendar not connected". Queue and tiles still non-zero. Coverage gaps verbatim. |

Browser: chrome-devtools-axi against `scripts/sales-booking-preview.mjs` on this branch.
The live `sales_booking_read` shape (1010 cases, 80 thread facts, `diary_read.read_ok:false`)
is covered by `modules/ops-sales-booking.test.cjs`.
