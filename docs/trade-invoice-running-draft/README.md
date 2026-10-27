# Running weekly invoice draft (backend)

This app does not deploy ops-api. These files are the backend change to land in `SecureWorks-GROUP/secureworks-backend`.

- `trade_invoice_running_draft.ts` goes in `supabase/functions/ops-api/`.
- `ops-api-index.patch` is the wiring in `supabase/functions/ops-api/index.ts` (import, profile-scoped actions, the three trade cases, the agent case, and `my_hours.running_invoice_draft`).
- The migration is `supabase/migrations/20261024120000_trade_invoice_running_draft.sql` in this pull request. Apply it on the backend Supabase project before deploying ops-api. Do not run it from the dashboard app.

Save and the agent path store a draft only. They do not submit, authorise, pay, or create a Xero bill. The screen stays off until `users.trade_details.runningInvoiceDraft` is true for that person.
