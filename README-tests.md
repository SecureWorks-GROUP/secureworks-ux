# Playwright E2E template

This suite is the SecureWorks Group copyable pattern for static HTML tools. It runs on every pull request and covers the Trade App's highest-value read-only flows in Chromium.

## What runs

```bash
npm ci
npx playwright install chromium
npm run test:e2e
```

`playwright.config.js` starts a local static server automatically. Set `E2E_BASE_URL` to test an already-served deployment instead.

Covered Trade App flows:

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
15. Optional dedicated accounts prove that the real Supabase password login still works.

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
2. Install `@playwright/test` and copy the three npm scripts from this repo's `package.json`.
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
