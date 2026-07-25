# Trade Mobile App (trade.html)

## Status: BUILT & DEPLOYED (3 March 2026)
**File**: `dashboard/trade.html` (~3,250 LOC)
**Service Worker**: `dashboard/sw-trade.js` (cache v3)
**Manifest**: `dashboard/manifest.json` (PWA installable)
**User**: Field installers (Henry, Isaac, etc.)
**Auth**: Supabase magic link via cloud.js
**API**: `ops-api` edge function (trade endpoints use JWT auth)

## Bottom Nav (3 tabs)
1. **My Jobs** — assigned jobs grouped: Today / This Week / Upcoming / Recent
2. **Job** (enabled when job selected) — full job detail
3. **Report** (enabled when job selected) — service report with signature

## Features Built

### My Jobs View
- Today's summary card (dark, shows job count + weather)
- Weather widget (Open-Meteo API, Perth -31.95/115.86, 30-min cache)
- Job cards with: client name, suburb, type badge, date, status pill
- Quick action icons on cards: phone (tap-to-call), navigate (Google Maps directions)
- Pull-to-refresh with 2-second throttle
- Empty state with icon

### Job Detail View
- **Client card**: name, phone (tap-to-call), address + Navigate button (Google Maps directions URL: `www.google.com/maps/dir/?api=1&destination=`)
- **Assignment status buttons**: Confirm → On Site → Complete (with GPS check-in + haptic feedback)
- **Live timer**: ticks every 30s when status is in_progress
- **Crew section**: who else is assigned today
- **Work order**: structured scope items + special instructions + PDF link
- **Materials / Purchase Orders**: PO cards with status badges, line items, delivery dates
  - Draft POs show lock icon: "PO not yet approved — do not purchase"
  - Approved POs show "Add Receipt Photo" button
  - Receipt thumbnails grouped per PO
- **Photos**: Before/After comparison grid, scope photos, completion photos
  - Photo grid collapses at 6+ with "Show more" toggle
  - Lightbox with swipe navigation + arrow keys + counter
- **Completion photo upload**: via signed URL (get_upload_url → PUT → confirm_upload)
  - Client-side image compression (max 1600px, 0.7 JPEG quality)
  - Sequential upload for weak signal
  - Progress bar with file counter
- **Notes timeline**: all notes + input with auto-resize textarea
  - Voice-to-text (Web Speech API, en-AU, continuous recognition)
  - Double-tap prevention on Send button
  - Pending offline notes shown with "Pending sync" label

### Service Report View
- Completion checklist (loaded from org_config per job type)
- Completion notes textarea
- Photo upload for completion phase
- **Signature pad**: HTML5 Canvas with touch-action:none
  - Clear button with confirmation dialog
  - Placeholder text "Sign here"
- Homeowner name text input
- Submit button with custom confirmation dialog
- Save Draft (offline-first: localStorage then server sync)
- **Form preservation**: switching between Job/Report tabs preserves in-progress form
- **Unsaved changes warning**: navigating away from dirty report prompts confirmation
- **Shared report link**: generates public URL via share_token for homeowner viewing

### Receipt Capture (PO-linked)
- Receipt photos linked to specific purchase order via `po_id` column on `job_media`
- Phase = 'receipt' distinguishes from scope/completion photos
- Only approved POs (status=authorised/billed) show upload button
- Creates `receipt_added` event in job timeline
- Migration 015 adds: receipt phase to job_media constraint + po_id FK column

### Offline & PWA
- Service worker caches app shell (trade.html, brand.js, cloud.js, supabase CDN)
- Offline indicator bar (red banner)
- Notes saved to localStorage when offline, synced on reconnect
- Draft reports saved to localStorage
- iOS safe areas (notch/Dynamic Island): `env(safe-area-inset-top)` / `env(safe-area-inset-bottom)`
- iOS keyboard handling (hides bottom nav when keyboard is up)
- Android back button support via `history.pushState`

