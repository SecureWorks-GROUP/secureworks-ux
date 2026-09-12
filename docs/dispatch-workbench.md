# Dispatch workbench

Dispatch adds an accepted-work queue, operator-owned order groups, requirements and source review, working notes, linked purchase orders, exact correspondence drafts, and material custody planning to Ops. The integrated calendar and Main Calendar projection consume the same source event IDs and layer state.

`modules/ops-dispatch-core.js` owns data custody and optimistic writes. `modules/ops-dispatch.js` renders the workspace through the existing authenticated `opsFetch` / `opsPost` adapter. Missing endpoints render errors and partial coverage; product code contains no sample fallback. `modules/ops-dispatch.css` is scoped to Dispatch.

## API contract

Reads: `dispatch_list` (cursor/limit), `dispatch_job` (job_id), `dispatch_calendar` (from/to, Perth date-only range), `dispatch_communications` (job_id, scope job/all, search/cursor).

All modifications use `dispatch_command` with job_id, expected_version, source_version, request_id UUID, command and payload. A full updated aggregate is read back before the UI reports persistence. Uncertain writes retain their exact request identity for retry. Version conflicts require a fresh read and explicit resubmission; local human edits remain intact.

Commands cover groups, stable requirements, source-set review, note custody/promotion, exact email draft save/review, order preparation, movements, stock allocation and verified receipt/transfer. `dispatch_assess` stores an assessment against current evidence. Server authority owns eligibility, source completeness, quantity conservation, exact approvals and all execution boundaries.

Order preparation persists an existing-model purchase-order draft through `order_prepare`. It requires reviewed requirements and an explicit existing-supply check. Unknown pricing remains incomplete; no purchase approval or supplier send is inferred. Clicking an existing PO prepares correspondence linked by PO identity. Email composition retains sender, recipients, CC, subject, body, exact attachments/revisions and reply thread. Broader captured-mail references retain their original job and do not copy recipients. Captured PO communication search is not represented as complete Outlook mailbox search.

## Validation and release

Run `node --test tests/dispatch/core.test.cjs` and `npx playwright test tests/e2e/ops-dispatch.spec.js`. Optional `DISPATCH_BROWSER_CHANNEL=chrome` uses an existing Chrome installation. The browser tests use isolated explicit fixtures and the actual production modules; they never contact a provider. These tests do not establish a deployed backend or real Outlook connectivity.

Apply the independently reviewed backend migration/API branch only under separate release authority, then prove authenticated end-to-end persistence and calendar/source coverage. Production activation, purchases, external sends, deployments and merges are not authorised by building this interface.

The main calendar integration uses the incumbent `calendarBody`, date navigation and crew/schedule renderers. Sidebar layer toggles share state with Dispatch; PO IDs are deduplicated across incumbent and Dispatch source feeds. Proposed logistics are read-only calendar blocks, and never enter crew drag/reschedule payloads.

Physical stock and cross-job ordered supply come from paginated `dispatch_supply` reads. `stock_record` requires physical unit, location and count evidence. Scope/pricing source payloads and current context facts remain inspectable. Captured HTML-only messages are rendered as inert text, and missing/unsafe media URLs cannot become links.

Attachments are selected by authoritative job document/media IDs. The server resolves source files and hashes bytes; client URLs and timestamps are not approval evidence. A changed canonical attachment descriptor requires another review after its exact names and hashes appear. Communications approval and execution use `dispatch_draft_approve`, `dispatch_execute`, `dispatch_execution` and explicit `dispatch_execution_readback`; server release holds default on. Provider acceptance is displayed separately from delivery, and an uncertain outcome offers readback rather than blind resend.
