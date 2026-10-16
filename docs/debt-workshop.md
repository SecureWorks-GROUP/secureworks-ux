# Debt Workshop: the Debt tab

Ops > **Debt** (`#viewDebt`). Module: `modules/ops-debt-workshop.js`, loaded at the end of `ops.html` through `__swOpsStampAssets`. Build contract: secureworks-wiki `coding/capabilities/debt-follow-up/debt-workshop-spec.md` (section 9 is this screen; sections 3, 4 and 8 give the data, the categories and the action shapes). The approved look is the local Lavish plan `debt-collection-fresh/.lavish/debt-workshop-build-plan.html`, sections 4 and 5. Where the two disagree, the contract wins.

This is the only debt screen. The old Clear Debt screens (Financials > Clear Debt, `ops-clear-debt-desk.js`, `ops-clear-debt-v2.js`, `ops-clear-debt.js`) were removed in stage 6. The Today tab's Overdue Invoices card opens this tab.

## When the tab shows

The Debt buttons (header and mobile nav, `data-debt-nav`) start hidden. They show when any of these is true:

- the URL has `?debt=1`;
- `localStorage.sw_debt_ws === '1'`;
- `debt_ws_overview` says `settings.tab_visible`.

`initApp` calls `debtWsProbeVisibility()` once after login. That is a quiet overview read. A failed read (not deployed yet, no access) leaves the tab hidden. `restoreTab` accepts `#debt`.

## W1: the overview

