# Job work order: Ops job page, Work Order PDF and Trade App

Every fencing and patio job has one work order, a draft that Shaun approves and seals
(backend: secureworks-backend `docs/job-work-orders-v1.md`, `ops-api/job_work_orders.ts`,
merged in https://github.com/SecureWorks-GROUP/secureworks-backend/pull/1022). These
screens show it. Rules and HTML live in one file both pages load, `shared/job-work-order.js`
(`JobWorkOrderCore`, pure, between `// <job-work-order-core>` sentinels); the Ops glue is
`modules/ops-job-work-order.js` and the Trade glue is the `// <trade-job-work-order>` block in
`trade.html`.

Captain's rules (12 Oct 2026): no trade sees a dollar amount, the lead trade included, hours
only; a variation joins the existing work order as a marked addendum; fencing is shown as
quoted, per metre, with hours only where the quote has hours; the quote's own cost table is
the one rate source.

## The preview switch

Built for real, published behind a preview, using the same live data. The live screens are
unchanged until the captain says "make it live".

- Open `ops.html?wo=preview` or `trade.html?wo=preview`. The browser remembers it in
  `localStorage.sw_wo_preview = '1'`, so the Trade App keeps it after it restores a screen.
- `?wo=live` turns it off and forgets it. Any other `wo` value is ignored.
- With it off: no work order panel, the Work Order PDF prints exactly as before, every
  "Create Work Order" opens the old office form for every job, the Trade App never reads
  `my_job_work_order`, and the invoice keeps the typed Work Order mode.

Making it live means making `previewState` answer on by default (one line in
`shared/job-work-order.js`) and updating these tests.

## Ops job page (Build tab, top)

`renderBuildView` (`// <job-work-order-panel>`) calls `JobWorkOrderOps.buildTabHtml(data)`.
It reads `job_detail.job_work_order` (fencing and patio only; `null` on other jobs, so nothing
shows) and then `ops-api job_work_order` for the billed lines and the trade-reported
variations, once for every `job_detail` read (each job open and each `refreshJobDetail()`), so
the panel never shows an older work order than the job page.

What it shows:

- **Work order number and status**: "Draft, not approved" or "Approved and sealed" with the
  date. A work order that could not be read says so.
- **A job with none yet** says so and offers **Open the draft**, which sends
  `create_work_order {kind: 'job', job_id}`. The server opens the job's draft (or answers
  with the one already open) and fills it from the accepted quote. The job is then read
  again, and the panel says what happened ("filled from the accepted quote", "no accepted
  quote to fill it from", "no labour lines"). A refusal reads in words; `work_order_sealed`
  re-reads the job.
- **Task lines**: task, quantity as quoted (`37.6 m`, `21 each`), hours, and the allocation
  with its rate (`$35.00/m`, `$80.00/h`, `10%`). A lump line with no hours ("Root removal, 1
  job") is marked **No hours**, so it is fixed before approval. A line the quote's labour figure
  is not made of (`counted: false`: removal, an extra outside the quote's labour) shows its
  allocation marked **Not in the agreed labour** and is left out of the total. Total hours and
  total allocation underneath. An empty draft
  says the lines come from the accepted quote and it has none yet.
- **Variation addenda**: each approved customer variation (`addenda[]` on the job_detail block
  and the `job_work_order` read) as its own marked block under the approved lines, never mixed
  into them: its label ("Variation 1 - approved 13 Oct 2026"), what the office wrote, its tasks
  with quantity and hours, and the trade allocation and customer price (office only).
- **Special instructions.**
- **Figures**: approved: agreed labour, billed to date, remaining, and the backend's rules
  (`over_agreed` flag, `near_agreed` warn, `has_variations`, `has_customer_variations`). With
  approved customer variations it also shows **Approved variations** (their trade allocation and
  count) and **Agreed total** (`figures.agreed_total_ex`, what billed and remaining are measured
  against). Draft: the agreed labour as drafted and the labour billed before approval.
- **Customer variations** (below): the office's record of extra work the customer agreed to.
- **Variations reported by trades** (the `variations[]` of the staff read), with corrections
  and the "more than its invoice's labour" flag.
- **Work order PDF** button.
- **Approve and seal**, for Shaun only (`APPROVER_EMAILS` in the core is a display hint; the
  server checks `work_order_settings.approver_user_ids`). Disabled, with the reason, until the
  draft has the agreed labour and a task line or instructions. A confirm row first, then
  `approve_work_order {work_order_id, expected_updated_at}` where `expected_updated_at` is the
  `updated_at` of the very draft on screen. Any refusal reads in words; `stale_review` (and
  `not_a_draft`) re-read the job so the fresh draft is shown before anyone approves again.

## Customer variations (Ops job page)

Captain, 12 and 13 Oct 2026: a variation joins the existing work order as a marked addendum,
and no trade sees a dollar amount. Backend: secureworks-backend `docs/job-work-orders-v1.md`
("Customer variations"), merged in https://github.com/SecureWorks-GROUP/secureworks-backend/pull/1031.
The section sits on the work order panel under the figures, once the job has a work order.
Its list is `customer_variations[]` from the `job_work_order` read (every status); while that
read loads it says so, with `customer_variations_open_count` from job_detail.

- **Add a variation** (any staff): what the customer agreed to, tasks each with its hours (a
  quantity only with its unit, "6 m"), the trade allocation and the customer price, both ex GST
  and both optional on a draft. Checked in words before anything is sent (no `$` in any text
  trades read). Sends `create_customer_variation {job_id, description, tasks,
  trade_allocation_ex, customer_price_ex}`; an empty amount is sent as `null`.
- **Edit** a draft: the same form, then `update_customer_variation` with every field and
  `expected_updated_at`, the `updated_at` of the variation when the form was opened.
- **Approve** (Shaun only, `APPROVER_EMAILS`; the server checks the approver list): held, with
  the reason, until the work order is approved and the draft has every task's hours, the
  allocation and the price (the server's `variation_not_ready`). A confirm row first, then
  `approve_customer_variation {variation_id, expected_updated_at}` with the shown draft's
  `updated_at`. The job is read again, so the addendum, the figures and the list come from the
  server.
- **Cancel variation** on a draft, with an optional reason: `cancel_customer_variation
  {variation_id, expected_updated_at, reason?}`. An approved variation is sealed: no edit, no
  cancel (a mistake is a further variation).
- **Refusals** read in words (`customerVariationRefusalWords`); `stale_review`,
  `variation_sealed`, `not_a_draft`, `work_order_not_approved` and a missing variation re-read
  the job so nobody acts on an old copy.
- **Customer invoice line**, on an approved variation that charges the customer: **Preview the
  customer invoice line** sends `prepare_customer_variation_invoice_line {variation_id}` and
  shows the line it built (description, quantity, unit price ex GST, account, reference). A line
  already kept on the record (`invoice.line`) shows without a new call; a price of 0 says there
  is no line. Preview only: no button here creates the Xero draft
  (`create_customer_variation_xero_draft` is never called; its backend switch is off and a
  follow-up must land before it is offered).

## Create Work Order: one way for fencing and patio

The old office "New Work Order" form (`#woModal`) made a crew work order whose prefill
(`autoWOFromScope`) asked `scope_to_po` for a labour figure the backend never returns. With
the preview on, a fencing or patio job has one way to get a work order: the job work order
above. `JobWorkOrderCore.createRoute(type, previewOn)` decides it (`// <job-work-order-route>`
in `ops.html`):

- The job quick view (Processing, "Still need: work order") and the calendar's
  "No work order yet" button say **Open Work Order** and open the job page on the Build tab
  (`JobWorkOrderOps.openForJob`). `openCreateWOModal` does the same for those jobs.
- In the old form, picking a fencing or patio job shows a notice that the form makes no work
  order for it, with **Open the job work order**, and holds Create WO; Load from Scope and
  Create WO read and write nothing for it (`woFormSyncJobWorkOrder`).
- Every other job type (repairs, make-safe, builder crew work orders) keeps the old form and
  its prefill exactly as before, preview on or off.

The quick view's "Still need: work order" hint still comes from `pipeline`'s `wo_count`,
which counts crew work orders only, so a fencing or patio job keeps that hint even once its
job work order exists.

## Office Work Order PDF

`generateRichWorkOrder` (`// <job-work-order-pdf>`): when the preview is on and the job has a
stored work order, the Scope of Work section lists the stored task lines with hours and each
approved customer variation as a marked block, "ADDENDUM: Variation 1 - approved 13 Oct 2026",
with its description and tasks with hours (no money). The confidential Cost Breakdown lists the
stored allocations, each addendum's trade allocation, and the agreed labour, plus once approved
the approved variations, the agreed total, billed and remaining; the customer's price is not on
it. A draft is marked DRAFT. The addenda and figures come from the `job_work_order` read when it
has landed, else from job_detail. The old
recomputed labour (`_woConst.COST_PRICES`, "Labour base ... @ $35/m" and margin) is not used.
A patio job prints its stored work order too. The fence specification, runs, gates and summary
still print from the scope. A job with no stored work order prints the old document unchanged.

## Trade App

- **Work Order and Scope tabs**: on an allocated fencing or patio job (not another crew's
  view-only job) `renderTradeJobWorkOrder` reads `my_job_work_order` and shows the approved
  work order: each task with its hours, per-metre lines as quoted, a total, variations as marked
  addenda (`work_order.addenda[]`: the label, what the office wrote, and each task marked
  **Variation** with its hours), and the instructions. It reads task, quantity, unit and hours only, never a money
  field, for every viewer. A job with no approved work order says the office is preparing it.
  The read is cached per job for two minutes. A failed refresh keeps the last good answer (on
  the Scope tab and for the invoice below) and is retried after those two minutes; only a job
  whose read never landed reads as failed, and it is retried when the tab is opened again.
- **Invoice**: for each fencing or patio job card with no server-issued crew work order, the
  builder reads `my_job_work_order`. On a job with an approved work order that card is billed
  by the hours worked: its Work Order mode is switched off and disabled (so the blank typed
  "WO allocated $" box and the paid-to-other-trades deductions are not offered), and the card
  says which work order it is billed against. The backend stamps each billed line against the
  job's work order and checks billed labour against the agreed amount on the server. A card
  hydrated from a server-issued crew work order (`work_order_id`, prefilled from the order's
  subtotal) and every card of a per-metre trade keep their Work Order mode exactly as before;
  a per-metre trade's invoice never reads `my_job_work_order`. A job without an approved work
  order keeps the existing behaviour.

## Line fields the screens read

The backend line builder fills `work_orders.scope_items` from the accepted quote. The screens
read exactly these keys and no other spelling:

| Meaning | Key |
|---|---|
| Task | `description` |
| Quantity, unit | `qty`, `unit` |
| Kind | `kind` (`labour` / `material`) |
| Note | `notes` |
| Hours | `hours`; a line whose `unit` is `h`/`hr`/`hrs`/`hour`/`hours` is its own hours |
| Rate, allocation (Ops only) | `rate` with `rate_unit` (`m`, `each`, `hr`, `pct`, ...) and `total`, as the backend quote line builder sends them; no other spelling is read |
| In the agreed labour (Ops only) | `counted`; `false` lines are named and left out of the allocation total |
| Variation line | `is_variation`, `variation_number` (or, with no number, `variation_label`) marks the line; title `variation_label` (else "Variation n"); date `variation_approved_at` |
| Variation addendum | the work order's `addenda[]`: `variation_number`, `label`, `approved_at`, `description`, and its lines in `lines[]` (staff) or `scope_items[]` (trade); `trade_allocation_ex`, `customer_price_ex` (Ops only, `addendaOf(list, {money: true})`) |

The trade read (`my_job_work_order`) keeps `hours`, `is_variation` and `variation_number` on
every line since backend #1031, so trades see each line's hours and which lines are
variations. The trade renderer reads no money field of an addendum, and the Trade App's
office money door (`TRADE_JOB_WO_MONEY_KEYS`) also strips `trade_allocation_ex` and
`customer_price_ex` off every addendum, and `total`, `rate` and `rate_unit` off every line
(the addenda's lines included), before render.

## Tests

- `tests/e2e/job-work-order-core.spec.js`: the core in node (line reading, addenda, status,
  approver, refusal words, Ops and trade HTML, PDF sections, no money in the trade view, and
  the customer variation rules: addenda from the backend, form checks, approve holds, the
  invoice line preview).
- `tests/e2e/ops-job-work-order.spec.js`: the Build tab panel, approve with the exact
  `updated_at`, the stale review, preview off, the PDF (fencing, patio, preview off), opening
  a draft, and Create Work Order leading fencing and patio to the job work order while other
  job types keep the old form; customer variations added, edited, approved (with the shown
  `updated_at`, and a stale review re-read), cancelled, the invoice line preview with no Xero
  write, and the PDF addendum.
- `tests/e2e/trade-job-work-order.spec.js`: the Scope tab (against the payload
  `my_job_work_order` sends today) and the invoice, preview on and off, including a per-metre
  trade's server-issued crew work order keeping its Work Order mode.
