# Job page Overview v2: story, timeline, conversation, files

The job page Overview of the ops dashboard (`ops.html`, route `#job/<job number>`), rebuilt around the job context system. Code: `modules/ops-job-overview-v2.js`. The approved mockup is the owner's "job-overview-sw" design (9 Oct 2026) in the existing SecureWorks look: orange `#F15A29`, dark `#293C46`, warm ground, square cards, 3px buttons, 100px pills, blue-toned shadows.

## The switch

Off by default, so nothing changes for anyone until it is switched on.

- `ops.html?overview=v2` (or `=1`) turns it on for that page load; `?overview=classic` (or `=0`) turns it off. The URL wins over the browser setting both ways.
- Otherwise `localStorage.sw_overview_v2 = '1'` keeps it on in that browser.
- Staff (signed in, role not a trade role) see a small **Try the new Overview** link at the top right of the classic Overview and **Back to classic** on the new one. The link saves the choice in `sw_overview_v2`, takes `?overview=` out of the address (the `#job/...` part stays) and repaints.
- Make-safe jobs always keep their own MakeSafe detail.

`renderOverviewView` (ops.html) asks `JobOverviewV2.render(data)` first, right after the make-safe branch (`// <job-overview-v2-switch>`), and paints the classic Overview when it returns false. `render()` returns false when the switch is off, for a make-safe, and on any error, so the page never breaks. After the classic Overview paints, `JobOverviewV2.afterClassic(data)` adds the staff link and nothing else.

## What the screen shows (top to bottom)

