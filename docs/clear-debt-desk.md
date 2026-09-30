# Clear Debt: the debt desk screen

Ops > Financials > Clear Debt. `modules/ops-clear-debt-desk.js` owns the header, the tab bar and the Today, Promises, Jan and Deposits tabs. `modules/ops-clear-debt-v2.js` still owns the Debt book tab: the bar, the payer groups and the payer record. Plan: backend `docs/debt-book/PLAN.md` sections 5 and 6 step 4. The captain's rulings are in `DECISIONS.md` in the same folder.

## What the screen shows

**Header.** The big number is **Overdue**: all debt whose due date is before today's Perth date, holds included, so it always matches Xero. A smaller line under it says how much of that is on hold. Beside it sit: debt by the captain's definition, open in Xero, not debt, **check first** and **fix first** as separate figures, and waiting for Shaun (drafts not yet approved or skipped). A stamp says **Matches Xero, read HH:MM** or **Differs by $X on N invoices**, from the backend's copy-versus-Xero check. "Texts waiting for Marnin" is gone.

**Tabs.** Today (first, the default) | Debt book | Promises | Jan | Deposits. The last tab picked is kept per browser in `localStorage.sw_cd_tab`.

- **Today** is the morning list in this order: broken promises, Jan visits, calls, texts, builder statements, deposit reminders. Inside a group, bigger amounts come first, then older. Held payers (check first, fix first) come last in their own **On hold, no draft** section with their reason: never drafted (even if the backend sends a draft), never tickable, never counted in waiting for Shaun, never approved. Each chaseable draft can be edited, approved or skipped, singly or as a ticked batch. Ticks and edits are cleared whenever the list is read again, and only a draft still pending on the list on screen can be approved or skipped.
- **Sending is off everywhere on this screen** until the old automatic money texts are switched off and Shaun says start sending. The desk drafts' send button and the Debt book payer record's Send text and Send invoice email buttons are all disabled, carry no handler and read **Sending off until Shaun says go**; the payer record's send functions refuse too. One switch, `ClearDebtDeskCore.SENDING_ON`, turns them on in a later reviewed PR. Add note and the outcome buttons still work.
- **Debt book** holds the existing bar and payer groups (our copy, `list_debt_picture`) and, when the live book is read, the debt split by payer and by age.
- **Promises** lists promises to pay: broken first, then open, then kept.
- **Jan** lists the payers at the day-7 Jan visit step, then any held Jan-step payers below, with their reason and no draft.
- **Deposits** lists unpaid deposits and other before-work invoices from the live book. They are not debt.

**Payer card.** Every Today item and the Debt book payer record carry the outcome buttons (No answer, Spoke, Promised, Disputed, Says paid) and a promise box ($ amount and a date). Promised needs both.

**Display rules (B17).** Ages count Perth calendar days, never UTC. An invoice with no due date sits in its own **No due date** bucket, never "not due" and never 90+. "Refreshed" shows the newest stamp. Overdue counts debt only: deposits, not owed and set-aside invoices never inflate it.

## Backend actions the screen reads

The screen codes against these shapes. Until an action is deployed, ops-api answers `Unknown action` and the tab says plainly that the part is not live yet. It never shows a guessed number.

`debt_book` (GET, plan step 1):

```json
{
  "version": "debt-book/v1",
  "read_at": "2026-10-01T07:02:11+08:00",
  "copy_check": { "matches": false, "differs_by": 3583.48, "invoice_count": 6 },
  "invoices": [{
    "xero_invoice_id": "uuid", "invoice_number": "INV-1578", "reference": "SWP-26401-FINBAL",
    "contact_id": "uuid", "contact_name": "Client name",
    "payer": "client | mlb | aj | other_builder | not_chased",
    "kind": "final | variation | part_payment | progress_claim | materials | builder | deposit | plan_fee | unclear | test",
    "is_debt": true, "reason": "Final invoice on a complete job",
    "hold": "null | check_first | fix_first", "hold_reason": "Builder rejected",
    "invoice_date": "2026-09-10", "due_date": "2026-09-24 or null",
    "total": 4200.0, "amount_due": 4200.0,
    "job_id": "uuid", "job_number": "SWP-26401", "job_status": "complete",
    "online_invoice_url": "optional"
  }]
}
```

The header is summed from `invoices[]` by the screen, so every figure follows the same Perth-date and hold rules.

`debt_morning_list` (GET, plan steps 2 and 3):

```json
{
  "version": "debt-morning/v1",
  "generated_at": "2026-10-01T07:05:00+08:00",
  "items": [{
    "id": "stable item key", "payer_key": "contact id", "payer_name": "Name", "payer": "client",
    "group": "broken_promise | jan | call | text | statement | deposit_reminder",
    "step": "friendly_text | firm_text | call | jan_visit | statement | builder_call | deposit_reminder",
    "step_label": "Day 2: firm text with the pay link",
    "amount": 4200.0, "days_overdue": 2,
    "invoices": [{ "xero_invoice_id": "uuid", "invoice_number": "INV-1578", "amount_due": 4200.0, "due_date": "2026-09-29" }],
    "hold": null, "hold_reason": null, "phone": "04..", "email": "a@b",
    "promise": { "amount": 1000, "date": "2026-10-03", "status": "open | broken | kept" },
    "last_outcome": { "code": "no_answer", "at": "iso", "by": "Shaun" },
    "draft": { "id": "uuid", "channel": "sms | email | call_script", "text": "...", "status": "pending | approved | skipped | sent" }
  }]
}
```

`debt_draft_decide` (POST, step 3): `{ draft_id, decision: "approve" | "skip", text }`, answered `{ ok, draft }`. The approval records the signed-in user.

`debt_log_outcome` (POST, steps 3 and 5): `{ payer_key, xero_invoice_ids, outcome_code: "no_answer" | "spoke" | "promised" | "disputed" | "says_paid", promised_amount, promised_date, note, channel: "call", schedule_step }`, answered `{ ok, logged }`.

`debt_promises` (GET, step 5): `{ promises: [{ payer_key, payer_name, invoice_numbers, promised_amount, promised_date, status, logged_at, logged_by }] }`. Until it is deployed the tab lists the promises the morning list carries.

## Guards

`npm run test:clear-debt-desk` (pure rules, in `test:e2e`), `npm run test:clear-debt-v2`, and the browser spec `tests/e2e/ops-clear-debt-desk.spec.js`. Fixture: `tests/fixtures/clear-debt-desk.js` (made-up names). Screenshots: `CLEAR_DEBT_EVIDENCE_DIR=docs/evidence/<folder> npx playwright test tests/e2e/ops-clear-debt-desk.spec.js`.
