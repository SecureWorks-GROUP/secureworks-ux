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
  with its rate. A lump line with no hours ("Root removal, 1 job") is marked **No hours**, so
  it is fixed before approval. Total hours and total allocation underneath. An empty draft
  says the lines come from the accepted quote and it has none yet.
- **Variation addenda**: each variation as its own marked block under the approved lines,
  never mixed into them.
- **Special instructions.**
- **Figures**: approved: agreed labour, billed to date, remaining, and the backend's rules
  (`over_agreed` flag, `near_agreed` warn, `has_variations`). Draft: the agreed labour as
  drafted and the labour billed before approval.
- **Variations reported by trades** (the `variations[]` of the staff read), with corrections
  and the "more than its invoice's labour" flag.
- **Work order PDF** button.
- **Approve and seal**, for Shaun only (`APPROVER_EMAILS` in the core is a display hint; the
  server checks `work_order_settings.approver_user_ids`). Disabled, with the reason, until the
  draft has the agreed labour and a task line or instructions. A confirm row first, then
  `approve_work_order {work_order_id, expected_updated_at}` where `expected_updated_at` is the
  `updated_at` of the very draft on screen. Any refusal reads in words; `stale_review` (and
  `not_a_draft`) re-read the job so the fresh draft is shown before anyone approves again.

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
stored work order, the Scope of Work section lists the stored task lines with hours and the
addenda (no money), the confidential Cost Breakdown lists the stored allocations and the agreed
labour (plus billed and remaining once approved), and a draft is marked DRAFT. The old
recomputed labour (`_woConst.COST_PRICES`, "Labour base ... @ $35/m" and margin) is not used.
A patio job prints its stored work order too. The fence specification, runs, gates and summary
still print from the scope. A job with no stored work order prints the old document unchanged.

## Trade App

- **Work Order and Scope tabs**: on an allocated fencing or patio job (not another crew's
  view-only job) `renderTradeJobWorkOrder` reads `my_job_work_order` and shows the approved
  work order: each task with its hours, per-metre lines as quoted, a total, variations as marked
  addenda, and the instructions. It reads task, quantity, unit and hours only, never a money
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
| Rate, allocation (Ops only) | `rate_ex`, `allocation_ex` |
| Variation addendum | `variation_number` (or, with no number, `variation_label`) marks the line; title `variation_label` (else "Variation n"); date `variation_approved_at` |

Backend gap, not built here (follow-up tracked by firstmate): the trade read
(`my_job_work_order`) passes scope items through the shared allowlist
`TRADE_WO_SCOPE_ITEM_ALLOWLIST`, which keeps only text, `qty`/`quantity`, `unit`/`units`,
`kind` and the note fields. A line's `hours` field and the variation keys are dropped before
the trade sees them, so today a trade sees hours only on a line priced in hours (`qty` with
unit `hrs`, which the allowlist keeps) and sees variation lines unmarked among the approved
lines. Showing hours on the other lines and marked variations to trades needs that backend
allowlist change; the trade screen already renders both when they arrive. The Ops page reads
the staff read and is not affected.

## Tests

- `tests/e2e/job-work-order-core.spec.js`: the core in node (line reading, addenda, status,
  approver, refusal words, Ops and trade HTML, PDF sections, no money in the trade view).
- `tests/e2e/ops-job-work-order.spec.js`: the Build tab panel, approve with the exact
  `updated_at`, the stale review, preview off, the PDF (fencing, patio, preview off), opening
  a draft, and Create Work Order leading fencing and patio to the job work order while other
  job types keep the old form.
- `tests/e2e/trade-job-work-order.spec.js`: the Scope tab (against the payload
  `my_job_work_order` sends today) and the invoice, preview on and off, including a per-metre
  trade's server-issued crew work order keeping its Work Order mode.
