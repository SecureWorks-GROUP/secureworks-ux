# Debt Workshop: the Debt tab

Ops > **Debt** (`#viewDebt`). Module: `modules/ops-debt-workshop.js`, loaded at the end of `ops.html` through `__swOpsStampAssets`. Build contract: secureworks-wiki `coding/capabilities/debt-follow-up/debt-workshop-spec.md` (section 9 is this screen; sections 3, 4 and 8 give the data, the categories and the action shapes). The approved look is the local Lavish plan `debt-collection-fresh/.lavish/debt-workshop-build-plan.html`, sections 4 and 5. Where the two disagree, the contract wins.

The old Clear Debt screens (`ops-clear-debt-desk.js`, `ops-clear-debt-v2.js`) are untouched. A separate stage 6 PR removes them.

## When the tab shows

The Debt buttons (header and mobile nav, `data-debt-nav`) start hidden. They show when any of these is true:

- the URL has `?debt=1`;
- `localStorage.sw_debt_ws === '1'`;
- `debt_ws_overview` says `settings.tab_visible`.

`initApp` calls `debtWsProbeVisibility()` once after login. That is a quiet overview read. A failed read (not deployed yet, no access) leaves the tab hidden. `restoreTab` accepts `#debt`.

## W1: the overview

- **Header:** the read time, a "Sending off / Sending on" chip (from `settings.sending_on`), "Agent on" when it is, and the job type filters: All jobs, Fencing, Patio, Insurance.
- **Donut and legend:** the five categories (Active, Escalating, Bad debt, Says paid, Rectification), sized by amount.
  - The totals are summed from the same items the list shows (`DebtWorkshopCore.items` and `totals`), so the donut always matches the list for the chosen filter.
  - Clicking a segment or a legend row picks the list. The first category with money in it is picked to start.
  - Invoices that are not due yet (no category) are never in the donut.
- **The list:** one row per homeowner invoice, with:
  - the payer label, with "(neighbour of X)" in quieter type;
  - the job type badge and the invoice number;
  - the kind, the job number, and "no GHL contact" when it applies;
  - a small "N notices" marker when `flag_count > 0`;
  - the day (or "not due yet") and the amount;
  - the next step, in orange when a draft is ready: a due step that is not day 21, or a pending suggestion.
