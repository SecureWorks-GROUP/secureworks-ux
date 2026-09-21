# Sales Booking view

Ops > Sales > Booking (`ops.html#booking`) loads the live `modules/ops-sales-booking.js` and `.css` via `opsWriteModuleAssets`. The calendar defaults to the current Perth week and the signed-in scoper UUID; unmatched accounts choose explicitly. Previous-week navigation cannot enter a past week.

Each lead shows its AI booking proposal, quoted customer evidence, locked template and validation checks. Uncertain proposals say Needs a person and give the reason. GHL calendar read errors and configuration gaps never paint free capacity. Prior offers and agreements reserve time by contact ID, with no name/suburb identity fallback.

The old Send message / KEEP stamp write has been retired from this screen. **Confirm calendar booking** and **Approve this exact text** are separate content-bound approvals, with independent refusal reasons and receipts. Text approval remains recordable during send hold, with a plain statement that nothing will be sent. The GHL approval contract is Stratco-only; other providers are not introduced here. All new write paths require an explicit backend capability and fail closed while unimplemented.

Booked visits support Happened or Did not happen, with one of three reasons for the latter. Quote owed defaults on for Happened and can be unticked. The last seven days' missing outcomes appear in an amber list. Corrections append a superseding record; recording sends no message.

[Adapter and required backend fields](booking-confirm-contract.md) is the implementation handoff. [Offline fixture](../tests/fixtures/booking-confirm/index.html) supplies fake writes and no network access. Behavioral guards: `npm run test:sales-booking`; asset loader check: `node scripts/test-ops-asset-cache-bust.js`.

Existing queue/pipeline stage grouping, folded quoted/archive rows, calendar layers, occupancy drawing, request-generation protection and cached-read warnings remain in the booking module. Move-stage controls stay held. Historical legacy pack reads can remain visible, but they cannot confer new approval authority.
