# Trade Mobile App (trade.html)

## Status: BUILT & DEPLOYED (3 March 2026)
**File**: `dashboard/trade.html` (~3,250 LOC)
**Service Worker**: `dashboard/sw-trade.js` (live cache version is its `CACHE_NAME`; bump rule in `gotchas.md`)
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

### All tab — the whole-company job feed
Captain ruling 2026-07-31, server contract in secureworks-backend
`docs/trade-all-means-all-v1.md`: on the All tab "all" means all. Both All-tab
reads go through `search_all_jobs` and share one state object plus one renderer
in `trade.html` (search `// <all-tab-full-feed>`):

- **Empty query** = the company feed. `allJobsFeedActive()` only asks for it when
  the viewer already holds the Everyone lens (`canUseEveryoneLens()`), so an
  installer's All tab remains query-driven. Visibility is not the
  client's to widen: the response must come back with `lens: 'company'` or the
  block says the list is unavailable for this account rather than passing an
  assignment-scoped answer off as every job.
- **Typed query** = authenticated database search for every trade, but only while
  the **All** tab is active. A make-safe hit is openable without an assignment;
  Today, Assigned, This Week, Active, and History only filter the viewer's own
  assignment buckets and never render these global results.
- **Paging** follows the server's `next_offset` — never a client-invented
  `page_size`. `syncGlobalJobFeedPaging()` runs on window scroll and after every
  My Jobs repaint (a first page shorter than the viewport would otherwise wait
  for a scroll that never comes). Rows are deduped by `jobs.id` across pages, so
  one job is one card. The footer (`#globalJobPager`) is always in one of three
  honest states: loading, retryable page failure ("this is not the end of the
  list"), or the end-of-list marker.
- The feed block renders **after** the viewer's own sections — it is endless, so
  their Today/Needs Report work stays above it — while a typed search keeps
  rendering above them as it always did.
- `requestGlobalJobSearch()` returns before touching its debounce timer when the
  same request is already scheduled. Every caller re-renders straight after
  asking and the render asks again; clearing first cancelled the fetch the first
  call had just scheduled, which is why typed All-tab search never left the app.
- Guarded by `tests/e2e/all-jobs-feed.spec.js` (feed paging, server-lens
  authority, installer unchanged, search unchanged).

### Job Detail View
- **Client card**: name, phone (tap-to-call), address + Navigate button (Google Maps directions URL: `www.google.com/maps/dir/?api=1&destination=`)
- **Assignment status buttons**: Confirm → On Site → Complete (with GPS check-in + haptic feedback)
- **Live timer**: ticks every 30s when status is in_progress
- **Crew roster**: every allocated person is listed once (the detail feed may
  repeat a person once per day); the designated lead carries a **LEAD
  INSTALLER** badge and other people remain plain crew members. An explicit
  `leadInstaller: null` is shown as "No lead installer set". If the detail
  payload predates the lead contract, the crew still renders but makes no lead
  claim and offers no lead control.
- **Lead installer**: a dispatcher or manager of the job's vertical may set,
  change, or clear the lead through `set_job_lead`; the server remains the
  authority. This narrow action is also allowed while viewing another crew's
  job read-only. Failed writes leave the roster truthful rather than applying
  an optimistic badge. The shared roster renderer is used by standard detail
  and the make-safe report surface.
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
- Endpoint-specific authorization stays server-owned: authenticated database
  search and MakeSafe detail may read an unallocated make-safe, while assignment
  lifecycle and report writes keep their existing server relationship checks.
- Auth-failure handling distinguishes authorisation from authentication and never logs a signed-in user out on a feed failure:
  - **403** is a role rejection, not an expired session — the same valid JWT is never refreshed and the user is never signed out; the surface shows an in-page "no trade access" state.
  - **401** may be an expired JWT — refreshed once. Read-only feed callers pass `{ preserveSessionOnAuthFailure: true }` to `api()` so a failed refresh prompts explicit re-login in place instead of auto sign-out. Write/action callers that omit the flag still fall back to `handleSessionExpiry()` / `_forceLogout()`.
  - `api()` throws typed errors carrying `status` and a `code` of `access_denied` (403) / `auth_expired` (401) / `request_failed` so surfaces can render the right state.
- Prices stripped from PO line items (trades see items + quantities, not costs)

## Make-Safe Board (Trade v5)
The make-safe experience is driven by the canonical `makesafe_board` read model fetched with `api('makesafe_board', { projection: 'trade' }, null, { preserveSessionOnAuthFailure: true })`, contract `makesafe-board.v1`. The `preserveSessionOnAuthFailure` flag keeps a signed-in user in place when the feed rejects: a 403 (no trade role) or an unrefreshable 401 renders an in-page state instead of logging the user out. The `MakesafeTradeV5` module in `trade.html` (delimited by the `// <makesafe-trade-v5>` markers) validates it and supplies the board read model. Every card now renders through the shared `UnifiedJobCard` grammar (`// <unified-jobcard>` → `.jc-*` CSS, quick-look `.ql-*`, detail header `.dh-*`), which replaced the retired `.tjc-*` v5 board body, the legacy `.ms-*` red-banner run card, and the standard `TradeJobCard` body across every view (board, My Jobs, history, global search, make-safe quick-look, full-job detail header). The primary/Allocate action follows the job-type accent (`var(--jc-a)`), never brand orange. Canonical make-safe columns and action rights remain server-owned: the client never derives them from assignment status or role/name logic. The one search exception is explicitly uncolumned: a typed MakeSafe Board query also uses `search_all_jobs`, filters to make-safe hits absent from the current projection, and renders them under **MakeSafe database matches** so an installer can open an unallocated job without inventing a board stage. The fencing vertical documented below is the one board that maps its own columns, and only over rows the backend already authorized — it never touches make-safe placement.

### Board
- Exactly four columns from the feed: **New**, **Allocated**, **Complete**, **Archive** (no client-side column override; the old assignment-derived `MS_COLUMN_OVERRIDE` / `COLUMNS_MAKESAFE` paths are retired). The server-supplied `column` wins even if an assignment reads `complete`. These four (plus the live **On site** state) are the only status words on any make-safe surface; the fencing vertical below carries its own column labels.
- Cards show make-safe type, suburb, full address, builder/client, refs, primary assignment date/time, crew (or "Nobody allocated"), and latest note. Because the column already names the status, the board card drops the in-column status chip. No pricing or other trades' invoice data is ever rendered on Trade v5 surfaces.
- Board search filters the canonical cards immediately and, from two characters,
  runs the same authenticated `search_all_jobs` plumbing as My Jobs All. Make-safe
  results missing from the assignment-scoped projection render in a separate
  database list and open the MakeSafe report path; they are never assigned a
  client-derived column.
- `validate()` is a hard gate: it rejects a feed whose `contract_version`/`projection` don't match, whose `parity.ok` is not `true`, whose columns don't match the four, that contains a duplicate card id or a column mismatch, or that carries a broken/unstated contact action.
- Load failure is rendered by the shared `MakesafeTradeV5.failureHTML(err, surface, retryCall, wrapperClass)` state renderer (also used by the calendar), which maps the feed error to one of three states, each tagged `data-feed-failure`:
  - **access** (403) — "No trade access for this account" with a "Sign in with another account" button (calls `doLogout()`); no Retry, since retrying a role rejection is pointless.
  - **auth** (unrefreshable 401) — "Please sign in again" with a re-login button; the user's in-progress work is preserved.
  - **transient** (network/5xx) — "Could not load the …" with a **Retry** button (`_loadBoard(true)` for the board, `renderNewCalendar()` for the calendar); the message runs through `friendlyError()`.
  - All three are kept separate from a genuine empty board.

### Fencing board vertical (managed-vertical leads)
- A lead whose `users.managed_verticals` contains `fencing` (e.g. Henry, who stays `role = lead_installer`) also gets a **Fencing** vertical on the same Board, built by `FencingBoardCore` (`// <fencing-board-core>`) from the server-authorized `api('my_jobs', { mode: 'all' })` read. Make-safe placement remains exclusively `MakesafeTradeV5.board(makesafe-board.v1)`; the two verticals are appended side by side and the vertical switcher only renders when the viewer owns more than one.
- Columns are **Ready / Scheduled / On site / Done / Attention / Cancelled** — this vertical's own field-work vocabulary, scoped to the fencing Board. It does not replace or rename make-safe's canonical four (New / Allocated / Complete / Archive), and make-safe's four are never applied here. A dead or finished job status is terminal (Cancelled / Done) whatever the assignment says; an unrecognised assignment status lands in **Attention** and is counted in that vertical's own unmapped-job banner — never hidden, never silently placed in the wrong column.
- Open-pool rows are deduped: a job that already carries an assignment row never reappears as available, duplicate open rows collapse to one card, and a non-fencing job is dropped even if the row claims `assignment_type: fencing_open`. Assigned rows are filtered to the selected week before the one-card-per-job dedupe, so a job with visits in several weeks appears once in every relevant week rather than only beside one globally preferred assignment.
- Ghost `role:'observer'` rows are dropped at `buildBoard`'s row intake (`FencingBoardCore.isObserverRow`, before the pool/assigned split) and counted into `observerRowsDropped`, never silently. An observer row mirrors a job onto an ops manager's own list and is NOT moved when the crew's real assignment is rescheduled; both calendars read the `calendar_events` view (`WHERE is_ghost = false`) so neither sees it, but `my_jobs` returns `job_assignments` raw — and because the one-card-per-job dedupe ranks by `status` alone, a ghost ties with the real crew row and the feed's `scheduled_date`-ascending order hands the tie to the staler date. The predicate matches on `role` (case-insensitive), not `is_ghost`, because the feed does not publish `is_ghost` and the two agree on every live row. Dropped observers can therefore never become a card, a listed crew name, or the row an Allocate write targets. Diagnosis record: `docs/evidence/fencing-board-stale-schedule-2026-08-04/README.md`.
- Allocate on a fencing card requires the viewer to manage `fencing` and the row to be live (`FencingBoardCore.canAllocate`); everything else is view-only. Cards use the same `UnifiedJobCard` grammar as every other job type.
- The fencing board read is cached per user + vertical + lens (`tradeSurfaceCacheKey`) for the same 90s window as the make-safe feed. Allocation and schedule edits refresh immediately. Every successful assignment lifecycle mutation clears the fencing Board and Calendar caches through `_invalidateAssignmentLifecycleCaches()`, so the next entry refetches server truth instead of showing a pre-write stage.
- The fencing Board defaults to the current Perth Monday-Sunday week. Previous, next, This week, and Unscheduled controls filter the complete authorized response in memory without a navigation or refetch. The Board ingests the backend `unscheduled` bucket. Unscheduled is the single home for every null-date assignment and every open-pool row, including production pool rows carrying a synthetic transport date, and shows each one under its own status column (not just Ready). The unmapped-status banner is always counted board-wide, never from the filtered week. On phone widths the six status buttons are direct navigation for a native horizontal, snap-scrolling column pager; week controls are separate buttons and never share the swipe gesture. That pager (markup, CSS and wiring) is scoped to `.tjb-wrap.fencing`; the make-safe Board keeps its stacked columns and plain status counters at every width.
- Tenant narrowing is fail-closed on this widened surface: `FencingBoardCore.isSameOrg` keeps a row the server did not tag, but a row carrying an `org_id` is dropped unless it matches the viewer's `org_id`, including when the viewer profile carries none.
- A successful fencing allocation or schedule edit selects the week containing the saved assignment date, moves to the applicable status, clears the user/vertical/lens caches, and refetches server truth. The open-pool dedupe still prevents the refreshed assignment from appearing twice.

### Coordinated backend dependencies
- **Board completeness:** the UX sends only the published authenticated `my_jobs?mode=all` request and never invents `from`/`to` parameters. The deployed backend now returns the complete same-tenant managed-fencing history, future, `unscheduled` bucket, and authorized open pool. The client preserves that range and applies only the selected Perth week or deliberate Unscheduled lens.
- **Calendar deployment:** the deployed backend recognizes the JWT `trade_calendar` / `trade-calendar.v1` request used here. The client still keeps an honest `unknown action` failure state for release drift; there is no office/static-key fallback.
- **Henry's weekly work-order invoice:** Financial opens the same hub as every other trade. **Weekly Invoice** is the job-centric `generate_trade_invoice` path (`submitJobCentricInvoice` with `gst_on`) — `invoice_type: per_metre` never dead-ends on an empty work-order week, and an email `/henry|emeka/` heuristic is not used. Per-metre cards default to **Work Order** mode: the job's WO allocated amount minus named **Paid to other trades** lines (a work-order pass-through `$` he paid another trade, and/or hourly labour lines). Net on the card is what SecureWorks owes him; the footer shows that net, then one 12% super minus (preview when the hours payload omitted `super_rate`; submit still never sends super figures). This week's invoiceable `my_work_orders?mode=all` rows prefill those cards, including `negative_charges` as pass-through deducts merged by `source_line_id` so a local labour edit cannot drop a server deduction. A match on an existing assignment card still re-renders. A failed hydrate, weekly WO load, or hub read shows Retry. Unmatched per-metre cards stay Hours until they have a real `work_order_id`. Hydrate binds an unbound assignment card only when the work-order completion/schedule date matches that card's day — a later visit of the same job is a separate card. If Henry already typed Hours (or locked Hours) while hydrate was pending — including an in-focus Hours field that DOM sync reads before `onchange` — the card keeps Hours; the WO id still attaches so he can switch explicitly. Job-centric `_jobCards` persist in a user-scoped `sw_inv_draft_<user>` session draft (with `is_per_metre`) and restore on Financial reload for that same authenticated user; logout clears in-memory cards and that user's draft. Restore still fetches `my_hours` so the WO hydrate and submit gate arm once `invoice_type` is known. Identity is the work-order id: a second WO on the same job/day gets its own card. **+ Add amount** is a freeform `{description, amount}` deduct on the job card. **+ Add job** still invoices any other job. The work-order weekly builder remains an extra **Work Order Invoice** door and still calls the published backend contract in `secureworks-backend/docs/trade-weekly-work-order-invoice-contract.md`. That extra door loads `my_work_orders?mode=all&type=fencing&status=complete&page_size=500`, selects work orders by their Perth business date, and sends only work-order IDs, acknowledged crew-charge line IDs, direct-labour user IDs/hours, and explicit final payout deductions. A work-order hub or Cost Breakdown entry that `can_add_to_weekly_invoice` opens that order's Perth week and preselects it. An empty week offers **Invoice jobs**, which is the same job-centric builder. `save_trade_invoice_draft` must return complete matching job blocks plus finite server-owned totals before Submit unlocks; stale save responses cannot replace a newer week or edit revision. `generate_trade_invoice` revalidates the same source selections and creates the Xero draft. The browser never submits scope prices, crew amounts, direct-labour rates, job subtotals, grand total, or TO BE PAID. A `weekly_work_order` draft/detail is rendered by `source_work_order_id`, preserving separate work orders on the same job. `XERO_PUSH_FAILED` means the local invoice exists and must not be submitted again.
- **`my_work_orders` tenant/vertical fields:** the Work Order hub and the job-detail Cost Breakdown both read `my_work_orders?mode=all` (same managed-vertical widen as the weekly builder) so unassigned managed WOs appear. Cost Breakdown filters that widened list through `workOrdersForViewer` (tenant + managed-vertical lens) and matches only the viewed `work_order_id` — it never attaches another WO on the same job. A same-tenant patio WO is not invoiceable from a fencing lead's job detail. Authorization for `invoiceWorkOrder` is that authenticated, lens-filtered response itself — every surface that can reach `submit_work_order_invoice` registers the order it renders from its own read, so a hub visit is never a precondition for the ordinary job-detail invoice. `invoiceWorkOrder` always sends `gst_on` (`GST_CHOICE_REQUIRED` is a missing-choice 422, not a rate problem). On top of that server truth the client narrows only on fields the server actually supplies: `org_id` (tenant, `workOrderTenantOk` — untagged passes, tagged must match the viewer, and a viewer with no `org_id` fails closed on admin/managed-vertical surfaces while ordinary own-only responses still render) and a canonical vertical (`workOrderVertical` reads `job_type`, else `vertical`, else nested `jobs.type` — and nothing else; a bare `type` on a work-order row is a document/work-order kind in this codebase, never a job vertical, so it is deliberately not in the chain). Both are **optional today**: an order with no canonical vertical is kept rather than dropped, so a response without `job_type` degrades to the existing server-authorized own-only list instead of an empty hub, while managed cross-job access stays fail-closed through the tenant guard and the server's own scoping. For the managed-fencing hub to be authoritative rather than best-effort, the backend must return an explicit per-row `org_id` and one of those canonical vertical fields, or expose tenant/vertical-scoped `my_work_orders` parameters.

### Pay tab — Work Order mode labour lines (reconciliation and direct billing)
- A WO-mode job card on the Pay tab invoice builder carries `wo_allocated` plus structured deduct lines (`wo_labour_lines` and `wo_lump_lines`). Hourly crew lines stay `{trade_name, hours, rate, amount}`. Work-order amounts Henry pays other trades are `{trade_name, line_kind: 'wo_pass_through', amount}` (prefilled from `negative_charges` when the job-centric builder hydrates `my_work_orders`). Freeform job deducts are `{description, amount, line_kind: 'lump_sum'}`. The holder's payable line is always **net = WO allocated − Σ deducts**; hourly prose stays `WO $559.5 − labour [Tendo 11.5h×$25=$287.5]=net $272`, pass-throughs add `− WO trades [Israel $40]`, and lump sums add `− other [Materials $10]`.
- The structured lines are the money contract, not decoration: ops-api `generate_trade_invoice` persists them on the holder's `trade_invoice_lines` row for office reconciliation. The labour is deducted from the holder's invoice and shown to the office; each named crew member bills SecureWorks Group directly. No automatic payout invoice is created for the named crew.
- Because a line attributes a deduction to a person, the payload builder cleans and validates it: names are trimmed/whitespace-collapsed (`_woCleanLabourLines` — production had "Tendo  " ≠ "Tendo"), untouched "+ Add labour line" template rows are dropped, a line carrying money must name someone, and a named line must carry hours > 0 and rate > 0. Legacy payout response fields remain presentation-only compatibility data: when present, the success screen uses them to restate the deduction and direct-billing rule, never to promise an office payment.
- Regression guard: `scripts/test-trade-wo-labour-lines.js` (runs in PR CI) executes the `[JC-PAYLOAD-BUILD-START..END]` block and pins the captain's reported case (WO $559.50, Tendo 11.5h×$25, net $272) plus multi-labourer, cleaning, attribution, and validation behaviour. The backend counterpart in secureworks-backend pins reconciliation storage without automatic payout creation.

### Builder & type (feed truth)
- The make-safe board feed is the single source of truth for the builder name and make-safe type on **every** surface. Board cards, My Jobs cards, the job detail builder panel, the report work-order panel, and the job hero all resolve them through `getTradeMakesafeBuilderName(job)` / `getTradeMakesafeTypeLabel(job)`, which look up the job's `makesafe-board.v1` row (`getMakesafeFeedRow` matches by job id, then job number) and return `row.builder.name` / `row.makesafe_type`.
- The old client-side derivation (`requesting_company_name`, company name/slug, notes/scope regex) survives only as the `getLegacyTradeMakesafe*` fallbacks, used **only** when the job has no feed row. While a feed fetch is still in flight (`_makesafeV5FeedPromise` is set) the client shows a generic `MakeSafe` type and an empty builder rather than guessing.
- The site occupant/homeowner (`job.client_name`) is never rendered as the builder on any surface — every `requesting_company … || job.client_name` fallback chain was removed.
- My Jobs (`renderMyJobs`) and the direct MakeSafe report path prime the feed (`fetchMakesafeV5Feed(false)`) alongside their own data, then re-render so cards swap from the legacy fallback to feed facts without changing markup.

### Reattendance and report cycles
- After an assigned trade has submitted a MakeSafe report, that trade can choose **Create reattendance report**, enter the required reason, and start the next attendance cycle. The server re-checks the caller's assigned-trade, dispatcher, or managed-vertical relationship; the client does not widen authority. The action opens a separate blank report for the new visit with its own attendance-cycle photo gate (five confirmed photos required).
- Reattendance keeps the existing job card and prior report intact. Cancellation remains manager-only, and this flow does not create or calculate a charge.

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
- `allocated_only` limits the canonical board/calendar rows, not findability:
  typed All and MakeSafe Board database search may surface another make-safe for
  read/open. This does not grant Allocate or any write authority.
- The My Jobs lens (`#adminJobToggle`, labelled **Everyone** / **Mine**) is offered to dispatchers (`admin` / `ops_manager`) and to managed-vertical leads; ops managers and managed leads open on Everyone, global admins still opt in. It only chooses the `mode` sent to `my_jobs` — an authorization request the backend answers with its own tenant/vertical set, never a client-side widening. An ordinary installer gets no toggle and stays own-only. The open MakeSafe pool fallback (`loadMakesafePoolJobs`) remains dispatcher-only, and for a fencing lead the open-pool section is labelled **Fencing Ready for Crew** rather than Open MakeSafe Jobs.
- Visibility is not authority: when the crew on a job is somebody else, the detail view renders view-only (`// <foreign-job-readonly>` → `#jobViewOnlyBanner`) with no clock/accept actions and no note, photo, comms, crew-charge or work-order invoice controls, and `blockedForeignJobWrite` rejects such a write inside `api()` before it reaches the network or the offline retry queue. Make-safe detail keeps its own server-driven authority model and is untouched by this gate.

### Tests
- `scripts/test-trade-crew-lead-core.js` locks the roster contract against the
  shipped `trade.html`: day-row collapsing, explicit `is_lead` truth, the
  distinct no-lead versus legacy-payload states, and the server-authority
  mirror for the lead control. `tests/e2e/trade-crew-lead.spec.js` covers the
  installer and managed-manager detail flows, refused writes, legacy payloads,
  and full crew names on make-safe cards. The core check runs as part of
  `npm run test:e2e`.
- `scripts/test-makesafe-trade-v5.js` exercises the feed contract, column ordering, contact-action rendering across every surface, calendar modes, permission gating, and the duplicate/parity/broken-action failure gates. It runs in PR CI (`.github/workflows/pr-check.yml`).
- It also runs a mocked auth-regression suite (against the extracted `// <trade-api-helper>` block) asserting that a feed **403**, a repeated **401**, and a transient failure never invoke `_forceLogout()`/`handleSessionExpiry()`, that a 403 does not refresh a valid JWT, that a 401 refreshes exactly once, and that `failureHTML` renders the matching access/auth/transient states.
- `scripts/test-fencing-manager-visibility.js` guards the managed-vertical lead contract against the extracted `// <trade-visibility-core>`, `// <trade-calendar-source>` and `// <fencing-board-core>` blocks: the Everyone lens is granted by `managed_verticals` (not by role) and denied to an ordinary installer, caches split by identity / vertical / lens, the fencing board dedupes stale and duplicate open rows, excludes an explicitly foreign tenant row, filters before per-week dedupe for multi-week jobs, ingests backend-unscheduled rows, classifies synthetic-date pool rows as Unscheduled, and keeps unknown statuses visible in Attention with a board-wide job count. It also guards lifecycle cache invalidation, `// <trade-workorder-auth>` tenant/vertical rules, the fencing-only phone pager, and strict `trade-calendar.v1` validation. It runs in PR CI. The end-to-end counterpart is `tests/e2e/fencing-manager-visibility.spec.js` (see `README-tests.md`), including production-shaped multi-week, Unscheduled, and Accept/Clock On/Clock Off refresh coverage.
- `scripts/test-fencing-board-ghost-rows.js` replays the live 2026-08-04 stale-schedule rows (ghost-first feed order preserved — the condition that produced the bug) against the extracted `// <fencing-board-core>` block: a drag-rescheduled job's board card reads the crew row's date, never the stale `role:'observer'` date; a job moved to another week leaves no ghost card behind in the old week; every card date equals the `calendar_events` date; an observer never becomes a card's row or a listed crew name; and dropped rows are counted into `observerRowsDropped`. It runs in PR CI (`.github/workflows/pr-check.yml`). Diagnosis record: `docs/evidence/fencing-board-stale-schedule-2026-08-04/README.md`.
- `scripts/test-trade-makesafe-feed-truth.js` proves builder/type feed truth: against audited sample jobs (SWMS-26888, SWMS-26953, SWMS-26919) it asserts the feed row wins over conflicting legacy fields, the homeowner can never become the builder, an existing feed row with no builder/type does not fall back to legacy or regex, the legacy derivation still applies for jobs absent from the feed, no derivation runs while the feed is in flight, and every surface (My Jobs, hero, detail, report work order, board card) consumes the feed. It also runs in PR CI.
- `tests/e2e/trade-weekly-work-order-invoice.spec.js` reproduces invoice #31 without a live Xero call: nine work-order blocks, the exact nine job subtotals, `$5,163.40` grand total, `$350.00` Car Loan deduction, and `$4,813.40` TO BE PAID. It also proves the browser payload contains source selections and hours but no aggregate money or direct-labour rate, that saved drafts reopen without flattening their blocks, and that the flow remains usable at 390px.

## ops-api Trade Endpoints (JWT auth required)
| Action | Method | Purpose |
|--------|--------|---------|
| `my_jobs` | GET | Jobs assigned to authenticated user, grouped by date; `mode=all` returns the server-authorized set for a dispatcher or managed-vertical lead |
| `trade_calendar` | GET | Field calendar rows for one vertical, contract `trade-calendar.v1`; params `from`, `to`, `mode=mine\|all`, `type=fencing` |
| `trade_job_detail` | GET | Full job view: client, docs, media, notes, POs, crew, lead installer projection, work order, report |
| `set_job_lead` | POST | Set, change, or clear the designated lead installer for a job (server-authorized dispatcher or job-vertical manager) |
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