- **Row order:** ready drafts first, then the oldest, then the biggest. Companies are one row each. On All jobs, clicking a company opens its statement preview. Account-lane invoice rows only show alone when the backend sends no `companies[]`.
- **Insurance:** shows company statement rows (all companies, the biggest past due first; a legend click narrows them to one category).
  - Each row has the statement status, **Preview** (the statement HTML in a sandboxed frame inside a modal, with the To address and the total) and **Approve** (`debt_ws_statement_send {company_key}`).
  - Approve is disabled with its reason shown: Sending is off until you switch it on, No accounts email set, Sent this week, Nothing past due, Only an owner can approve.
  - When the backend refuses a statement as `possible_payment`, the row (and the preview's footer) lists each invoice with the payment that may match, and offers **Send anyway** (owner only), which posts `debt_ws_statement_send {company_key, override_possible_payment: true}`.
- **Bad debt** (not on Insurance) shows **Jan's visit list** above the list (`debt_ws_jan_list`):
  - the visit date, how many people, and the status in words (open, locked, sending, sent, failed, skipped);
  - each person's address, phone, amount and history line;
  - **Remove** (`debt_ws_jan_list_remove {share_key}`), owner only. It works while the list is open or locked (a removal edits the locked copy Jan gets). It is disabled once the list is sending or sent ("The list has gone to Jan"), or failed or skipped, which the backend refuses as `jan_list_closed`.
- **Footer:**
  - Paid this week (opens a list);
  - Needs a look with its count (opens a list with the reasons);
  - Not chased (opens a list);
  - Not due yet, greyed (opens the not-due rows when the overview sends them).

## W2: the job screen

Clicking a row opens the job inside the view. **Back to <category>** returns to the same list. **Next** steps through the homeowner rows of that list ("2 of 5"). The screen reads `debt_ws_job {xero_invoice_id}`.

- **Status strip:**
  - the payer (with the neighbour part), the job type badge, and the category pill with its day. A paid invoice (`row.open === false`) reads **Paid** in green;
  - **Change** beside the pill, a small quiet menu (owner only; disabled for staff, hidden once paid). It sets or clears a category by hand, with or without the agent: **Says paid**, **Clear says paid** (when it is set), and **Move to Rectification**, which first asks "This moves the job card to Rectification". Each posts `debt_ws_set_category {xero_invoice_id, category}` with no `suggestion_id` (`category` is `says_paid`, `rectification` or `clear`);
  - the site, job number and invoice line;
  - on a shared fence, one quiet line from `job.shares[]`, the payer's share first: "Shared fence: Peter (B) owes $1,420.37 · Ashlea (A) paid". A job with one share shows nothing;
  - "Follow-ups paused until ..." while a promise holds (the promised date is still ahead: `paused_until > today`, as the backend counts it);
  - the amount owing, big.
- **Ladder:** the invoice, then `ladder[]`: done (green tick), due (orange, "ready now"), upcoming (date), skipped, not needed. On a phone it scrolls sideways, with the due step brought into view.
- **Left column:**
  - the job story in a few plain lines from `story`: `now.line`, `now.next`, `now.blockers`, and the last four `timeline` entries;
  - a money box: job value from `story.money.job_value`, each invoice paid or owing, and the total owing;
  - documents and invoices. An invoice opens through `get_invoice_pdf`; a document opens through `debt_ws_document {job_id, document_id}`. Each opens in a modal from a blob URL: PDFs in a frame, images inline, anything else as a download.
- **Middle column.** Everything here is about the **payer** (`payer_contact`): the person who owes THIS invoice. On a shared fence that is the neighbour, with their own phone, contact and messages, never the job's (the job's are the primary client's). An older backend without `payer_contact` reads as the job's client.
  - The header shows the payer's phone (`payer_contact.phone`), not the job's.
  - **The conversation** (`conversation.messages`, the payer's own messages), oldest first and newest at the bottom, with a day line whenever the Perth day changes. It scrolls, and opens scrolled to the bottom. Calls read "Call out · 0:31 · no answer", with the transcript behind **Show transcript**. Emails show their subject; very long messages fold behind Show all.
  - When the job's thread holds more (`conversation.all_job_messages_count`), a quiet link reads **Show the whole job's conversation (N messages)**. It reads `debt_ws_job {xero_invoice_id, conversation: "all"}`; other people's messages are muted and carry their name (`party_name`: "Taylor Brooks · text", "Shaun to Taylor Brooks"). **Show only Peter's messages** goes back.
  - When the payer has no GHL contact (`conversation.reason = "payer_not_linked"`): "No conversation with Peter yet. Link Peter's GoHighLevel contact to see it and text them."
  - **Agent notices** (`flags[]`) sit below it as calm amber cards, each with its text, why and date. **Dismiss** (owner only) posts `debt_ws_decide {xero_invoice_id, suggestion_id: flag.id, action: "dismiss"}`.
  - **Link contact** (the payer has no GHL contact) lists the payer's `contact.candidates` (searched by the payer's own phone and email) with **Link**, which posts `debt_ws_link_contact {xero_invoice_id, job_id, ghl_contact_id}`. The backend links the invoice's payer: a neighbour's contact goes on their own `job_contacts` row and never replaces the job's. When `contact.linkable` is false (a neighbour with no contact row on the job), the card says to add them to the job's contacts first.
  - **The suggestion** (`suggestion`), one of three kinds:
    - **draft:** a dashed orange card with the text, Edit (a text box; an edit is kept for that suggestion until it is sent), Send, Skip and **Why this one**.
      - Send is disabled while `settings.sending_on` is false, and then reads **Sending is off until you switch it on**. It is also disabled for staff, and without a linked payer for a text ("Link Peter's contact first"). A linked neighbour on a shared fence is texted from here at their own contact: the backend's guarded text path accepts the job's own contact or a live party on the same job's contact list (Captain ruling, 12 Oct 2026), and refuses anyone else (`send_refused_by_guard`).
      - When `possible_payments` is not empty, a warning shows the date, amount and payer, and Send becomes **Send anyway**, which posts `override_possible_payment: true`.
      - Day 7 adds a line to ring them too.
    - **move:** a purple card with why and the proposed category, the suggested reply (editable), **Move to Rectification + send reply** and **Keep chasing**.
      - Move posts `debt_ws_set_category {xero_invoice_id, category, suggestion_id}`. When sending is on and a contact is linked, it then sends the reply through `debt_ws_decide` on the suggestion's reply step (`reply_says_paid`, `reply_promise` or `reply_problem`).
      - While sending is off, the button reads "Move to Rectification" and says only the move happens.
      - Keep chasing posts `debt_ws_set_category` with `category: "clear"` and the suggestion id.
    - **flag:** a plain note card.

    With no suggestion, one calm line says what happens next: says paid, rectification, paused, on Jan's list, or the next step and when.
- **Right column:** notes only.
  - A note box, an optional **Promised to pay by** date, and **Save note**. Save posts `debt_ws_note {xero_invoice_id, share_key, job_id, note, body, promise_date}`; the contract names no text field, so `note` and `body` carry the same words. A promise date in the past is refused on screen.
  - The notes list (`notes[]`, newest first): people's notes and promises in normal type (a promise shows the backend's own line, "Promised to pay by Friday the 17th of October"); the screen's own records (Day 3 text sent, skipped, Moved to Says paid, Removed from Jan's visit list, contact linked) muted.

