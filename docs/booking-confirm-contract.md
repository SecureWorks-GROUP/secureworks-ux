# Booking confirmation adapter and backend handoff

Live entry: `ops.html#booking` loads `modules/ops-sales-booking.js` and its scoped CSS through `opsWriteModuleAssets`. No inline duplicate booking implementation is used. The existing `sales_booking_read` GET remains the only workspace read.

The adapter consumes **`scope-booking-lead.v1`**, as defined in the wiki `harness/ops/skills/secureworks-scope-booking/CALENDAR-STEPS.md` on `fm/booking-calendar-write-split-20260921`. The producer JSON is carried unchanged at `cases[].booking_read_model`; `decisionModel()` normalizes it for rendering. See the executable synthetic fixture `tests/fixtures/booking-confirm/read.js`.

The launch text is `message.template_text`, preserved byte for byte. `ai_proposed_text` is null/unselectable in the producer contract. The secondary AI choice is reserved for later integration with a current contact-bound job brief, address and last-visit outcome. Arbitrary `approved_text`/`chosen:unrecognized` never substitutes for the template.

`calendar_write` and `message` retain the producer states `awaiting_approval`, `approved`, `held`, `pending`, `succeeded`, `failed`, `unknown`. The UI names succeeded “Done”, awaiting approval “Not approved”, and explicitly blocks pending/unknown retries. `refused` plus `reason` is an additional required user-decision state. Every changed bound snapshot requires a fresh approval.

## Exact additions the backend read must supply

These fields are **not yet supplied by the wiki producer**. Until they exist, controls fail closed. This frontend does not claim auto-booking is live.

1. Embed the current manifest-selected lead models at `cases[].booking_read_model`. Preserve `schema`, `id`, `profile`, `contact_id`, `pack_revision`, `proposal.window.{start,end}`, `requires_scoper_confirmation`, `evidence_quotes`, `validation`, `calendar_write` and `message`. Do not glob stale model files. The root GHL contact must match the case, and duplicate contact models refuse.
2. Add envelope `booking_flow: {version:"booking-confirm.v1", approval_write:"separate-v1", calendar_read:{state:"read"|"could_not_read"|"not_configured", provider:"ghl", reason?}, commitments:[{id,contact_id,state:"offered"|"agreed",start_iso,end_iso}]}`. Advertise the write capability only when both independent storage/execution paths exist. Calendar `read` means a complete current census for the selected person/week, with all configured sources and active offer/agreement ledger accounted for. Missing or malformed ledger entries block. `commitments` projects the availability adapter's `prior_slots`; identity is GHL contact ID only. `proposal.commitment_id` can identify only the same contact and exact occupied span being fulfilled.
3. Add lead `expires_at` (offset-bearing timestamp) and `validation.checks:[{label,passed:boolean,reason?}]`. Failed checks need the verbatim reason. `validation.ok` and `reasons` remain the canonical overall result; an absent check list is never manufactured into passes. Successful overall validation must include current calendar, protected band, hours, travel and daily capacity checks.
4. Add `calendar_write.preview:{provider:"ghl",calendar_id,assigned_user_id,start,end,title,site_address,content_hash}`. This is the **actual event write**, including latest arrival plus visit duration at `end`, not merely the arrival window. Both calendar destination IDs must be owner-configured. The UI shows the destination, assignee, interval, title and site. Hash must bind the entire displayed calendar operation and current proposal revision.
5. Add `message.routing:{from_number,to_number,message_sha256}`. The hash must bind the exact template bytes and route. No trimming/rewording occurs. `message.template_text` is the existing locked template.
6. Add `calendar_write.approval.ui_snapshot` / `message.approval.ui_snapshot`, echoing the typed `approvalSnapshot()` object. Retain the producer's actual approval binding too. UI snapshots use `schema:"scope-booking-approval.v1"`, `step`, case/contact/scoper/resource/week, model `id`, `profile`, `pack_revision`, hash and exact channel content. Compare semantically, independent of JSON key order. A receipt state only displays as approved/done when this snapshot matches. Refusal stores `state:"refused", reason` separately on its channel.
7. Keep envelope `resource.id`, `week_start`, `send_hold`. Signed-in defaults use `SECUREWORKS_CLOUD.auth.getUser().id` / `scoper_user_id` matched to configured internal scoper UUIDs. Unknown identities choose explicitly; no name guess. Separate GHL approval execution is Stratco-only, matching the wiki contract. This change does not implement providers for Patio/Khairo.

## Separate approval write required

`opsPost('sales_booking_approval_write', {snapshot, decision:"approved"|"refused", reason})` records exactly **one** named step. Calendar uses `snapshot.step:"calendar"`; message uses `snapshot.step:"message"`. These are two independent requests to the same exact action, never one combined approval and never invented calendar/message action suffixes. Return `{ok:true,approval:{state,reason,snapshot}}`. No optimistic success, no UI provider call, and no translation to the retired `sales_booking_stamp_write` combined authority. Refusal requires a reason. Choosing/confirming one step never authorizes the other.

Authenticate and authorize the actor server-side. Validate current profile, model identity, complete pack revision, hashes, exact content, expiry and current availability before creating the independent stamp. Bind retries idempotently by step and content. Calendar execution must use `notify:false` and no SMS; message execution requires its own exact-text approval and matching successful calendar receipt (except information-only messages handled outside this slot-confirmation UI). Revalidate at execution and respect the send hold. UI approval is not evidence of execution; only producer receipts can mark Done. Unknown outcomes must be reconciled, not retried blindly.

## Visit outcomes: one insert and one list