1. **The page's own top bar and tabs**, unchanged.
2. **Customer.** Name (with **Edit**, the page's own `editClientName`; the row keeps `id="jdClientNameRow"`), address, phone and email, who else is involved and who is ours (from the story card's `who`), then **Call** (the call-bridge on a desktop, a `tel:` link that dials on a phone, both through `scheduleCallLog`), **SMS** (jumps to the reply box; to the Comms tab when there is no GoHighLevel contact), **Email**, **Navigate** and **View in GHL** (the opportunity, else the contact). On the right: job value, "Invoiced $x · Paid $y · inc GST", any draft invoice ("Draft INV-1637 $3,571.43, not issued"), who pays what when the scoping tool recorded a split, and whose move ("Our move" in orange). A recorded split whose shares do not add up to the job value is shown with a check-the-scope warning, never silently corrected.
3. **Files**, a strip that scrolls sideways: live quotes newest first (version, the value recorded on that quote, else "value not recorded" on the current one and never today's job price, sent, how many times it was opened, accepted), live invoices (a DRAFT reads **Draft, cannot be paid**), the scope of works (opens the scoping tool), email attachments and uploaded documents, labelled by their source (two copies of one file show as one card with "2 versions"), site photos (opens the Files tab), then faded at the end: replaced quotes and invoices deleted or voided in Xero. A quote opens its PDF (else the client view link); an invoice opens the page's invoice preview and carries an **Open in Xero** link.
4. **Three columns** (one column at 1150px and below, with the story first, so a phone reads customer, files, story, timeline, conversation):
   - **Timeline**, oldest at the top, newest at the bottom, scrolled to the newest. Orange dots are milestones (first contact, the scope, each quote sent or accepted, invoices issued or paid, status moves into accepted, scheduled, in progress or complete), red are warnings (a draft invoice, an email that did not send), faded are deleted invoices, amber is "Now". Tap an item for its full words, Perth date and time, where it came from, the amount and the quote's view count. A phone shows the newest eight with **Show all**.
   - **Job story.** A built-at header with **Refresh** (a fresh read, not a rewrite), **Where it's at** from the current story card with a **Whose move** pill, and the next step with at most two actions. Four recent milestone dots lead into a **Quoted / Invoiced / Paid** band. Quoted uses the current quote's recorded value only; an absent quote value says "Not recorded". Open loops show **Waiting on** pills, followed by the last customer and office messages and the card's **What we don't know** list. The longer written story folds under **More story**. The stamp retains the written-at and AI notes dates plus **Rewrite**, which requests new prose. The classic status moves remain available in the next step.
   - **Conversation**: texts, calls and email as bubbles with Perth times and day lines (two copies of one message, the business record and the CRM copy at the same second, are one bubble), each held row marked in place **Job not certain: may belong to another job**, All / Texts / Calls / Email (the choice is kept in `localStorage.sw_ov2_conv_filter`), and a reply box that sends a text.
5. The page's Notes rail, unchanged, under every tab.

## Data

The screen paints at once from `job_detail` (already read by `openJobDetail`), then reads `job_overview` and repaints. `job_overview` builds the story card live and takes 10 to 20 seconds, so the answer is cached per job for 3 minutes with one read at a time, abandoned after a minute, and a re-render inside that window never reads it again. A late answer for a job no longer on screen paints nothing.

`GET ops-api?action=job_overview&jobId=<uuid>` (staff JWT, same auth as `job_detail`). The fields the screen reads; it accepts the alternative names in brackets, because the backend is built in parallel:

| Field | Used for |
|---|---|
| `story` (the `context_job_story(job, now())` card, `job-story-v1`) | `now` (line, next, phase, phase_since, whose_move), `who`, `loops`, `money` (job_value, parties with invoices), `timeline`, `events`, `meta.ledger`, `meta.built_at` / `as_of` |
| `notes.items[]` | open items, only when the card has no loops |
| `messages[]`: `id`, `at`, `channel`, `direction`, `who`, `text`, `kind` (`event_type`), `call_seconds` (`duration_seconds`) | the conversation; "Show the message" finds a cited row by `id` |
| `files.quotes.documents[]` (also accepts the earlier `files.quotes[]`): `id` (`document_id`), `quote_number` (`number`), `version`, `sent_at`, `first_viewed_at` (`viewed_at`), `accepted_at`, `superseded_at`, `view_count` (`views`), `value_inc_gst` | quote cards and the timeline's view counts; `files.quotes.headline.value_inc_gst` alone supplies the Quoted band when that envelope is present (a null headline is not one run's price); joined to `job_detail.documents` by `id` for the PDF and share link |
| `files.invoices[]`: `id`, `invoice_number` (`number`), `reference`, `status`, `total`, `amount_paid` (`paid`), `amount_due` (`owing`), `due_date`, `invoice_date`, `fully_paid_on`, `invoice_type` | invoice cards and the preview; the matching `job_detail.invoices` row supplies `xero_invoice_id` for Open in Xero |
| `files.attachments[]`: `file_name` (`name`), `at` (`event_at`, `occurred_at`), `page_count` | attachment cards (not clickable: there is no staff action to open one yet) |
| `files.media_count`, `files.scope` | photos and scope cards when `job_detail` has none |
| `story_text` (`context_job_story_text_get`): `status` `fresh` / `stale` / `none`, `writer.open_request`, and the current row (`sections` {headline, the_job, how_we_got_here, where_it_is_at, watch_out}, `written_at`, `evidence_until`) under `text` | the written story, request state and its stamp |
| `bills` (backend `20261029170100`, `context-job-bill-outcomes-v1`, contract `cfo-bill-cost-outcome-v1`) and `sources.bills`: per bill `xero_invoice_id`, `invoice_number`, `supplier`, `bill_status`, `bill_state`, `where_counted`, `here` {counts, reason}, `other_jobs` [{job_number, counts}], `held_reason`, `overhead_part`, `mirror_bill`; never an amount | **Where each bill counts** under the story (`C.billOutcomes`, `C.billLine`): one line per bill in the CIO card display contract's revision 6 words (below) |
| `story_text.money` (backend `20261028190000`, `story-book-v1`): `{version, source job_profit\|none, lines, complete, incomplete_line}` | **Money, from the books** under the story: each line word for word (`C.storyBook`), the `incomplete_line` marked. The story's prose never restates a figure from it (the writer refuses one). No block when the backend sends none |

The card qualifiers stay visible with written stories off:

