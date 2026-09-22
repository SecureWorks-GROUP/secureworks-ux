# Booking confirmation and visit outcome evidence

HISTORICAL SNAPSHOT — 2026-09-21 UI/fake-boundary capture. Current visit-outcome actions, receipts and note rules: [booking-confirm-contract.md](../../booking-confirm-contract.md). Later offline contract-fix evidence: [booking-screen-contract-fix-2026-09-22](../booking-screen-contract-fix-2026-09-22/).

Verified with `chrome-devtools-axi`, using `tests/fixtures/booking-confirm/index.html` on a local Python server. Synthetic contacts, calendar IDs, phone numbers and addresses only. CSP forbids network connections. Every write went to the fixture's fake `opsPost`; no provider, production API, send or deployment was called.

- [Desktop, 1512px](desktop.png): proposal and arrival window on the week, quoted evidence/checks, locked template, separate confirmations, offered/agreed occupancy and amber missing-outcome list.
- [Phone, 390px](phone.png): selected enquiry, exact operation and separate confirmations. Measured `innerWidth=390`, document `scrollWidth=390`.
- [Phone text approved](phone-text-approved.png): independently approved template with the send hold stated.
- [Phone visit reason](phone-visit-outcome.png): Did not happen opens the three reasons, one further tap records it. This capture used a recent Friday; the final fixture derives yesterday so it stays recent on every run.
- [Unread calendar](desktop-failed-calendar.png): no calendar columns, both confirmation buttons disabled. [Failed read](failed-calendar.txt) and [not configured](not-configured-calendar.txt) each recorded zero writes.
- [Separate click trace](fake-clicks.txt): calendar click left message awaiting approval; another click recorded the message step. No combined stamp, provider booking or SMS action appears.
- [Visit outcome trace](fake-visit-outcome.txt): this capture's fake wrote one `sales_booking_visit_outcome_insert` (retired name; current action is `record_visit_outcome`). Did not happen plus Customer not home, no quote obligation and no customer message. Happened independently defaulted `quote_owed=true`, `reason=null`; the amber item disappeared only after the fake echoed the record.

Validation: `npm run test:sales-booking` and `node scripts/test-ops-asset-cache-bust.js`; module syntax and `git diff --check`. Browser console had no errors on the final fixture. The Impeccable detector reported no findings for the booking JS/CSS.

The tests cover separate writes, exact text bytes, stale content/revision rejection, expiry, double clicks, absent/failed calendars, protected bands, prior holds, producer receipt states, profile defaults, GHL contact/opportunity/event diary matching, the calm disconnected visit-outcomes line, a verified insert after `load()` replaces state, append-only corrections, quote unticking, required reasons, note limits and unconfirmed outcome writes. Historical booking fixtures use an explicit historical test clock; new fixtures derive dates from the current Perth week.

Current read/write fields and outcome actions: [booking-confirm-contract.md](../../booking-confirm-contract.md). These screenshots prove the 2026-09-21 UI and fake boundary only.