- **Header:** the read time, a "Sending off / Sending on" chip (from `settings.sending_on`), "Agent on" when it is, and, top right, the **Debt report** button (see "The debt report" below) above the job type filters: All jobs, Fencing, Patio, Insurance.
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
- **Middle column: the chat window.** Approved by Shaun on 16 Oct 2026 ("follow the templates, I'm happy"); the design is section 1 of the local Lavish page `debt-collection-fresh/.lavish/debt-desk-call-points.html`. One panel shaped like GoHighLevel's chat replaced the old split of a thread plus a separate suggestion card. Everything here is about the **payer** (`payer_contact`): the person who owes THIS invoice. On a shared fence that is the neighbour, with their own phone, contact and messages, never the job's (the job's are the primary client's). An older backend without `payer_contact` reads as the job's client.
  - **Agent notices** (`flags[]`) sit above the panel as calm amber cards, each with its text, why and date. **Dismiss** (owner only) posts `debt_ws_decide {xero_invoice_id, suggestion_id: flag.id, action: "dismiss"}`.
  - **The bar** (`#dwChatBar`): who we are texting, "Riley Shaw (B) · 0400 000 404" (the share letter on a shared fence, the payer's own phone), then "Texts go from 771 · INV-9003 · $1,420.37 · day 12".
  - **Two chips** in the bar replace the old "show the whole job's conversation" link: **"Riley only"** (the payer's own messages, the default, also on a shared fence) and **"Everyone on this job"**, which reads `debt_ws_job {xero_invoice_id, conversation: "all"}`; other people's messages are then muted and carry their name (`party_name`: "Taylor Brooks · text", "Shaun to Taylor Brooks").
  - **The thread** (`conversation.messages`), oldest at the top and newest at the bottom, with a day line whenever the Perth day changes. It opens scrolled to the bottom. Our texts sit on the right (blue), theirs on the left (white). Calls read "Call out · 0:31 · no answer", with the transcript behind **Show transcript**. Emails show their subject, in a dashed bubble marked **"Email, read only. Reply in Outlook."** (texts only from the box, as Marnin asked). Very long messages fold behind Show all.
  - **Not yet filed on a job:** a payer's message the context system left on no job keeps its grey label "not yet filed on a job" (the 14 Oct workaround stays until the filing is fixed at the source).
  - **Notes and promises** from the Debt log (`notes[]` of kind note, call or promise) show in the thread as **yellow lines** at their own time: "Note by Shaun: said she'd pay by Friday · 4:50pm". On the payer's view only notes on this invoice (or on no invoice) show; Everyone on this job shows them all. The screen's own records (a text sent, a skip, a category change) stay out of the thread, because the texts themselves are already in it; they stay in the Notes column.
  - When the payer has no GHL contact (`conversation.reason = "payer_not_linked"`): "No conversation with Riley yet. Link Riley's GoHighLevel contact to see it and text them."
  - **The reply box** at the bottom (`#dwCompose`, `DebtWorkshopCore.composeMode`):
    - **A proposed step** (`suggestion` of kind draft): the step's text is **already typed into the box, word for word** as the backend wrote it (`suggestion.text`: the approved template with only the name, street, amount, dates and pay link filled in, or the agent's draft when the agent is on). The screen never rewords it. A small green label above reads **"Proposed: day 7 reminder (with a call)"** (`DebtWorkshopCore.PROPOSED`), with "From the template" or "Written by the agent", and ", edited" once changed.
    - Type in the box to edit it; an edit is kept for that suggestion until it is sent. **Put the proposed text back** undoes the edits. **Add a note** brings the note box in the Notes column into view with the cursor in it. **Send text** sends. Under the buttons: **Skip this step** (owner only) and **Why this one**. Day 7 adds a line to ring them too.
    - **Write my own text instead** (shown when `manual_text.allowed`) empties the box for Shaun's own text, labelled "Your own text · not a planned step, so the follow-up days do not move". **Put the proposed text back** returns to the step.
    - **No step due today** but chasing is not paused: the box is for your own text, with "Nothing proposed today. Next: Day 17 final text on Fri 17 Oct."
    - **Nothing may be sent:** no box, and why in words in its place, as before: Xero shows it paid; they say they have paid; in Rectification; paused until a promised date; on Jan's visit list; a company invoice (the Monday statement); a contact we never chase; or the backend's `manual_text.reason` (for example the day 21 hold on a progress payment). **Add a note** stays.
    - **A move** (`suggestion` of kind move) keeps its purple card in place of the box: why, the proposed category, the suggested reply (Edit reply), **Move to Rectification + send reply** and **Keep chasing**. Move posts `debt_ws_set_category {xero_invoice_id, category, suggestion_id}`; when sending is on and a contact is linked it then sends the reply through `debt_ws_decide` on the suggestion's reply step (`reply_says_paid`, `reply_promise` or `reply_problem`). While sending is off it reads "Move to Rectification" and says only the move happens. Keep chasing posts `debt_ws_set_category` with `category: "clear"` and the suggestion id.
  - **Send keeps every gate:** Send is disabled while `settings.sending_on` is false, and then reads **Sending is off until you switch it on**. It is disabled for staff, and without a linked payer ("Link Riley's contact first"). A linked neighbour on a shared fence is texted at their own contact: the backend's guarded text path accepts the job's own contact or a live party on the same job's contact list (Captain ruling, 12 Oct 2026), and refuses anyone else (`send_refused_by_guard`). When `possible_payments` is not empty, a warning shows the date, amount and payer, and Send becomes **Send anyway** (`override_possible_payment: true`). The backend then runs the live Xero re-check, the bank-feed check and the 771-only send again, and every refusal reads in words under the buttons.
  - **Link contact** (the payer has no GHL contact) sits in the reply area and lists the payer's `contact.candidates` (searched by the payer's own phone and email) with **Link**, which posts `debt_ws_link_contact {xero_invoice_id, job_id, ghl_contact_id}`. The backend links the invoice's payer: a neighbour's contact goes on their own `job_contacts` row and never replaces the job's. When `contact.linkable` is false (a neighbour with no contact row on the job), the card says to add them to the job's contacts first.
