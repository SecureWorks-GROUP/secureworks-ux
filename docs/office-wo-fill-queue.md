# Work orders to fill

Office only. Financials > Work Orders, above the existing list. Module: `modules/ops-office-wo-queue.js`.

The server flag is `job_work_order_office_fill_v1`. `list_office_job_work_orders` answers `{ enabled: false, work_orders: [] }` while it is off. An unknown action means the backend is not deployed. Either way the host stays empty: no heading, no rows, no allowance.

A failed read (403, 500, timeout, or any other error) clears the queue. The line "Work orders to fill could not be read." is shown only after a successful read has said the switch is on (`enabled: true`, or a list of work orders). Before that, the host stays empty.

When the flag is on, each draft shows the job, the client, and the labour allowance. A null allowance says "Needs a labour allowance" and has no Approve. Save allowance posts `fill_job_work_order_allowance` with `work_order_id`, `expected_updated_at`, and `agreed_labour_ex` (0 is allowed). Approve posts `approve_office_job_work_order` with the id and the `updated_at` on screen. There is no Send control.

A trade role on this page (installer, lead installer, crew, trade, subcontractor) paints nothing, so the allowance is not shown there.

## Fill from sealed quote (FU49 9a)

On Needs a work order, each draft with no amount reads ops-api `list_job_work_order_labour_confirm?limit=50` (secureworks-backend `docs/job-work-order-labour-confirm-v1.md`, switch `job_work_order_labour_confirm_v1`) beside `job_work_order_gaps`. The server's `reason` decides the row:

- `sealed_amount`: "Sealed quote labour $X proposed". Office roles (admin, owner, ops_manager) get one "Fill from sealed quote" press, which posts `confirm_job_work_order_labour` with `work_order_id`, `job_budget_id` and the `agreed_labour_ex` shown. It fills the draft only; a named approver still approves it in Work orders to fill.
- `no_amount_in_sealed_quote`: "No amount in the sealed quote", no press.
- `no_sealed_quote` and `revision_differs`: said in words, no press.
- A `sealed_amount` row without a readable amount says it could not be read, never $0.00.

Switch off (`enabled: false`), an unknown action, a 401/403, or any answer without `enabled: true` shows nothing new. Any other failed read says "The sealed quote amounts could not be read, so none is proposed." and offers no press; the gaps list still shows. A named refusal (for example `proposal_changed`) says what changed and keeps the press shut; a generic failure lets it be tried again. `already_confirmed` reads as already filled. The page never works out an amount. Screens: `docs/evidence/fu49-9a/`.
