# Playwright E2E template

This suite is the SecureWorks Group copyable pattern for static HTML tools. It runs on every pull request and covers the Trade App's and Ops Dash's highest-value read-only flows in Chromium, plus Ops Dash calendar coverage: a pure-node unit spec for the working-day date math and a real-pointer drag regression spec.

## What runs

```bash
npm ci
npx playwright install chromium
npm run test:e2e
```

`playwright.config.js` starts a local static server automatically. Set `E2E_BASE_URL` to test an already-served deployment instead.

Covered flows (Trade App and Ops Dash):

1. Login UI renders and bad credentials produce a stable inline rejection.
2. A signed-in user stays signed in when the read-only calendar feed returns 403, guarding the PR 207 logout-loop regression.
3. An authenticated allocator sees the four make-safe columns and fixture jobs.
4. A make-safe card opens its detail sheet.
5. The allocator can open the allocation sheet. The test does not confirm it.
6. The allocation sheet's primary Allocate button follows the job-type accent, not brand orange (captain ruling).
7. An authenticated installer sees My Jobs and can open a standard job detail.
8. A make-safe manager's board is board-wide: they see every card, unallocated AND allocated (captain ruling 2026-07-22), and can allocate. Captures 1440px/390px board screenshots to `test-results/manager-view/`.
9. A non-manager's make-safe board is view-only: no Allocate action (`can_allocate:false`).
10. A make-safe final report gates on persisted `job_media` photos: only confirmed `type: photo` uploads count, the visible photo count refreshes as uploads confirm without discarding the in-progress form, and a submitted report is attributed to the signed-in trade (`userId`).
11. A managed fencing lead (`role: lead_installer`, `managed_verticals: ["fencing"]`) keeps that exact authority while the Board navigates Perth weeks plus Unscheduled work, renders historical/current/far-future fencing fixtures, and excludes other-tenant/other-vertical rows. Production-shaped multi-week fixtures prove SWF-26004/SWF-26033-class jobs appear once in every relevant week. The backend `unscheduled` bucket and synthetic-date open-pool rows both land under the deliberate Unscheduled choice. One Ready job is allocated through a single intercepted `allocate_job` write before refetching into its chosen week. Accept, Clock On, and Clock Off fixture writes each invalidate the Board and Calendar caches; the next Board entry refetches and moves the own job through Scheduled, On site, and Done. At 390px and 360px, touch-sourced swipes and direct status taps reach all six snap-scrolling columns without changing the week or breaking page width; desktop remains the stacked Board. My Jobs and Calendar retain Everyone/Mine, including the strict `trade-calendar.v1` request and a visible `unknown action` failure fixture. An empty invoice week opens only the existing authorized fencing work-order flow; tests do not submit a financial write. Another crew's job detail remains view-only, while Henry's own job keeps its crew actions.
12. A make-safe card renders a server-provided Captain action message inline with HTML escaped, and shows a visible `Waiting on Captain` state when the server stage is unavailable; a valid server stage without an action does not show the warning.
13. An assigned trade can start a MakeSafe reattendance with a required reason, land in a blank visit-two report with a fresh five-photo gate, and remain subject to server-side relationship authorization; the same spec proves cancellation remains manager-only.
14. Ops keeps one MakeSafe job card while listing and opening each attendance-cycle report, and the isolated browser fixture proves each report shows only its bound photos.
15. The Ops Dash calendar Schedule view never superimposes two job bars: an inverted-span assignment (`scheduled_end` before `scheduled_date`) still renders with a valid width, clamped to a single day at its start, while a tidy week keeps non-overlapping bars sharing one lane, crew badges attached to their own bar, and long client names ellipsized inside their bars.
16. The All tab means all: a company viewer/manager with an empty query gets the whole-company feed, paged in on scroll through `next_offset` (three fixture pages, 90 jobs, one card per job) and stopping at an explicit end-of-list marker. The server stays the authority — a response whose `lens` is not `company` is never painted as the feed — and an installer still never requests the empty company feed. `tests/e2e/trade-makesafe-search-visibility.spec.js` adds the trade path: typed All and MakeSafe Board search find and open an unallocated make-safe through authenticated database search, while the same query on Today triggers no global read and renders no unassigned job.
17. An inverted-span assignment never silently vanishes from the other Ops Dash calendar surfaces: it renders in the Crew view on its start day, is counted by the summary conflict counter, and lands on the make-safe crew planner. The same spec proves `CalOpsCore.spanEnd` leaves every well-formed span untouched, and — with the browser pinned to Australia/Perth (UTC+8) — that the assignment form's duration sync serialises its computed end date in LOCAL time, so it cannot mint an inverted span. The Schedule-modal create path is covered by the Perth describe in `cal-drag-real-input.spec.js` instead.
18. The Ops Dash make-safe canonical-board contract is covered by `tests/e2e/ops-makesafe-canonical-board.spec.js`; see `AGENTS.md` for the authoritative board behavior and the evidence README for the verification record.
19. The Ops Dash make-safe job detail states the canonical board stage instead of re-deriving one from substatus, withholds every forward-move button on a terminal or unconfirmed stage, and repaints an already-rendered detail from a fresh canonical response after a transition (falling back to "Stage not confirmed", never to the pre-write stage, if that read fails); the same spec (`tests/e2e/ops-makesafe-ui-truth.spec.js`) covers the canonical family tag, a board card refusing to guess a missing family, pack existence coming only from the canonical row's `pack` block, the "No pack drafted" Docs Ready marker, card chips following the pack artifacts over a stale WO-missing enrichment join, and the card-face builder links. `scripts/makesafe-ui-truth-census.js` measures the same behaviours against the live board read-only and writes the evidence in `docs/evidence/ses-b2-ui-truth-2026-08-02/`.
20. Optional dedicated accounts prove that the real Supabase password login still works.
21. The trade portal-report confirmation is hidden only by current-cycle `portal_verified_at` or a screenshot-backed sealed capture for the current attendance cycle. Bare substatus, `report_received_at`, and the legacy event-only `report_on_portal` flag cannot hide it; aged share links keep the enabled confirmation control and explain the builder-resend path. This exact sentinel-delimited production module is covered by `scripts/test-trade-portal-confirmation.js` and runs before Playwright through `npm run test:e2e`.
22. Branding images, CDN objects and SES open/click trackers stored as `kind: builder_portal` are never offered as portal links on either dashboard — not in the Ops Builder links panel, not on the board card link row, and not as the trade "Open builder report portal" CTA — while a genuine share URL is kept even when its token has expired. `scripts/test-f5-portal-link-hygiene.js` extracts the shipped filter from `ops.html` and `trade.html` and runs before Playwright through `npm run test:e2e`.
23. The MakeSafe reporting cockpit's degraded canonical-feed identity path derives the real suburb from both `Suburb WA 6060` and `Suburb, WA 6060` address tails, never the state token. `modules/ops-makesafe-reporting-cockpit.smoke.mjs` extracts the shipped parser from `ops.html`, runs it through the live cockpit card renderer with the `MLB-26658PO-56313` failure shape, and runs before Playwright through `npm run test:e2e`. The same smoke also encodes the Docs Ready "review & send" pane's literal UI copy as behavioural contracts (next-action strip, document tabs including the invoice document and one tab per work order, verbatim backend plan text, hold dedupe, the primary stamps sitting in the bottom action foot with a disabled stamp carrying no id/onclick, the control-flag entry guards, the backend-honesty fields on the live Bertram shape — a hold's "what clears it" coming from `blocker.recovery_action` rather than the local table, route-tagged blockers keyed off `evidence.route_kind`, and a dead APPROVE stamp reading its `control.disabled_reason` ("already authorised") instead of the generic hold lock — plus the absence fallbacks that keep the local clear-path table and hold-lock copy when those fields are missing and still enable nothing, condensed email previews, the AJS intended-two-email preview labelled as a preview over a truth fold that still shows every backend route including leftovers, the collapsed photo/trade-note/feedback folds and the feedback fold opening itself for a non-empty or failed thread, panel-scoped element lookups, and the stage's "Open document" hatch re-reading an expired pack before it hands a tab a signed URL). It also covers the pack document-visibility contract: any artifact with PDF/IMAGE bytes becomes a tab (role names it, never gates it — an unlabelled role renders under its stored file name), the portal roof capture's provenance hydrated from the pack's own JSON manifest with a failed read stated rather than an undated capture reading as fresh, byte-identical captures collapsing to one tab that states the copy count while differing bytes each keep a tab, a prior-cycle capture labelled as one, and a card owing a capture with none stating the gap where the tab would be. The same smoke runs the real Hours & wording apply path against stubbed writes: an edit records on the exact docket revision via `record_ses_review_feedback` and locks the press until the revised pack carries it, retyping the pack's original values records a countermanding withdrawal and re-arms only from a fresh pack read, and a withdrawal on a drafted card outside the review queue still reopens the detail from that fresh read. See `AGENTS.md` for the authoritative pane contract those assertions encode.
24. The MakeSafe map and Crew Week planner take stages and substatus only from `makesafe-board.v1`; a missing canonical stage is shown as “Stage not confirmed”, never coerced to New, and `decision_required` remains a server stage. `tests/e2e/ops-makesafe-stage-retirement.spec.js` guards those paths and all eight server stage keys.
25. Trade Today may borrow allocated make-safes from This Week/Upcoming and past-dated make-safes from Needs Report, but those borrowed strips contain report debt only: archived/terminal jobs and submitted/post-trade reports stay off Today, while a live make-safe that still owes the signed-in trade's report remains visible. `scripts/test-trade-today-run-list.js` extracts the shipped eligibility helpers and runs before Playwright through `npm run test:e2e`.
26. Any Docs Ready card with a canonical drafted pack opens the review/send overlay (queue membership is not the door), an assessment with no pack keeps "No pack drafted" with no Review button, and Hours & wording edits preview on the pane, lock the send stamp, and die with their docket revision. On a sendable pack the stamp word is SEND IT (send-only) or APPROVE AND SEND (invoice still armed); the click always runs `sesApproveAndSend`. SEND IT stays enabled when `send_it.enabled` is false only if the current inspect release is already dispatching (or equivalent in-flight) and bound to the docket / output hash on screen — a leftover approved object or an older revise does not arm, and the press must not execute that older release. A bound in-flight Northam-class release resumes `execute_ses_release_revision` on that revision — it does not prepare a new one. `tests/e2e/ops-ses-loop-overlay.spec.js` guards this; see `AGENTS.md` for the authoritative overlay contract and `docs/evidence/ses-loop-ux-overlay-v1/` for the proof shots.