### Auth & Security
- JWT auth on all trade endpoints (via `authTrade` in ops-api)
- `assertAssigned` check — trades can only access jobs they're assigned to
- Auth-failure handling distinguishes authorisation from authentication and never logs a signed-in user out on a feed failure:
  - **403** is a role rejection, not an expired session — the same valid JWT is never refreshed and the user is never signed out; the surface shows an in-page "no trade access" state.
  - **401** may be an expired JWT — refreshed once. Read-only feed callers pass `{ preserveSessionOnAuthFailure: true }` to `api()` so a failed refresh prompts explicit re-login in place instead of auto sign-out. Write/action callers that omit the flag still fall back to `handleSessionExpiry()` / `_forceLogout()`.
  - `api()` throws typed errors carrying `status` and a `code` of `access_denied` (403) / `auth_expired` (401) / `request_failed` so surfaces can render the right state.
- Prices stripped from PO line items (trades see items + quantities, not costs)

## Make-Safe Board (Trade v5)
The make-safe experience is driven by a single canonical read model — the `makesafe_board` feed fetched with `api('makesafe_board', { projection: 'trade' }, null, { preserveSessionOnAuthFailure: true })`, contract `makesafe-board.v1`. The `preserveSessionOnAuthFailure` flag keeps a signed-in user in place when the feed rejects: a 403 (no trade role) or an unrefreshable 401 renders an in-page state instead of logging the user out. The `MakesafeTradeV5` module in `trade.html` (delimited by the `// <makesafe-trade-v5>` markers) validates it and supplies the board read model. Every card now renders through the shared `UnifiedJobCard` grammar (`// <unified-jobcard>` → `.jc-*` CSS, quick-look `.ql-*`, detail header `.dh-*`), which replaced the retired `.tjc-*` v5 board body, the legacy `.ms-*` red-banner run card, and the standard `TradeJobCard` body across every view (board, My Jobs, history, global search, make-safe quick-look, full-job detail header). The primary/Allocate action follows the job-type accent (`var(--jc-a)`), never brand orange. Every make-safe view state is server-owned: the client never derives make-safe columns, visibility, or action rights from assignment status or from role/name logic. The fencing vertical documented below is the one board that maps its own columns, and only over rows the backend already authorized — it never touches make-safe placement.

### Board
- Exactly four columns from the feed: **New**, **Allocated**, **Complete**, **Archive** (no client-side column override; the old assignment-derived `MS_COLUMN_OVERRIDE` / `COLUMNS_MAKESAFE` paths are retired). The server-supplied `column` wins even if an assignment reads `complete`. These four (plus the live **On site** state) are the only status words on any make-safe surface; the fencing vertical below carries its own column labels.
- Cards show make-safe type, suburb, full address, builder/client, refs, primary assignment date/time, crew (or "Nobody allocated"), and latest note. Because the column already names the status, the board card drops the in-column status chip. No pricing or other trades' invoice data is ever rendered on Trade v5 surfaces.
- `validate()` is a hard gate: it rejects a feed whose `contract_version`/`projection` don't match, whose `parity.ok` is not `true`, whose columns don't match the four, that contains a duplicate card id or a column mismatch, or that carries a broken/unstated contact action.
- Load failure is rendered by the shared `MakesafeTradeV5.failureHTML(err, surface, retryCall, wrapperClass)` state renderer (also used by the calendar), which maps the feed error to one of three states, each tagged `data-feed-failure`:
  - **access** (403) — "No trade access for this account" with a "Sign in with another account" button (calls `doLogout()`); no Retry, since retrying a role rejection is pointless.
  - **auth** (unrefreshable 401) — "Please sign in again" with a re-login button; the user's in-progress work is preserved.
  - **transient** (network/5xx) — "Could not load the …" with a **Retry** button (`_loadBoard(true)` for the board, `renderNewCalendar()` for the calendar); the message runs through `friendlyError()`.
  - All three are kept separate from a genuine empty board.

