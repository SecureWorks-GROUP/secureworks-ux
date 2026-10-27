# Work orders to fill

Office only. Financials > Work Orders, above the existing list. Module: `modules/ops-office-wo-queue.js`.

The server flag is `job_work_order_office_fill_v1`. `list_office_job_work_orders` answers `{ enabled: false, work_orders: [] }` while it is off. An unknown action means the backend is not deployed. Either way the host stays empty: no heading, no rows, no allowance.

A failed read (403, 500, timeout, or any other error) clears the queue. The line "Work orders to fill could not be read." is shown only after a successful read has said the switch is on (`enabled: true`, or a list of work orders). Before that, the host stays empty.

When the flag is on, each draft shows the job, the client, and the labour allowance. A null allowance says "Needs a labour allowance" and has no Approve. Save allowance posts `fill_job_work_order_allowance` with `work_order_id`, `expected_updated_at`, and `agreed_labour_ex` (0 is allowed). Approve posts `approve_office_job_work_order` with the id and the `updated_at` on screen. There is no Send control.

A trade role on this page (installer, lead installer, crew, trade, subcontractor) paints nothing, so the allowance is not shown there.