- `story.held_messages` is a separate **Held messages, job not certain** section. It shows the returned words, source date, sender, hold reason, other candidate job numbers, shown/total counts and any source truncation. The section lists one row per held call (its call log and transcript row are one call, with the logged duration), and its count drops by the same number. These rows never become this job's last word, timeline or open items. The backend also puts held rows into `messages[]` with `job_certain: false`; the Conversation keeps them in place, marked "Job not certain: may belong to another job", and the hint counts them. A `messages[]` copy of a held row (same id, or the same time, channel and direction) is marked the same way. Calls show only a producer-supplied `summary`; without one the screen names the missing summary and possible commitments, never prints the raw transcript. The current backend card has held call `text` but no safe `summary`, so call-obligation visibility still needs that producer field.
- A `not_due` loop stays under Good to know, tagged **HELD**, with **not owed now** and its `why` visible without expanding it. `story.money.not_yet_invoiced` shows the supplied amount (or unconfirmed), hold state and basis beneath the money band. It never contributes to issued or paid money. During backend skew a missing `why` cannot supply a completion trigger; the page preserves the hold status and any available money basis.
- `story.checks` entries with `rule: C2_value_mismatch`, or an explicit unconfirmed money value, qualify the header as **Unconfirmed**. The recorded amount, source and verbatim conflicting check appear beside it. While the card is loading or unavailable the saved price is **Not checked**, with its amount and source still shown. The browser never substitutes a guessed contract or bills the difference.
- **Last word** uses `story.last_exchange.customer_said` / `we_told_customer`, including meaningful nulls and withheld calls. A held entry never shows. An entry with no words (an emoji only, which the screen never prints) shows the newest worded customer message on this job before it, with "Then a reply with no words (an emoji only)" and its time; with none, it says the reply had no words. Without that block only messages explicitly marked as customer correspondence qualify. Direction alone, an outbound `party: us`, or held contact history never proves a customer exchange.

`POST ops-api?action=request_job_story {jobId}` asks for a rewrite (Rewrite). The answer's `outcome` (or `state`: `queued`, `already_open`, `recent`) is said in words. `off` says "Rewriting is not switched on yet", and a refusal or unknown outcome never claims a request was made; an unknown action reads "Rewriting is not switched on yet".

The reply box sends exactly what the Comms tab sends: `POST ghl-proxy?action=send_sms` with the signed-in user's token and `{contactId, message, jobId}`. It is a success only when the answer says `success: true`; a 409 duplicate ("the same text in the last 10 minutes") or a contact mismatch is said in words and nothing is retried. A long dash or an emoji keeps Send disabled with the reason (company rule for texts). After a send the cached Comms thread (`sessionStorage sw_convo_<contact>`) is dropped so the Comms tab reads it fresh.

## Where each bill counts (INT-10)

The words are the CIO card display contract for bills, revision 6 (21 Oct 2026, sha256
`c317ed451b0dffd9cca6c666ea7cccb99ff3d426fa8aba73cc9353141a29fb06`), mapped from Finance's
`where_counted`, `bill_state` and reason codes:

