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
- **Bad debt** (not on Insurance) shows **Jan's visit list** above the list (`debt_ws_jan_list`):
  - the visit date, how many people, and the status in words (open, locked, sent, failed, skipped);
  - each person's address, phone, amount and history line;
  - **Remove** (`debt_ws_jan_list_remove {share_key}`), owner only, and disabled once the list is locked or sent.
- **Footer:**
  - Paid this week (opens a list);
  - Needs a look with its count (opens a list with the reasons);
  - Not chased (opens a list);
  - Not due yet, greyed (opens the not-due rows when the overview sends them).

## W2: the job screen

Clicking a row opens the job inside the view. **Back to <category>** returns to the same list. **Next** steps through the homeowner rows of that list ("2 of 5"). The screen reads `debt_ws_job {xero_invoice_id}`.

- **Status strip:**
  - the payer (with the neighbour part), the job type badge, and the category pill with its day;
  - the site, job number and invoice line;
  - "Follow-ups paused until ..." while a promise holds;
  - the amount owing, big.
- **Ladder:** the invoice, then `ladder[]`: done (green tick), due (orange, "ready now"), upcoming (date), skipped, not needed. On a phone it scrolls sideways, with the due step brought into view.
- **Left column:**
  - the job story in a few plain lines from `story`: `now.line`, `now.next`, `now.blockers`, and the last four `timeline` entries;
  - a money box: job value from `story.money.job_value`, each invoice paid or owing, and the total owing;
  - documents and invoices. An invoice opens through `get_invoice_pdf`; a document opens through `debt_ws_document {job_id, document_id}`. Each opens in a modal from a blob URL: PDFs in a frame, images inline, anything else as a download.
- **Middle column:**
  - **The conversation** (`conversation.messages`), oldest first and newest at the bottom, with a day line whenever the Perth day changes. It scrolls, and opens scrolled to the bottom. Calls read "Call out · 0:31 · no answer", with the transcript behind **Show transcript**. Emails show their subject; very long messages fold behind Show all.
  - **Agent notices** (`flags[]`) sit below it as calm amber cards, each with its text, why and date. **Dismiss** (owner only) posts `debt_ws_decide {xero_invoice_id, suggestion_id: flag.id, action: "dismiss"}`.
  - **Link contact** (no GHL contact on the job) lists `contact.candidates` with **Link**, which posts `debt_ws_link_contact {job_id, ghl_contact_id}`.
  - **The suggestion** (`suggestion`), one of three kinds:
    - **draft:** a dashed orange card with the text, Edit (a text box; an edit is kept for that suggestion until it is sent), Send, Skip and **Why this one**.
      - Send is disabled while `settings.sending_on` is false, and then reads **Sending is off until you switch it on**. It is also disabled for staff, and without a linked contact for a text.
      - When `possible_payments` is not empty, a warning shows the date, amount and payer, and Send becomes **Send anyway**, which posts `override_possible_payment: true`.
      - Day 7 adds a line to ring them too.
    - **move:** a purple card with why and the proposed category, the suggested reply (editable), **Move to Rectification + send reply** and **Keep chasing**.
      - Move posts `debt_ws_set_category {xero_invoice_id, category, suggestion_id}`. When sending is on and a contact is linked, it then sends the reply through `debt_ws_decide`.
      - While sending is off, the button reads "Move to Rectification" and says only the move happens.
      - Keep chasing posts `debt_ws_set_category` with `category: "clear"` and the suggestion id.
    - **flag:** a plain note card.

    With no suggestion, one calm line says what happens next: says paid, rectification, paused, on Jan's list, or the next step and when.
- **Right column:** notes only.
  - A note box, an optional **Promised to pay by** date, and **Save note**. Save posts `debt_ws_note {xero_invoice_id, share_key, job_id, note, body, promise_date}`; the contract names no text field, so `note` and `body` carry the same words. A promise date in the past is refused on screen.
  - The notes list (`notes[]`, newest first): people's notes and promises in normal type; the screen's own records (Day 3 text sent, skipped, category changed, contact linked) muted.

**Send** posts `debt_ws_decide {xero_invoice_id, step, suggestion_id, action: "send", text, channel}`. **Skip** posts the same with `action: "skip"`. The screen refuses a long dash or an emoji in the text before it posts. After every write, the job and the overview are read again quietly.

## Owner only and refusals

- When `settings.viewer_is_owner` is false, these are disabled or hidden: Send, Send anyway, Skip, Move, Keep chasing, Link, Dismiss, Approve and Remove. A line says so. Notes still work.
- Every refusal is shown in plain words, never as a bare code. `DebtWorkshopCore.refusalText` maps the known codes (`possible_payment`, `part_paid`, `paid`, `sending_off`, `already_sent`, `not_owner`, `no_contact`, `no_email`, `already_sent_this_week`, ...). Otherwise it shows the backend's own reason.
- The code is read from a thrown error's `refusal.code`, its `code`, or its `body.code`; `opsFetch` and `opsPost` now keep `e.code` and `e.body`. An answer that comes back `ok: false` or `sent: false` counts as a refusal too.
- A `possible_payment` refusal that carries `possible_payments` updates the warning on screen.
- An unknown action, a 400 or a 404 on a read means the backend is not deployed yet. The screen says "Not switched on yet" and never guesses a number.

## Guards

- `npm run test:debt-workshop` (`scripts/test-debt-workshop.js`, in `test:e2e`) runs the pure core in a node VM:
  - the filters and the account lane, totals and the donut, list order, next-step words;
  - the statement and send gates, refusal words, the tab flag;
  - conversation order, notes, ladder, story and money;
  - and that the module file holds no long dash, no en dash and no emoji.
- `tests/e2e/ops-debt-workshop.spec.js` checks:
  - the hidden tab and its three switches;
  - W1, the footer, Insurance (preview, approve, refusal) and Jan's list;
  - W2 (strip, ladder, story, thread, transcript, notice, suggestion, notes, Back and Next);
  - edit and send with a refusal, dismiss, a promise note;
  - the possible payment, the move card, Link contact, documents, staff read only, not deployed, and the phone layout.
- The fixture is `tests/fixtures/debt-workshop.js`: made-up names, with dates from today's Perth date.
- To write the screenshots: `DEBT_WS_EVIDENCE_DIR=docs/evidence/debt-workshop-2026-10-08 npx playwright test tests/e2e/ops-debt-workshop.spec.js`.
- Latest screenshots: `docs/evidence/debt-workshop-2026-10-08/`.