**Send** posts `debt_ws_decide {xero_invoice_id, step, suggestion_id, action: "send", text, channel, amount}`. `amount` is what the draft was written for (`suggestion.amount`, else the amount owing); the backend refuses a template send without it (`amount_required`) and refuses one Xero shows part paid since (`part_paid`). **Skip** posts the same with `action: "skip"`. The screen refuses a long dash or an emoji in the text before it posts. After every write, the job and the overview are read again quietly.

## Owner only and refusals

- When `settings.viewer_is_owner` is false, these are disabled or hidden: Send, Send anyway, Skip, Move, Keep chasing, Change, Link, Dismiss, Approve and Remove. A line says so. Notes still work.
- Every refusal is shown in plain words, never as a bare code. `DebtWorkshopCore.REFUSALS` holds words only for codes `debt_ws_actions.ts` really throws (`sending_off`, `possible_payment`, `part_paid`, `paid`, `not_open`, `amount_required`, `already_sent`, `step_not_due`, `send_refused_by_guard`, `send_not_confirmed`, `xero_unavailable`, `bank_check_unavailable`, `suggestion_not_pending`, `suggestion_mismatch`, `text_not_allowed`, `jan_list_closed`, `contact_already_linked`, `not_in_book`, `not_found`, and a few more). Any other code shows the backend's own reason.
- The code is read from a thrown error's `refusal.code`, its `code`, or its `body.code`; `opsFetch` and `opsPost` now keep `e.code` and `e.body`. An answer that comes back `ok: false` or `sent: false` counts as a refusal too.
- A `possible_payment` refusal that carries `possible_payments` updates the warning on screen.
- Only an unknown action (`code: "unknown_action"`, or "Unknown action" in the message) means the backend is not deployed yet: the screen says "Not switched on yet" and never guesses a number. Any other 400 or 404 is a real answer and is shown as one.

## Guards

- `npm run test:debt-workshop` (`scripts/test-debt-workshop.js`, in `test:e2e`) runs the pure core in a node VM:
  - the filters and the account lane, totals and the donut, list order, next-step words;
  - the statement and send gates, refusal words, the tab flag;
  - conversation order, notes, ladder, story and money;
  - that the module file holds no long dash, no en dash and no emoji;
  - **the backend contract:** it drives every write on the screen with the fixture and checks each POST field is in that action's backend `onlyKeys` list, that every send carries its amount, and that every code in `REFUSALS` is one the backend throws. The checks run against a hand copy of the backend lists (`BACKEND_CODES`, `BACKEND_ONLY_KEYS`), so CI needs only this repo. When the backend sits next to this worktree (`../backend-debt-workshop`, or `DEBT_WS_BACKEND_DIR`), the copy is also compared with `debt_ws_actions.ts` and `debt_ws_store.ts`; a mismatch means the backend changed, so update the copy. Without the backend it prints a note and carries on.
- `tests/e2e/ops-debt-workshop.spec.js` checks:
  - the hidden tab and its three switches;
  - W1, the footer, Insurance (preview, approve, refusal) and Jan's list;
  - W2 (strip, ladder, story, thread, transcript, notice, suggestion, notes, Back and Next);
  - edit and send with a refusal, dismiss, a promise note;
  - the possible payment (send and statement), the move card, Change (Says paid, Rectification with its confirm, Clear says paid), the Paid pill, Jan's list while locked and once sent, Link contact, documents, staff read only, not deployed, and the phone layout;
  - a shared fence (Riley Shaw, share B, the SWF-26624 shape): the neighbour's phone, the share line, no borrowed conversation, the whole-thread toggle with names, Send off until linked, Link posting the invoice; and a linked neighbour texted from here (Send on, posting Riley's invoice).
- The fixture is `tests/fixtures/debt-workshop.js`: made-up names, with dates from today's Perth date. It uses the backend's real shapes: job invoices carry `number`, ids are UUIDs, GoHighLevel contact ids are letters and digits only, and the move suggestion has its `reply_problem` step.
- To write the screenshots: `DEBT_WS_EVIDENCE_DIR=docs/evidence/debt-workshop-2026-10-08 npx playwright test tests/e2e/ops-debt-workshop.spec.js`.
- Latest screenshots: `docs/evidence/debt-workshop-2026-10-08/` (`09-change-category.png` is the Change menu open on the strip).
