# Clear Debt: the debt desk screen

Ops > Financials > Clear Debt. `modules/ops-clear-debt-desk.js` owns the header, the tab bar and the Today, Promises, Jan and Deposits tabs. `modules/ops-clear-debt-v2.js` still owns the Debt book tab: the bar, the payer groups and the payer record. Plan: backend `docs/debt-book/PLAN.md` sections 5 and 6 steps 4 and 5 (the actions behind drafts, outcomes and Jan's text: backend `docs/debt-book/DESK-API.md`). The captain's rulings are in `DECISIONS.md` in the same folder.

## What the screen shows

**Header.** The big number is **Overdue**: all debt whose due date is before today's Perth date, holds included, so it always matches Xero. A smaller line under it says how much of that is on hold. Beside it sit: debt by the captain's definition, open in Xero, not debt, **check first** and **fix first** as separate figures, and waiting for Shaun (drafts not yet approved or skipped). A stamp says **Matches Xero, read HH:MM** or **Differs by $X on N invoices**: the backend's own `copy_check.stamp` words when sent, else the same words built from the check. When `debt_book` says Xero changed during the read (`read_warning`), the header says so under the stamp. Waiting for Shaun reads "no drafts written yet" while no item carries a draft (plan step 2 sends none). Ages and "today" come from the backend's `perth_date` when it is sent, so the screen and the rules count the same day. "Texts waiting for Marnin" is gone.

**Tabs.** Today (first, the default) | Debt book | Promises | Jan | Deposits. The last tab picked is kept per browser in `localStorage.sw_cd_tab`.

- **Today** is the morning list in this order: broken promises, Jan's morning text, Jan visits, calls, texts, builder statements, deposit reminders. Inside a group, bigger amounts come first, then older. The backend's own hold items (`group: "hold"`, `step: null`) and any item carrying a `hold` are held payers: (check first, fix first) they come last in their own **On hold, no draft** section with their reason, and their "Fix first: ..." step label is not repeated as a chip: never drafted (even if the backend sends a draft), never tickable, never counted in waiting for Shaun, never approved, and nothing to press: a held card is information only. Ticks and edits are cleared whenever the list is read again, and only a draft still pending on the list on screen can be approved or skipped. Below the list, **Sent today** (`sent_today`, shown only when something went out today) lists each text sent today with its time, who it went to, the invoices and who sent it: once sent, a payer leaves the list, so this is where it shows; Jan's text reads **Jan's morning text**. One line under the list names what it is not showing: payers paused on a promise (`paused`), payers waiting for a later chase or a due date (`waiting`), invoices never chased (`not_chased`), and the next builder statement day (`next_statement_date`, or today when `is_statement_day`).
- **The line at the top of Today** says what there is to do, counted from the list (`ClearDebtDeskCore.todaySummary`), e.g. "2 texts to approve, 2 calls to make, Jan's text to approve (1 visit), 1 builder statement to approve. 3 on hold, just so you know." Jan's text counts once, however many visits it lists; one that cannot be approved reads "Jan's text cannot be approved yet". A text step drafted as an email counts as an email ("1 email to approve"), matching its **Approve email** button. Cards with no draft yet are counted as "waiting for a draft, nothing to do yet". While sending is off a second line says **Sending is off until Shaun says go - approving now just queues them.**
- **One button per card.** Each Today and Jan card shows one obvious button for its step (`ClearDebtDeskCore.cardAction`, by `step`, else `group`):

  | Step | Button | Around it |
  |---|---|---|
  | `friendly_text`, `firm_text` | **Approve text** (Approve email for an email draft) | The drafted message shown above it; **Edit** (opens it for typing) and **Skip** as small links |
  | `call`, `builder_call` | **Call now** (a `tel:` link to the item's `phone`) | The call script, if sent, as "What to say on the call"; then **What happened?** opening the choices below. No phone: says so, no button |
  | `jan_visit` | None: reads **In Jan's text**, with the text's status | What Jan reports, behind Log what happened |
  | Jan's morning text (`jan_text`) | **Approve Jan's text** | Jan's mobile, the numbered visits, the text; Edit and Skip |
  | `deposit_reminder` | **Approve reminder** | The reminder above it; Edit and Skip |
  | `statement` | **Approve statement** | The statement above it; Edit and Skip |

  A step whose draft has not arrived (step 2 sends none) says **Draft coming - nothing to do yet** and has no button; a call needs no draft. A draft already approved, skipped or sent shows its words and its status, no button. A call script is help for the call, not a message, so it is never approved, ticked or counted in waiting for Shaun. Texts, Jan's text, deposit reminders and statements can be ticked for **Approve ticked**. A Jan visit listed in `jan_text.visits` (by `item_id`) reads "In Jan's text" instead of "Draft coming". A Jan visit that today's Jan text does not list (it joined the list after the text was drafted or sent) reads **Not in today's text to Jan - goes on tomorrow's**, has no button and is not counted as waiting for a draft. Without a Jan text it falls back to the rules above.
- **Jan's morning text** (`jan_text`, plan step 5) is one card, shown on Today where the Jan visits start and first on the Jan tab: who it goes to (Jan's mobile from `to_phone`, shown as 0411 222 333, or "Jan's mobile not set"), the visits it lists (payer, site, invoices, amount, days overdue, a broken promise marked), the text, and **Approve Jan's text**. Approve and skip post `debt_draft_decide` with `jan_text.xero_invoice_ids` in their order; an approval (an edit included) also sends `template_text` set to `jan_text.template_text`, and a skip never does. When `approvable` is false the card shows **Cannot approve yet.** with the backend's `problem` verbatim (e.g. "Jan's mobile not set: ..."), a disabled Approve with no handler, no tick and no Edit; Skip still works, and the screen refuses the approve itself too. Approved reads "Queued until sending is switched on", with the last failed try's reason if any; `sending` reads "Sending not confirmed: <reason>. It will not be sent again today."; `sent` reads "Sent HH:MM.".
- **Sending is off everywhere on this screen** until the old automatic money texts are switched off and Shaun says start sending. The desk drafts' send button and the Debt book payer record's Send text and Send invoice email buttons are all disabled, carry no handler and read **Sending off until Shaun says go**; the payer record's send functions refuse too. One switch, `ClearDebtDeskCore.SENDING_ON`, turns them on in a later reviewed PR. Add note and the outcome buttons still work.
- **Debt book** holds the existing bar and payer groups (our copy, `list_debt_picture`) and, when the live book is read, the debt split by payer and by age.
- **Promises** lists promises to pay from the morning list: broken ones ride on their item, open ones come from `paused[]` with the day chasing resumes. Broken first, then open, then kept. A promise with no amount says so.
- **Jan** shows Jan's morning text first, then lists the payers at the day-7 Jan visit step (`step: jan_visit`, in any group, so a broken promise due a Jan visit is on it too), then below them any held payer whose `held_step` is `jan_visit`, with their reason and no draft.
- **Deposits** lists a client's unpaid deposits and other before-work invoices from the live book: `payer: "client"`, not debt, and `kind: "deposit"` or `not_debt_reason: "before_first_payment"` (the backend's own deposit rule). Those the morning list names in `not_chased` (matched by invoice number: late-made deposits matching a transfer already received, a likely duplicate, leftover cents) are left out of the total and the 60-day pill and shown apart below the table with the list's reason. When the morning list is not read, nothing can be set apart, so the tab says the total may include those invoices and hides the 60-day pills until it is read. They are not debt.