### Fencing board vertical (managed-vertical leads)
- A lead whose `users.managed_verticals` contains `fencing` (e.g. Henry, who stays `role = lead_installer`) also gets a **Fencing** vertical on the same Board, built by `FencingBoardCore` (`// <fencing-board-core>`) from the server-authorized `api('my_jobs', { mode: 'all' })` read. Make-safe placement remains exclusively `MakesafeTradeV5.board(makesafe-board.v1)`; the two verticals are appended side by side and the vertical switcher only renders when the viewer owns more than one.
- Columns are **Ready / Scheduled / On site / Done / Attention / Cancelled** — this vertical's own field-work vocabulary, scoped to the fencing Board. It does not replace or rename make-safe's canonical four (New / Allocated / Complete / Archive), and make-safe's four are never applied here. A dead or finished job status is terminal (Cancelled / Done) whatever the assignment says; an unrecognised assignment status lands in **Attention** and is counted in that vertical's own unmapped-job banner — never hidden, never silently placed in the wrong column.
- Open-pool rows are deduped: a job that already carries an assignment row never reappears as available, duplicate open rows collapse to one card, and a non-fencing job is dropped even if the row claims `assignment_type: fencing_open`.
- Allocate on a fencing card requires the viewer to manage `fencing` and the row to be live (`FencingBoardCore.canAllocate`); everything else is view-only. Cards use the same `UnifiedJobCard` grammar as every other job type.
- The fencing board read is cached per user + vertical + lens (`tradeSurfaceCacheKey`) for the same 90s window as the make-safe feed; a Board write drops the fencing board and calendar caches via `_refreshBoardSilent()`.

### Builder & type (feed truth)
- The make-safe board feed is the single source of truth for the builder name and make-safe type on **every** surface. Board cards, My Jobs cards, the job detail builder panel, the report work-order panel, and the job hero all resolve them through `getTradeMakesafeBuilderName(job)` / `getTradeMakesafeTypeLabel(job)`, which look up the job's `makesafe-board.v1` row (`getMakesafeFeedRow` matches by job id, then job number) and return `row.builder.name` / `row.makesafe_type`.
- The old client-side derivation (`requesting_company_name`, company name/slug, notes/scope regex) survives only as the `getLegacyTradeMakesafe*` fallbacks, used **only** when the job has no feed row. While a feed fetch is still in flight (`_makesafeV5FeedPromise` is set) the client shows a generic `MakeSafe` type and an empty builder rather than guessing.
- The site occupant/homeowner (`job.client_name`) is never rendered as the builder on any surface — every `requesting_company … || job.client_name` fallback chain was removed.
- My Jobs (`renderMyJobs`) and the direct MakeSafe report path prime the feed (`fetchMakesafeV5Feed(false)`) alongside their own data, then re-render so cards swap from the legacy fallback to feed facts without changing markup.

### Calendar
- `caFetchCalendarModel` routes on `NC.type`: make-safe reads only the `makesafe_board` feed (the legacy `api('calendar')` feed is gone), and fencing crosses the strict `TradeCalendarSource` adapter (`// <trade-calendar-source>`). There is no third transport.
- The fencing transport consumes exactly one published contract: `GET ops-api?action=trade_calendar` with `from`, `to`, `mode` (`mine` | `all`) and `type=fencing`, JWT-authenticated through `api()` with `{ preserveSessionOnAuthFailure: true }`. `adaptV1` hard-rejects a payload whose `schema` is not `trade-calendar.v1`, whose effective `mode` is neither `mine` nor `all`, whose `type` or any event `job_type` falls outside the requested fencing vertical, or which omits `events[]` / `truncated`. `truncated: true` paints an explicit "reached the server limit" warning above the calendar. With no source registered the host renders a `data-calendar-state="contract-pending"` state rather than guessing rows.
- Mine/Everyone `scope` is a presentation lens for make-safe, but for fencing it is sent as the authorized `mode` and the server's effective mode wins (`NC.scope` is re-synced from the response). The model is keyed by user + vertical + lens (`NC.modelKey`), so a lens or trade switch refetches instead of repainting the previous payload, and the Everyone chip is hidden from a viewer who is neither a dispatcher nor a managed-vertical lead. The Trade chip list only offers a vertical the viewer manages.
- Crew-axis and job-axis modes, each at Day / Week / Month scale, plus a run sheet. Job-based **Today** is the boot default (`NC = { calView: 'cal', scale: 'day', axis: 'jobs', ... }`). On login `applyTradeVisibilityDefaults()` points `NC.type` at the viewer's primary managed vertical (fencing for a fencing lead, otherwise make-safe) and sets `NC.scope` to Everyone only when that viewer may use the lens; Reset in the filter sheet returns to the same defaults.
- Keeps a **Nobody** row and surfaces undated work as "no day set" without inventing a date.
- Crew, day, and arrival time are set through the guarded **Allocate** sheet; the calendar repaints on allocate. The roster is multi-select: confirming several people fires one `allocate_job` write per pick (create-per-person for New/pool jobs; reassign the primary plus create for the rest on Allocated jobs), while a single pick keeps the optimistic single-write path.

