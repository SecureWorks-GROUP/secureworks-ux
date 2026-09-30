# Clear Debt: the debt desk screen

Ops > Financials > Clear Debt. `modules/ops-clear-debt-desk.js` owns the header, the tab bar and the Today, Promises, Jan and Deposits tabs. `modules/ops-clear-debt-v2.js` still owns the Debt book tab: the bar, the payer groups and the payer record. Plan: backend `docs/debt-book/PLAN.md` sections 5 and 6 step 4. The captain's rulings are in `DECISIONS.md` in the same folder.

## What the screen shows

**Header.** The big number is **Overdue**: all debt whose due date is before today's Perth date, holds included, so it always matches Xero. A smaller line under it says how much of that is on hold. Beside it sit: debt by the captain's definition, open in Xero, not debt, **check first** and **fix first** as separate figures, and waiting for Shaun (drafts not yet approved or skipped). A stamp says **Matches Xero, read HH:MM** or **Differs by $X on N invoices**: the backend's own `copy_check.stamp` words when sent, else the same words built from the check. When `debt_book` says Xero changed during the read (`read_warning`), the header says so under the stamp. Waiting for Shaun reads "no drafts written yet" while no item carries a draft (plan step 2 sends none). Ages and "today" come from the backend's `perth_date` when it is sent, so the screen and the rules count the same day. "Texts waiting for Marnin" is gone.

**Tabs.** Today (first, the default) | Debt book | Promises | Jan | Deposits. The last tab picked is kept per browser in `localStorage.sw_cd_tab`.

- **Today** is the morning list in this order: broken promises, Jan visits, calls, texts, builder statements, deposit reminders. Inside a group, bigger amounts come first, then older. The backend's own hold items (`group: "hold"`, `step: null`) and any item carrying a `hold` are held payers: (check first, fix first) they come last in their own **On hold, no draft** section with their reason, and their "Fix first: ..." step label is not repeated as a chip: never drafted (even if the backend sends a draft), never tickable, never counted in waiting for Shaun, never approved. Each chaseable draft can be edited, approved or skipped, singly or as a ticked batch. Ticks and edits are cleared whenever the list is read again, and only a draft still pending on the list on screen can be approved or skipped. One line under the list names what it is not showing: payers paused on a promise (`paused`), payers waiting for a later step or a due date (`waiting`), invoices never chased (`not_chased`), and the next builder statement day (`next_statement_date`, or today when `is_statement_day`).
- **Sending is off everywhere on this screen** until the old automatic money texts are switched off and Shaun says start sending. The desk drafts' send button and the Debt book payer record's Send text and Send invoice email buttons are all disabled, carry no handler and read **Sending off until Shaun says go**; the payer record's send functions refuse too. One switch, `ClearDebtDeskCore.SENDING_ON`, turns them on in a later reviewed PR. Add note and the outcome buttons still work.
- **Debt book** holds the existing bar and payer groups (our copy, `list_debt_picture`) and, when the live book is read, the debt split by payer and by age.
- **Promises** lists promises to pay from the morning list: broken ones ride on their item, open ones come from `paused[]` with the day chasing resumes. Broken first, then open, then kept. A promise with no amount says so.
- **Jan** lists the payers at the day-7 Jan visit step (`step: jan_visit`, in any group, so a broken promise due a Jan visit is on it too), then below them any held payer whose `held_step` is `jan_visit`, with their reason and no draft.
- **Deposits** lists a client's unpaid deposits and other before-work invoices from the live book: `payer: "client"`, not debt, and `kind: "deposit"` or `not_debt_reason: "before_first_payment"` (the backend's own deposit rule). Those the morning list names in `not_chased` (matched by invoice number: late-made deposits matching a transfer already received, a likely duplicate, leftover cents) are left out of the total and the 60-day pill and shown apart below the table with the list's reason. When the morning list is not read, nothing can be set apart, so the tab says the total may include those invoices and hides the 60-day pills until it is read. They are not debt.

**Payer card.** Every Today item and the Debt book payer record carry the outcome buttons (No answer, Spoke, Promised, Disputed, Says paid) and a promise box ($ amount and a date). Promised needs both. An outcome carries a `schedule_step` only when the card's step is one a person carries out when pressing it: `call`, `builder_call` or `jan_visit`. Text, statement and deposit-reminder cards, and the Debt book payer record, log the outcome with `schedule_step: null`, so a call outcome never marks an unsent text or statement as done; the send itself stamps those steps. An outcome is logged against the card's Xero invoice ids with the morning list's `payer_key`; the Debt book payer record looks that key up from the list by invoice id, so MLB logs as `mlb`, not a contact id.

**Display rules (B17).** Ages count Perth calendar days, never UTC. An invoice with no due date sits in its own **No due date** bucket, never "not due" and never 90+. "Refreshed" shows the newest stamp. Overdue counts debt only: deposits, not owed and set-aside invoices never inflate it.

## Backend actions the screen reads

The shapes below are the backend as built: `debt_book` on `fm/debt-reader-1` (backend PR 943) and `debt_morning_list` on `fm/debt-morning-list-2`. Only the fields the screen reads are listed; the rest are ignored. Until an action is deployed, ops-api answers `Unknown action` and the tab says plainly that the part is not live yet. It never shows a guessed number.