- **Right column:** notes only.
  - A note box, an optional **Promised to pay by** date, and **Save note**. Save posts `debt_ws_note {xero_invoice_id, share_key, job_id, note, body, promise_date}`; the contract names no text field, so `note` and `body` carry the same words. A promise date in the past is refused on screen.
  - The notes list (`notes[]`, newest first): people's notes and promises in normal type (a promise shows the backend's own line, "Promised to pay by Friday the 17th of October"); the screen's own records (Day 3 text sent, skipped, Moved to Says paid, Removed from Jan's visit list, contact linked) muted.

**Send** posts `debt_ws_decide {xero_invoice_id, step, suggestion_id, action: "send", text, channel, amount}`. `amount` is what the draft was written for (`suggestion.amount`, else the amount owing); the backend refuses a template send without it (`amount_required`) and refuses one Xero shows part paid since (`part_paid`). **Skip** posts the same with `action: "skip"`. The screen refuses a long dash or an emoji in the text before it posts. After every write, the job and the overview are read again quietly.

**Your own text** (a manual text) posts `debt_ws_decide {xero_invoice_id, step: "manual", action: "send", text, channel: "sms", amount, client_ref}`: no suggestion, `amount` is the amount owing on screen, and `client_ref` is a UUID made once per message, so a double tap (or a retry after a send that was not confirmed) is refused as `already_sent` and never texts twice. The backend runs the same guarded send, refuses it while chasing is paused (`chasing_paused`), and logs it as a manual text (`text_sent`, step `manual`, `meta.manual`), never as a step: the follow-up days do not move, and the Notes column shows "Manual text sent". It needs secureworks-backend PR #1068, which adds `manual_text` to `debt_ws_job`; without it the box only ever holds the proposed step.

## The debt report

**Debt report** (top right of W1, `#dwReportBtn`) opens the live debt position as its own view inside the Debt tab (`DW.view = 'report'`). Shaun approved it on 15 Oct 2026; the plan is the local Lavish page `debt-collection-fresh/.lavish/debt-report-button-plan.html`. The backend is secureworks-backend `docs/debt-workshop/README.md`, "The debt report".

- **Always live.** The view reads `debt_ws_report` every time it opens (and on **Read again**). Nothing is cached between visits.
- **The report** is the backend's HTML (`html`), shown in a sandboxed frame (`#dwReportFrame`, `sandbox=""`: no scripts, no reach into the page). It holds: cash at bank per Xero account; money received in the last 7 and 30 days; debt expected in the next 7 and 30 days; total debt by the 5 categories, by job type, homeowners against companies, aging and the top 10 debtors; companies (past due, not yet due, oldest, this week's statement); every open invoice worst first; not counted as debt (not due, go-ahead deposits, needs a look, not chased); key points and notes; and the line that ties it all to Xero's open total to the cent. Its categories are the tab's own. The debt total leaves out the not-chased contacts, as the chart does; they are listed under not counted as debt.
- **Top of the view:** "As at" the read time, **Read again**, **Download PDF**, **Send to Marnin**, then who it goes to ("Sends from admin@secureworkswa.com.au to marnin@..., cc shaun@..."), "Last sent to Marnin: today, 9:02am" (or "never"), and "Monday auto-send: on/off".
- **Download PDF** reads `debt_ws_report_pdf` and saves the PDF it returns (`Debt position <date>.pdf`), the same PDF the email carries. Anyone who can see the tab can download it.
- **Send to Marnin** is owner only and needs sending on (`DebtWorkshopCore.reportGate`; the reason shows when it is off). It asks first: the first click shows "Send this report now?" with **Yes, send it** and **Cancel**; nothing is posted until Yes. Yes posts `debt_ws_report_send` with no fields (the backend reads the recipients from its settings and builds the report again at that moment). The answer shows "Sent to ..." and "Last sent" updates at once; only the top of the view is redrawn, so the report keeps its place.
- **Refusals** read in words (`DebtWorkshopCore.reportRefusalText`): sending off, not the owner, `recently_sent` (sent in the last two minutes), `recipient_not_internal`, `no_recipients`, `report_pdf_failed`, `email_failed`, and `send_not_confirmed` ("Check Sent Items in the admin mailbox before sending it again").
- **The button's words** come from the recipients: "Send to Marnin" for one recipient, else "Send report".
- **Back to the Debt tab** returns to the overview.

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
  - the debt report's Send words, gate, route and "last sent" line, and that Send asks first and then posts once with no fields;
  - conversation order, notes, ladder, story and money;
  - the chat window: the green Proposed words, the bar, notes as yellow lines in time order, what the bottom holds (`composeMode`), that the reply box holds the proposed text exactly as the template wrote it, and that a manual text posts step `manual` with its `client_ref`;
  - that the module file holds no long dash, no en dash and no emoji;
  - **the backend contract:** it drives every write on the screen with the fixture and checks each POST field is in that action's backend `onlyKeys` list, that every send carries its amount, and that every code in `REFUSALS` is one the backend throws. The checks run against a hand copy of the backend lists (`BACKEND_CODES`, `BACKEND_ONLY_KEYS`), so CI needs only this repo. When the backend sits next to this worktree (`../backend-debt-workshop`, or `DEBT_WS_BACKEND_DIR`), the copy is also compared with `debt_ws_actions.ts` and `debt_ws_store.ts`; a mismatch means the backend changed, so update the copy. Without the backend it prints a note and carries on.