### Contact actions (Call / Navigate / Text)
- Every board card, job detail, and calendar card/sheet renders the exact `contact.actions` links supplied by the feed (`call` → `tel:`, `text` → `sms:`, `navigate` → an `https:` maps URL), tagged `data-feed-href="true"`.
- When an action is unavailable the feed's explicit `unavailable_reason` is shown on a disabled (`aria-disabled`) control — the client never fabricates a link.
- Roof-report portal links render via `portalHTML()` only when the feed exposes a report portal URL.

### Permissions
- Action rights come from `permissions` on the feed: board buttons key off `_boardCache.permissions.can_allocate`, calendar actions off `NC.model.permissions` (`ncBoardAllowed()`). A server-filtered `allocated-only` trade still sees the board.
- Visibility (`allocated_only` / `all_makesafes`), `can_allocate`, and view-only flags (e.g. Khairo's fencing view-only, `can_allocate=false`) are honoured as delivered — never recomputed client-side.
- The My Jobs lens (`#adminJobToggle`, labelled **Everyone** / **Mine**) is offered to dispatchers (`admin` / `ops_manager`) and to managed-vertical leads; ops managers and managed leads open on Everyone, global admins still opt in. It only chooses the `mode` sent to `my_jobs` — an authorization request the backend answers with its own tenant/vertical set, never a client-side widening. An ordinary installer gets no toggle and stays own-only. The open MakeSafe pool fallback (`loadMakesafePoolJobs`) remains dispatcher-only, and for a fencing lead the open-pool section is labelled **Fencing Ready for Crew** rather than Open MakeSafe Jobs.
- Visibility is not authority: when the crew on a job is somebody else, the detail view renders view-only (`// <foreign-job-readonly>` → `#jobViewOnlyBanner`) with no clock/accept actions and no note, photo, comms, crew-charge or work-order invoice controls, and `blockedForeignJobWrite` rejects such a write inside `api()` before it reaches the network or the offline retry queue. Make-safe detail keeps its own server-driven authority model and is untouched by this gate.

### Tests
- `scripts/test-makesafe-trade-v5.js` exercises the feed contract, column ordering, contact-action rendering across every surface, calendar modes, permission gating, and the duplicate/parity/broken-action failure gates. It runs in PR CI (`.github/workflows/pr-check.yml`).
- It also runs a mocked auth-regression suite (against the extracted `// <trade-api-helper>` block) asserting that a feed **403**, a repeated **401**, and a transient failure never invoke `_forceLogout()`/`handleSessionExpiry()`, that a 403 does not refresh a valid JWT, that a 401 refreshes exactly once, and that `failureHTML` renders the matching access/auth/transient states.
- `scripts/test-fencing-manager-visibility.js` guards the managed-vertical lead contract against the extracted `// <trade-visibility-core>`, `// <trade-calendar-source>` and `// <fencing-board-core>` blocks: the Everyone lens is granted by `managed_verticals` (not by role) and denied to an ordinary installer, caches split by identity / vertical / lens, the fencing board dedupes stale and duplicate open rows and keeps unknown statuses visible in Attention with a per-vertical job count, and `trade-calendar.v1` rejects a wrong schema, vertical or missing `truncated`. It runs in PR CI. The end-to-end counterpart is `tests/e2e/fencing-manager-visibility.spec.js` (see `README-tests.md`).
- `scripts/test-trade-makesafe-feed-truth.js` proves builder/type feed truth: against audited sample jobs (SWMS-26888, SWMS-26953, SWMS-26919) it asserts the feed row wins over conflicting legacy fields, the homeowner can never become the builder, an existing feed row with no builder/type does not fall back to legacy or regex, the legacy derivation still applies for jobs absent from the feed, no derivation runs while the feed is in flight, and every surface (My Jobs, hero, detail, report work order, board card) consumes the feed. It also runs in PR CI.

## ops-api Trade Endpoints (JWT auth required)
| Action | Method | Purpose |
|--------|--------|---------|
| `my_jobs` | GET | Jobs assigned to authenticated user, grouped by date; `mode=all` returns the server-authorized set for a dispatcher or managed-vertical lead |
| `trade_calendar` | GET | Field calendar rows for one vertical, contract `trade-calendar.v1`; params `from`, `to`, `mode=mine\|all`, `type=fencing` |
| `trade_job_detail` | GET | Full job view: client, docs, media, notes, POs, crew, work order, report |
| `add_note` | POST | Add note to job timeline (via job_events) |
| `upload_photo` | POST | Upload photo (base64 dataUrl) — supports po_id for receipts |
| `get_upload_url` | POST | Get signed upload URL for direct storage upload |
| `confirm_upload` | POST | Register media record after direct upload — supports po_id |
| `submit_service_report` | POST | Save checklist + notes + signature (draft or submitted) |
| `get_service_report` | GET | Load existing report for a job |
| `update_my_assignment` | POST | Change own assignment status (confirm/in_progress/complete) + GPS |
| `view_shared_report` | GET | **Public (no auth)** — rendered HTML page for homeowner via share_token |

## Database (Migrations 011, 013, 014, 015)
- **011**: `job_service_reports` table (checklist_json, signature_data, signature_name, status)
- **013**: Time tracking on `job_assignments` (started_at, completed_at)
- **014**: `share_token` on `job_service_reports` (for public report link)
- **015**: `receipt` added to `job_media.phase` constraint + `po_id` FK to purchase_orders

## GPS Check-in
- `navigator.geolocation.getCurrentPosition()` on status changes (in_progress, complete)
- 5-second timeout, graceful fallback if denied
- Stored in `job_events.detail_json.location` (lat, lng, accuracy)

## Known Issues / TODO

### BLOCKING — Login not loading jobs
After login, the My Jobs view shows spinner but jobs don't load. Root cause is likely the `INITIAL_SESSION` bug in cloud.js (see gotchas.md). The `onAuthStateChange` handler only catches `SIGNED_IN`, not `INITIAL_SESSION` which Supabase v2 fires for existing sessions. **Fix needed in `tools/shared/cloud.js` line ~201** — add `|| event === 'INITIAL_SESSION'` to the condition. This affects ALL dashboards, not just Trade.

There are also debug `console.log` statements in trade.html that should be removed once the login issue is resolved:
- Line ~1355: `console.log('[trade] onLogin called...')`
- Line ~1490: `console.log('[trade] loadMyJobs...')`
- Line ~1493: `console.log('[trade] my_jobs response...')`

### Test data in production
3 test assignments were created for Marnin (user ID `706c5258-70dd-483a-b36c-af6864b24498`):
- 2026-03-03: job `b80f0cd4-8d94-4cf2-91f0-22decb614f6c` (Jody Saxon, patio)
- 2026-03-04: job `dcfebb71-2277-4328-bfe8-279715390eea` (Christine Emerson, patio)
- 2026-03-05: job `a03be576-f737-4e0f-8104-90d9729435f5` (Mikaela Cross, patio)
These can be deleted after testing.

### Other TODO
- Magic link redirect: cloud.js `sendMagicLink` redirect URL for `file:` protocol points to `index.html` not `trade.html` — only affects local `file://` testing, works fine on localhost/production
- No push notifications yet (would need Firebase or similar)
- No offline job cache (only notes and drafts cache offline, job list requires network)
- EzyBills integration researched but deferred — simple in-app receipt capture built instead. EzyBills (AU$25/mo) has REST API for OCR + Xero PO matching if needed later
- `site_address` and `site_suburb` are NULL on most jobs (GHL sync doesn't pull address). Navigate buttons and suburb labels will be empty until address data is backfilled
- Service worker cache is at v3 — bump on every trade.html change

## Business Process: PO → Receipt Flow
The user (Marnin) wants this enforced: **no approved PO = no purchase allowed**.
1. Ops creates PO in ops dashboard (or synced from Xero)
2. PO gets approved (via Xero workflow → status becomes `authorised`)
3. Trade sees approved POs on their job in the app
4. Draft POs show lock icon: "PO not yet approved — do not purchase"
5. Approved POs show "Add Receipt Photo" button
6. Trade buys materials per PO, photographs receipt → linked to PO
7. Ops can verify receipt matches PO in job detail
8. Bookkeeper enters into Xero with proper job/project coding