`debt_book` (GET, plan step 1):

```json
{
  "ok": true, "version": "debt-book/v1",
  "read_at": "2026-10-01T07:02:11+08:00", "perth_date": "2026-10-01",
  "read_stable": true, "read_warning": null,
  "copy_check": { "matches": false, "differs_by": 3583.48, "invoice_count": 6, "stamp": "Differs by $3,583.48 on 6 invoices" },
  "summary": {},
  "invoices": [{
    "xero_invoice_id": "uuid", "invoice_number": "INV-1578", "reference": "SWP-26401-FINBAL",
    "contact_id": "uuid", "contact_name": "Client name",
    "payer": "client | mlb | aj | other_builder | not_chased",
    "kind": "final | variation | part_payment | progress_claim | materials | builder | deposit | plan_fee | unclear | ...",
    "is_debt": true, "reason": "Final invoice on a complete job", "not_debt_reason": "null | before_first_payment | ...",
    "hold": "null | check_first | fix_first", "hold_reason": "Builder rejected",
    "invoice_date": "2026-09-10", "due_date": "2026-09-24 or null",
    "total": 4200.0, "amount_due": 4200.0,
    "job_id": "uuid", "job_number": "SWP-26401", "job_status": "complete"
  }]
}
```

The header is summed from `invoices[]` by the screen, so every figure follows the same Perth-date and hold rules.

`debt_morning_list` (GET, plan step 2; drafts arrive with step 3):

```json
{
  "ok": true, "version": "debt-morning/v1",
  "generated_at": "2026-10-01T07:05:00+08:00", "perth_date": "2026-10-01",
  "is_statement_day": false, "next_statement_date": "2026-10-05",
  "items": [{
    "id": "2026-10-01:<payer_key>:<group>:<step>  (a hold adds :<invoice numbers>)",
    "payer_key": "clients: Xero contact id; builders: mlb | aj | other_builder:<label>",
    "payer_name": "Name", "payer": "client",
    "group": "broken_promise | jan | call | text | statement | deposit_reminder | hold",
    "step": "friendly_text | firm_text | call | jan_visit | statement | builder_call | deposit_reminder | null (holds)",
    "held_step": "holds only: the step the payer would be on (jan_visit puts the hold on the Jan tab too)",
    "step_label": "Day 2: firm text with the pay link  (holds: 'Check first: <reason>')",
    "amount": 4200.0, "days_overdue": 2,
    "invoices": [{ "xero_invoice_id": "uuid", "invoice_number": "INV-1578", "amount_due": 4200.0, "due_date": "2026-09-29", "invoice_date": "2026-09-15", "days_overdue": 2 }],
    "hold": "null | check_first | fix_first", "hold_reason": null, "phone": "04..", "email": "a@b",
    "promise": { "amount": 1000, "date": "2026-10-03", "status": "broken | kept" },
    "last_outcome": { "code": "no_answer", "at": "iso", "by": "Shaun" },
    "draft": "null in step 2; step 3: { id, channel: sms | email | call_script, text, status: pending | approved | skipped | sent }"
  }],
  "paused": [{ "payer_key": "...", "payer_name": "Name", "payer": "client", "invoices": [], "amount": 2150.0, "promise": { "amount": null, "date": "2026-10-03", "status": "open" }, "resumes_on": "2026-10-04" }],
  "waiting": [{ "payer_key": "...", "payer_name": "Name", "invoice_numbers": ["INV-1"], "reason": "not_due | no_due_date | done_today | next_step_later | statement_not_due | reminder_sent", "next_step": null, "next_date": null }],
  "not_chased": [{ "invoice_number": "INV-1050", "payer_name": "ML Builders", "reason": "..." }],
  "summary": {}, "book": {}, "schedule": {}
}
```

`debt_draft_decide` (POST, step 3, not built yet): `{ draft_id, decision: "approve" | "skip", text, xero_invoice_ids }`, answered `{ ok, draft }`. The approval records the signed-in user.

`debt_log_outcome` (POST, steps 3 and 5, not built yet): `{ payer_key, xero_invoice_ids, outcome_code: "no_answer" | "spoke" | "promised" | "disputed" | "says_paid", promised_amount, promised_date, note, channel: "call", schedule_step: "call | builder_call | jan_visit | null" }`, answered `{ ok, logged }`. The outcome codes match the backend's `DEBT_CHASE_OUTCOMES`, and the morning list reads them back from `payment_chase_logs` (`outcome_code`, `schedule_step`, `promised_amount`, `promised_date`).

There is no separate promises read: the Promises tab is built from the morning list.

## Guards

`npm run test:clear-debt-desk` (pure rules, in `test:e2e`), `npm run test:clear-debt-v2`, and the browser spec `tests/e2e/ops-clear-debt-desk.spec.js`. Fixture: `tests/fixtures/clear-debt-desk.js` (made-up names). Screenshots: `CLEAR_DEBT_EVIDENCE_DIR=docs/evidence/<folder> npx playwright test tests/e2e/ops-clear-debt-desk.spec.js`.