The screen calls the existing backend outcome actions. The authoritative contract is [backend `docs/visit-outcomes-api.md`](https://github.com/SecureWorks-GROUP/secureworks-backend/blob/main/docs/visit-outcomes-api.md), read from GitHub main on 2026-09-22. This wiring does not establish deployment status or a complete booked-visit source.

**Insert:** `opsPost('record_visit_outcome', record)` sends a **flat** body:

```text
booking_key, appointment_id (nullable), contact_id (required GHL),
opportunity_id (nullable), job_id (nullable), scoper_user_id, scoper_name,
visit_start (ISO with seconds and offset), outcome (happened | did_not_happen),
reason (null | customer_not_home | we_did_not_attend | rescheduled),
note (one line, max 200 Unicode characters), quote_owed (boolean),
supersedes (uuid or null)
```

Response: `{visit_outcome:record}` with **no required `ok` field**. The returned record adds `id`, `recorded_by_user_id`, `recorded_at`, and `source:"booking_screen"`. The database generates the UUID/time; the verified signed-in user JWT supplies the actor. These four fields are not sent by the screen. Existing `opsPost`/`opsFetch` use the user JWT; no new key or client-owned actor authority is introduced. The backend requires an admin, owner or ops_manager.

Happened sets quote_owed true unless the scoper unticks it; reason is null. Did-not-happen requires one of the three reasons and defaults quote_owed false. After validation the screen sends `String(note || '').trim() || null`; a whitespace-only optional note is null, never a spaces-only string. Backend empty-note, trim and date rules are owned by [backend `docs/visit-outcomes-api.md`](https://github.com/SecureWorks-GROUP/secureworks-backend/blob/main/docs/visit-outcomes-api.md); dates may be normalized to UTC. The UI verifies returned facts using the same empty-note and timestamp normalizations plus the server provenance, then retains the **returned** row, including its ID/time, rather than manufacturing an echoed client record.

Corrections send a complete flat request with `supersedes` pointing to the current server record ID. Never update/delete prior rows. The backend serializes by booking key and deduplicates identical normalized requests from the same actor within a 30-second sliding window, including correction retries. A stale/cross-booking correction, second root, or root retry outside the window returns HTTP 409. Refresh and reconcile before another attempt. No messages, notifications, calendar or pipeline writes are triggered by this insert.

**List:** `list_visit_outcomes` is a GET with `scoper_user_id`, inclusive `since`, exclusive `until` (offset-bearing timestamps, maximum 366-day span), `include_history:true`, `limit` (1–500), and `offset`. Response: `{outcomes:[currentRecords...],history:[allRecordsForThoseBookings...],limit,offset,has_more}`; no required `ok`. Advance `offset` by `limit` until `has_more:false`, deduplicating history by record ID. A page counts current bookings, not history rows. History includes the current rows and their complete correction chains, including old dates/scopers. Missing/failed/truncated history cannot be advertised as complete.

The existing `sales_booking_read` remains the browser's single workspace GET. Its producer joins `list_visit_outcomes` internally into `visit_outcomes`, preserving all correction chains. The browser passes `visit_outcomes_from` / `visit_outcomes_to` to this workspace read for the last seven days; the producer maps them to the list's `since` / `until` and also covers the displayed week. They are **not** parameters of `list_visit_outcomes` itself. Neither `sales_booking_visit_outcome_insert` nor `sales_booking_visit_outcome_list` exists.

**Read envelope additions:** `booked_visits:[{booking_key,appointment_id,contact_id,opportunity_id,job_id,scoper_user_id,visit_start,display_name}]`, `visit_outcomes:[record...]`, and `booking_flow.visit_outcomes_read:"complete"`, `visit_outcome_write:"append-only-v1"`. The booked visit census must include the displayed week **and** the preceding seven days through now. A complete read includes all relevant correction chains and cannot be inferred from an empty response. If it fails, advertise neither completeness nor a fake zero missing count.

Until `visit_outcomes_read` is `complete`, the Visit outcomes section shows only the calm line "Visit outcomes are not connected yet" and does not raise a page-wide warning. When the read is complete, the amber list names only elapsed visits in the last seven days without an outcome. Other booked visits and history are in a compact fold. Happened is one tap; Did not happen takes one more reason tap. Optional note and quote checkbox are on the same row. An unverified insert blocks further local attempts until a fresh read. A verified insert updates the current envelope when that `booking_key` is still present and retains completion on the live state, so a later `load()` or Booking re-open cannot offer a second root insert for the same key. In-flight controls stay disabled. Corrections remain explicit append-only.

## Offline verification

`tests/fixtures/booking-confirm/index.html` uses synthetic identities, the contract double in `api.js` for flat outcome requests/server-owned responses, independent `sales_booking_approval_write` steps and composed `list_visit_outcomes` reads, fake `opsPost` and CSP `connect-src 'none'`. Dates derive from the current Perth week. The fixture shows a future Tuesday for actionable approvals and a recent visit for outcomes; live initial navigation opens the current week.

Run `npm run test:sales-booking`. Browser evidence in `docs/evidence/booking-confirm-flow-2026-09-21/` covers desktop/phone and independent fake clicks. No backend code, production write, send or deployment is included.

Contract-fix evidence: `docs/evidence/booking-screen-contract-fix-2026-09-22/`. Browser and automated checks use only synthetic fixtures. Backend migration/deployment is a separate authorized lane (ops-api requires `--no-verify-jwt`); no deploy, live append, booking or customer send is performed here. A booked-visit census remains a producer requirement, never inferred from diary occupancy.