Ops Dash coverage in the same suite:

- `tests/e2e/cal-workdays.spec.js` — CP1 calendar working-day (weekend-skip) span math. Pure node: no browser, page, or server fixtures. It reads `ops.html`, extracts the code between the `// <calendar-ops-core>` sentinels, and evaluates it, so assertions run against the real shipped `CalOpsCore` functions (`layWorkingDays`, `paintedSpanDates`, `buildMovePayloadV2`, `buildResizePayload`) and cannot drift. It lives in `tests/e2e/` because that is the Playwright `testDir` and it must run in the PR gate.
- `tests/e2e/cal-drag-real-input.spec.js` — CP1 drag-to-reschedule with REAL pointer input only (Playwright `page.mouse` press-move-release through the trusted CDP input pipeline, never `element.dispatchEvent` — synthetic events pass even when a real user cannot drag, which is exactly how the Schedule-view gap shipped). Boots the real repo `ops.html` over `file://` with `?dragv2=1` (or flag OFF via the `bootCalendar` `flagOff` opt, which boots `?dragv2=0` — the flag is default ON, so flag-off must be requested explicitly; `unschedJobs` and `availability` opts feed the pipeline and leave fixtures, with an availability-enrich wait so a drag can't race the leave data) and the Jarvis bar visible, stubbing `ops-api` at the network layer via `page.route` and recording every write. Covers BOTH calendar views: Crew-view block move and edge resize, Schedule-view bar move and edge resize (entered by a real click on the view toggle), a confirmed bar staying locked with no write, and a weekend-crossing fixture (Fri→Mon, 2 working days) that must render as broken segments in BOTH views and reschedule the whole job when EITHER segment — first or resume — is dragged (drop day = new start, weekend-skip end, duration preserved). A Perth-pinned describe (`test.use({ timezoneId: 'Australia/Perth' })` — the flag-off end-date bug only shows on the UTC+ side of midnight) covers Captain ruling cp1-askuser-2: flag-OFF 1-day and 3-day Schedule-modal creates write the intended local calendar-day span, never the `toISOString`-inverted one (the modal is opened via `page.evaluate` as setup — the form fill, real click, and `create_assignment` write are the behaviour under test), and a single-crew multi-day real-pointer move onto mid-span leave raises the combined "Crew Unavailable" warning naming crew and day, writing nothing until the explicit confirm. A final describe guards the default-on gating itself (the `bootCalendar` `url` opt boots with NO dragv2 param, `dragLs` seeds `localStorage.sw_cal_dragv2` before load): a PLAIN boot — no query param, no localStorage key, exactly how the team loads the page — drags as V2 (working-day span write + reschedule prompt); the localStorage `'0'` kill switch keeps the old V1 calendar-delta drag working (whole span shifted, no `duration_days`, no prompt — the switch must not remove drag); and the URL flag beats localStorage in BOTH directions (`?dragv2=0` over a stored `'1'`, `?dragv2=1` over a stored `'0'`).

## Why the main suite uses stubs

The default PR gate runs the shipped `trade.html`, `shared/cloud.js`, auth handling, rendering code, selectors, and navigation. Only the Supabase auth transport and edge-function feeds are intercepted.

This is preferable for the standing PR gate because it is deterministic, works on fork PRs, needs no production credential, and guarantees no production writes. Fixture data also gives every PR the exact roles and job states required to exercise allocation and installer views.

`tests/helpers/feed-stub.js` rejects any unapproved non-GET `ops-api` request and the shared Playwright fixture fails the test if one was attempted. It also records every intercepted request (method, action, URL, `Authorization` header, plus the parsed body of an approved write) into the `feedRequests` fixture, so a spec can assert that a read stayed a GET carrying the bearer token and that no write was attempted at all. A catch-all guard (`installExternalRequestGuard`) sits underneath every other route: same-origin app assets fall through, and any request to an origin without an explicit stub is recorded and aborted, so the test also fails if the app reaches an unstubbed external endpoint (Google Places, storage uploads, and the like). Write-safety is enforced, not incidental. Mutation-path tests must add a stubbed response explicitly and must never use the live-auth tests.

The optional live-auth checks provide the smaller integration proof that dedicated credentials can authenticate against Supabase project `kevgrhcjxspbxgovpmfl`. They do not click any mutation control. If secrets are absent, Playwright reports two explicit `LIVE AUTH SKIPPED` annotations while all mocked coverage remains green.

## Dedicated account setup checklist for the PR

A captain or Supabase administrator must complete this once. Never reuse a human or production operator account.

- [ ] Create auth user `trade-e2e-installer@secureworksgroup.app` in Supabase project `kevgrhcjxspbxgovpmfl` with a generated password.
- [ ] Create the matching application `users` profile using the auth user's UUID, `org_id = 00000000-0000-0000-0000-000000000001`, `name = Trade E2E Installer`, `role = crew`, `trade_tier = 1`, active access, and no managed verticals.
- [ ] Assign only seeded, non-client fixture jobs if the account later needs live feed assertions. The current live test requires authentication only.
- [ ] Add repository secret `E2E_TRADE_INSTALLER_EMAIL` with value `trade-e2e-installer@secureworksgroup.app`.
- [ ] Add repository secret `E2E_TRADE_INSTALLER_PASSWORD` with the generated password.
- [ ] Create auth user `trade-e2e-allocator@secureworksgroup.app` with a different generated password.
- [ ] Create its matching `users` profile using the auth UUID, `org_id = 00000000-0000-0000-0000-000000000001`, `name = Trade E2E Allocator`, `role = ops_manager`, `trade_tier = 3`, active access, and `managed_verticals = ["makesafe"]`.
- [ ] Give this account read access only to seeded fixture records. Do not use a human allocator's account.
- [ ] Add repository secret `E2E_TRADE_ALLOCATOR_EMAIL` with value `trade-e2e-allocator@secureworksgroup.app`.
- [ ] Add repository secret `E2E_TRADE_ALLOCATOR_PASSWORD` with the generated password.
- [ ] Re-run the `Trade App E2E` workflow and confirm both live-auth tests no longer show as skipped.

The public Supabase URL and anon key remain app configuration, not GitHub secrets. Only the dedicated passwords are secret. Pull requests from forks do not receive repository secrets, so live checks skip safely there.

## File layout

```text
playwright.config.js             Generic runner, local server, traces, screenshots
.github/workflows/playwright-e2e.yml
                                 PR job, browser cache, failure artifacts
tests/e2e/                       User-visible flow specs
tests/fixtures/*.json            Recorded, synthetic read models only
tests/fixtures/test.js            Repo adapter: personas plus action-to-fixture map
tests/helpers/auth.js             Generic Supabase auth stub and sign-in helper
tests/helpers/feed-stub.js        Generic edge-function route interception
tests/browser/makesafe-reattendance-server.mjs
                                 Isolated local browser fixture for the reattendance flow
```

Repo-specific feed action names and roles belong in `tests/fixtures/test.js`, not inside specs or the generic helpers.

## Copy this pattern to another tool repo

1. Copy `playwright.config.js`, `.github/workflows/playwright-e2e.yml`, `tests/helpers/`, and `tests/fixtures/test.js`.
2. Install `@playwright/test` and copy the four npm scripts from this repo's `package.json`.
3. Change the served HTML path in the workflow/config only if the tool is not at the repository root.
4. Replace the personas in `tests/fixtures/test.js` with that tool's minimum roles.
5. Record synthetic JSON fixtures for each read endpoint. Remove names, phone numbers, tokens, and live client data.
6. Map API action names to those fixtures in `tests/fixtures/test.js`.
7. Write specs only in terms of user-visible controls and outcomes. Keep endpoint routing in helpers and fixture adapters.
8. Keep mocked tests as the mandatory PR gate. Add optional secret-gated live authentication only when a dedicated account exists.
9. Keep all mutation tests stubbed. Never place a live mutation test in CI.
10. Update the workflow name, secret prefix, and this README's account checklist.

## Debugging

Run a single spec:

```bash
npx playwright test tests/e2e/board.spec.js
```

Run headed locally:

```bash
npm run test:e2e:headed
```

On CI failure, download the `trade-e2e-failure-*` artifact. It includes the HTML report plus retained traces and screenshots from `test-results/`.
