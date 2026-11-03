# Running weekly invoice draft (backend)

This app does not deploy ops-api. These files are the backend change to land in `SecureWorks-GROUP/secureworks-backend`.

- `trade_invoice_running_draft.ts` goes in `supabase/functions/ops-api/`.
- `ops-api-index.patch` is the wiring in `supabase/functions/ops-api/index.ts` (import, profile-scoped actions, the three trade cases, the agent case, and `my_hours.running_invoice_draft`).
- The migration is `supabase/migrations/20261024120000_trade_invoice_running_draft.sql` in this pull request. Apply it on the backend Supabase project before deploying ops-api. Do not run it from the dashboard app.

Save and the agent path store a draft only. They do not submit, authorise, pay, or create a Xero bill. The screen stays off until `users.trade_details.runningInvoiceDraft` is true for that person.

Deleting or editing a line that is already on the draft is `remove`, `edits`, or a `lines` entry with `remove: true` or `update: true` on `agent_save_running_invoice_draft`. A removed source key is stored on `dismissed_source_keys` and on `draft_builder.dismissedKeys`, and `draft_builder.manualLock` is set. A later save still adds new work for the week, and it does not put a dismissed line back or replace a line the owner edited. `resync: true` is the explicit rebuild; `restore_removed: true` with it clears the dismissed keys. The live handler in secureworks-backend is ahead of the TypeScript copy in this folder; land the behaviour there, and do not paste this folder's copy over that file. `owner-line-edit.patch` is that change against current `main` (`trade_invoice_running_draft.ts` and its test). No new column is required. This account cannot push to secureworks-backend, so that patch is not opened as a pull request. The assistant tool `sw_save_running_invoice_draft` still has to accept `remove` and `edits` (and make `lines` optional when either is sent) before the bot can call them.