| Finance's answer | r6 row | Line |
|---|---|---|
| here, counted_in_full | 8 | Money counts this bill's cost here. See Money. |
| here, with an overhead part | 8o | Money counts part of this bill's cost here and part to overhead (no job). See Money. |
| here, counted_in_part | 5 | Money counts part of this bill's cost here. The rest is not placed yet. See Money. |
| elsewhere, counted_in_full | 9A | Money counts this bill's cost on SWF-B. See Money. (overhead variant as r6) |
| elsewhere, counted_in_part | 5 | Money counts part of this bill's cost on SWF-B[ and part to overhead (no job)]. The rest is not placed yet. See Money. |
| here_and_elsewhere | 10 | Money counts part of this bill's cost here and part on SWF-B[, and part to overhead (no job)]. See Money. (counted_in_part adds "The rest is not placed yet.") |
| held, `not_job_related_mark_on_counted_bill` (F1, JP-21) | 1 | Where this bill's cost counts is not settled. It waits on an open money decision (JP-21). See Money. |
| no_job, `installer_unconfirmed` | 3 | Installer bill: confirmation is missing. Money does not count it on any job until then. See Money. |
| no_job, voided, and our copy says VOIDED or DELETED | 4 | Xero voided this bill. Money counts it on no job. See Money. |
| no_job, `xero_link_read_through_overhead` | 14h (LG-2) | An overhead part is recorded on this bill while Xero still links it here. Money does not count it on this job. See Money. |
| no_job, `labour_part_unconfirmed` | 14h (LG-1) | A labour part of this bill waits for a person to confirm it. Money does not count that part yet. See Money. |
| no_job, `xero_link_hidden_by_other_row`; held for any other reason | 14h | Where this bill's cost counts is not settled. See Money. |
| not job related, or whole-bill overhead | 7 (CFO's hold: row 14) | Where this bill's cost counts is not known here. See Money. |
| unknown, a value the card does not know, or a failed read | 14 | Where this bill's cost counts is not known here. See Money. |

Lines r6 has no row for are proposed (marked `data-ov2-fresh`, for design and CFO): a trade-app
mirror bill (r6 row 14's note), "Trade app bill: Money counts its cost through the trade app's
own lines, not as this bill. See Money." with a **Trade app bill** mark; `over_counted`, "Money
counts more of this bill's cost than the bill itself. See Money." (true whether the excess is on
jobs or in an overhead part); a draft bill, "Xero has
not approved this bill yet. Money counts it on no job until then. See Money."; and any other
counted-nowhere reason, "Money counts this bill on no job. See Money."

Each bill shows its number, supplier and Xero status ("Paid in Xero", never "settled"), never an
amount. An unknown names its reason under the line (the placement's own code, else "Money cannot
say what state this bill is in", "This job holds no placement of the bill" or "Money's answer is
not one this card knows"). A refused or failed read is one line, "Where this job's bills count is
not known here." with the reason, never "no bills"; a server that predates the read reads "not
switched on yet". Every not known or not settled line (rows 1, 7, 14 and every 14h line) is echoed
once in **What we don't know**.
r6's "not confirmed yet" variants (rows 11 and 12) are not drawn: Finance's `placed_by` is
descriptive only, so they wait on a field that says a placement is confirmed.

## Rules the screen keeps

- A DRAFT or SUBMITTED invoice is not invoiced; only AUTHORISED and PAID count; deleted and voided invoices never count (a false "paid" on a deleted invoice included). The story card's money wins; without it, only invoices linked to this job count, and an invoice `job_detail` matched on the client name alone (including an unlinked row with no `job_id`) is marked "matched by name only" and left out. `job_detail.invoice_summary` (which counts drafts) is never used.
- A call is one row with its duration ("Call to Avery · 7 seconds · 8:03am"); transcript words never show. Machine rows (`scope_saved`, `event_listener.reaction`, `conversation.synced`, `automation.actions_cancelled`, `document.text_extracted`, quote views, empty texts) never show. Quote views are a count.
- AI notes are true as at their date: open items say "As at Thu 8 Oct" (AI notes) or "Since Fri 2 Oct" (records), and timeline events say "AI notes, true as at ...".
- Every time is Perth time, whatever zone the browser is in; a Xero invoice or payment timeline fact uses its explicit calendar `date` and shows no invented time, including a payment timestamp encoded as UTC midnight.
- Stored text never shows an emoji or a long dash: one between numbers reads "to", any other a comma. This file and the screen hold no emoji.

## When job_overview is missing or slow

- **Loading**: "Reading the story, this can take up to 20 seconds." The timeline and conversation show the job record meanwhile.
- **Not deployed** (ops-api answers `Unknown action`): "The story is not switched on yet." Header, files, a plain record timeline (job created, quotes, acceptance, invoices) and the newest texts, calls and email from `job_detail` still show.
- **Failed**: "Story not available right now." with **Try again**.
- **Partial read or refresh failure**: a notice names each unavailable source. A failed refresh explicitly says that the previous read is still shown, with **Try again**. A partial response never claims all other sections are current.
- **Writer switched off**: `story_text.writer.on: false` says "Written stories and rewriting are not switched on yet" and offers no Rewrite action.
- **No written story** (the story writer starts switched off): the headline is the card's own first sentences, "Where it is at" the rest of that line, "Watch out" the good-to-know items, and a quiet "No written story yet".

## Tests

- `tests/e2e/ops-job-overview-v2-core.spec.js`: pure node, runs the code between `// <job-overview-v2-core>` and `// </job-overview-v2-core>` (switch precedence, Perth time in any zone, long dashes, money rules, file order, timeline folding, open item groups, whose move, the conversation, the story text shapes, and no long dash or emoji in the module file).
- `tests/e2e/ops-job-overview-v2-bills.spec.js`: the bill outcome rule against every r6 row (extracted from the core) and the card in `ops.html` against a stubbed `job_overview` (bills here, split, unknown, held, trade-app mirror; a refused read; a server without the read).
- `tests/e2e/ops-job-overview-v2.spec.js`: the real `ops.html` with every backend call stubbed from `tests/fixtures/job-overview-v2.js` (invented people, dates from today's Perth date).