**What happened.** Every Today item that is not held, and the Debt book payer record, carry the outcome buttons (No answer, Spoke, Promised, Disputed, Says paid) and a note, folded away behind a small **Log what happened** link (on a call card, the **What happened?** button). The promise box ($ amount and a date, with Save promise) appears only after Promised is pressed. Promised needs both. A typed amount, date and note are kept while other cards are edited or decided, and cleared once logged. A Jan visit card offers what Jan reports instead: the list's `schedule.jan_visit_outcomes` (Visited: paid, Visited: promised, No one home, Visited: disputed; the same four when it is not sent, and never a code the screen does not know), logged with `channel: "visit"` and `schedule_step: "jan_visit"`. "Last time" uses the item's `last_outcome.label` (Jan's words for a Jan visit) when sent; without a label it uses the plain call words (No answer, Spoke, ...), never Jan's words from the card's current step. The screen never shows the words payer, step or outcome code. An outcome carries a `schedule_step` only when the card's step is one a person carries out when pressing it: `call`, `builder_call` or `jan_visit`. Text, statement and deposit-reminder cards, and the Debt book payer record, log the outcome with `schedule_step: null`, so a call outcome never marks an unsent text or statement as done; the send itself stamps those steps. An outcome is logged against the card's Xero invoice ids with the morning list's `payer_key`; the Debt book payer record looks that key up from the list by invoice id, so MLB logs as `mlb`, not a contact id.

**Display rules (B17).** Ages count Perth calendar days, never UTC. An invoice with no due date sits in its own **No due date** bucket, never "not due" and never 90+. "Refreshed" shows the newest stamp. Overdue counts debt only: deposits, not owed and set-aside invoices never inflate it.

## Layout B for Today (live)

The captain picked layout B for the Today tab, and it is now what staff see: `CDD_LAYOUT_B_LIVE = true` in `modules/ops-clear-debt-desk.js`, so the normal Clear Debt tab shows it and the preview banner no longer appears. Before that it opened only at **`ops.html?view=clear-debt-preview`** (same login, real data), which goes straight to Financials > Clear Debt with a banner reading **PREVIEW - not what staff see.** The banner also says the buttons there are real: approving queues the text and logging saves it, exactly as on the live tab. That link (`window.__SW_CLEAR_DEBT_PREVIEW`, set at the top of `ops.html` and routed in `restoreTab`) still works and now opens layout B with no banner. The older Today morning list described above is no longer shown, but its code stays until removed. Only Today changes; the header, the tabs and the other tabs are the same.

**Still to do** now it is live: remove the older Today code (`cddTodayHtml`, `cddTodoHtml`, `cddSentTodayHtml`, `cddJanTextBlock`), the preview flag and route, and fold this section into "What the screen shows".

In layout B, Today has four parts:

- **To do today** is a bold dark bar under the tabs with one chip per kind of work, counted from the list (`ClearDebtDeskCore.todoChips`): e.g. **2** texts to approve, **2** calls to make, **1** Jan's text to approve, **1** builder statement to approve, then "6 waiting for a draft · 3 on hold" in small type. Jan's text counts once; one that cannot be approved reads "Jan's text cannot be approved yet" with no number. Pressing a chip opens the first row of that kind still to do. **Next to do** opens the next unfinished row after the one picked, in menu order, wrapping round (`ClearDebtDeskCore.nextTodo`): a pending draft that needs a decision, Jan's text while it can be approved, or a call not yet logged on this screen. When no other row is unfinished (even if the open one still is) it reads **All done for now** and is disabled. The bar's accessible name is the live tab's sentence (`todaySummary`). A line under the bar says when the list was built and, while sending is off, **Sending is off until Shaun says go - approving now just queues them.**
- **The left menu** lists the sections with how many rows each holds (`ClearDebtDeskCore.todaySections`): Broken promises, Jan visits, Calls, Texts, Builder statements, Deposit reminders, then below a line **On hold** and **Done today**. Items sit in the section of their `group`; a group the screen does not know goes under **Other** (shown only when it has rows), never dropped. On first open it is the first section with something to do, else the first with rows. On a narrow screen the menu is a select and the panel stacks under the table.
- **The table** is one line per payer, in the live order: customer (with the step and a one-word status: Approved, queued; Skipped; Draft coming; In Jan's text; Logged: ...), invoice(s), the overdue pill, last contact (`last_outcome`), owing; Broken promises, Texts, Builder statements and Deposit reminders also show the start of the message. Click a row (or Up/Down and Enter) to open it. Rows that can be approved carry a tick; ticks are kept across sections for **Approve ticked** in the table bar, beside the disabled send button. Jan's morning text is the first row of Jan visits. **On hold** shows the reason in place of last contact and has nothing to press. **Done today** lists `sent_today` (Jan's text reads **Jan's morning text**).
- **The detail panel** holds the row in full, with the same one button per step as the live cards (the table above), Edit and Skip, **What happened?** laid open (**What did Jan report?** on a Jan visit; the promise box still opens only on Promised), and a **History** line from `last_outcome` ("History: nothing logged yet." when there is none). A call logged there counts as done for Next to do and its row says what was logged.

Every action, rule and refusal is the live one: the same `debt_draft_decide` bodies (Jan's text with `template_text` on approval), the same `debt_log_outcome` steps, held payers never drafted or approved, and sending off.

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
    "last_outcome": { "code": "no_answer", "label": "No answer (Jan's words on a Jan visit)", "at": "iso", "by": "Shaun" },
    "draft": "null in step 2 and on Jan visits (step 5); step 3: { id, channel: sms | email | call_script, text, status: pending | approved | skipped | sending | sent, approved_by, last_send }"
  }],
  "jan_text": "null when no Jan visits; else { id, to: 'jan', to_phone: '+614... or null', visits: [{ item_id, payer_name, site, invoice_numbers, xero_invoice_ids, amount, days_overdue, broken_promise }], xero_invoice_ids, text, template_text, status, approved_by, decided_at, last_send, approvable, problem }",
  "sent_today": [{ "draft_id": "...", "to": "client | jan", "payer_name": "Name (Jan for Jan's text)", "invoice_numbers": ["INV-1"], "step": "friendly_text | jan_text | ...", "text": "...", "at": "iso", "by": "Shaun" }],
  "paused": [{ "payer_key": "...", "payer_name": "Name", "payer": "client", "invoices": [], "amount": 2150.0, "promise": { "amount": null, "date": "2026-10-03", "status": "open" }, "resumes_on": "2026-10-04" }],
  "waiting": [{ "payer_key": "...", "payer_name": "Name", "invoice_numbers": ["INV-1"], "reason": "not_due | no_due_date | done_today | next_step_later | statement_not_due | reminder_sent", "next_step": null, "next_date": null }],
  "not_chased": [{ "invoice_number": "INV-1050", "payer_name": "ML Builders", "reason": "..." }],
  "summary": {}, "book": {}, "schedule": { "jan_visit_outcomes": [{ "code": "no_answer", "label": "No one home" }] }
}
```

`debt_draft_decide` (POST, step 3): `{ draft_id, decision: "approve" | "skip", text, xero_invoice_ids }`, answered `{ ok, draft }`. The approval records the signed-in user. For Jan's text, `xero_invoice_ids` is `jan_text.xero_invoice_ids` in its order, and an approval adds `template_text` (`jan_text.template_text`); the backend refuses an approval without it (`409 debt_draft_invoices_changed`).

`debt_log_outcome` (POST, steps 3 and 5): `{ payer_key, xero_invoice_ids, outcome_code: "no_answer" | "spoke" | "promised" | "disputed" | "says_paid", promised_amount, promised_date, note, channel: "call" | "visit", schedule_step: "call | builder_call | jan_visit | null" }`, answered `{ ok, logged }`. The outcome codes match the backend's `DEBT_CHASE_OUTCOMES`, and the morning list reads them back from `payment_chase_logs` (`outcome_code`, `schedule_step`, `promised_amount`, `promised_date`).

There is no separate promises read: the Promises tab is built from the morning list.

## Guards

`npm run test:clear-debt-desk` (pure rules, in `test:e2e`), `npm run test:clear-debt-v2`, the browser spec `tests/e2e/ops-clear-debt-desk.spec.js` (the live tab, which also checks it shows no preview), and `tests/e2e/ops-clear-debt-preview.spec.js` (layout B at the preview link; screenshots in `docs/evidence/clear-debt-desk-layout-b-preview-2026-10-01/`). Fixture: `tests/fixtures/clear-debt-desk.js` (made-up names). Screenshots: `CLEAR_DEBT_EVIDENCE_DIR=docs/evidence/<folder> npx playwright test tests/e2e/ops-clear-debt-desk.spec.js` (latest: `docs/evidence/clear-debt-desk-jan-text-2026-10-01/`; the rest of the desk in `docs/evidence/clear-debt-desk-one-button-2026-10-01/`).