- `tests/e2e/ops-debt-workshop.spec.js` checks:
  - the hidden tab and its three switches;
  - W1, the footer, Insurance (preview, approve, refusal) and Jan's list;
  - W2 (strip, ladder, story, the chat window: bar, chips, thread, transcript, email marked read only, note as a yellow line, the proposed text word for word, Add a note; notice, notes, Back and Next);
  - edit in the box, Put the proposed text back, and send with a refusal, dismiss, a promise note;
  - Write my own text instead (a manual text: step `manual`, `client_ref`, a long dash refused on screen), no step due (the box for your own text), and paused chasing (says paid, Jan's list) saying why in place of the box;
  - the possible payment (send and statement), the move card, Change (Says paid, Rectification with its confirm, Clear says paid), the Paid pill, Jan's list while locked and once sent, Link contact, documents, staff read only, not deployed, and the phone layout;
  - the debt report: the button opens the live view (read fresh each time), staff read and download but cannot send, Send asks first then posts and shows Last sent, a refusal in words, sending off, not deployed, and the phone layout;
  - a shared fence (Riley Shaw, share B, the SWF-26624 shape): the neighbour's phone and letter in the bar, the share line, no borrowed conversation, the Riley only and Everyone on this job chips with names, Send off until linked, Link posting the invoice; and a linked neighbour texted from here (Send on, posting Riley's invoice).
- The fixture is `tests/fixtures/debt-workshop.js`: made-up names, with dates from today's Perth date. It uses the backend's real shapes: job invoices carry `number`, ids are UUIDs, GoHighLevel contact ids are letters and digits only, and the move suggestion has its `reply_problem` step.
- To write the screenshots: `DEBT_WS_EVIDENCE_DIR=docs/evidence/debt-workshop-2026-10-08 npx playwright test tests/e2e/ops-debt-workshop.spec.js`.
- Latest screenshots: the chat window in `docs/evidence/debt-chat-window-2026-10-16/` (`02-job.png` the whole job screen, `12-chat-window.png` the panel, `13-own-text.png` your own text, `14-nothing-to-send.png` says paid, `15-mobile-chat-window.png` a phone); earlier ones in `docs/evidence/debt-workshop-2026-10-08/` (`09-change-category.png` is the Change menu open on the strip), and for the debt report `docs/evidence/debt-report-2026-10-15/` (the button, the view asking before it sends, and the report and its PDF drawn from the backend's synthetic test data).
