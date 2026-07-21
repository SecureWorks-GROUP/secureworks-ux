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
6. An authenticated installer sees My Jobs and can open a standard job detail.
7. Optional dedicated accounts prove that the real Supabase password login still works.

## Why the main suite uses stubs

The default PR gate runs the shipped `trade.html`, `shared/cloud.js`, auth handling, rendering code, selectors, and navigation. Only the Supabase auth transport and edge-function feeds are intercepted.

This is preferable for the standing PR gate because it is deterministic, works on fork PRs, needs no production credential, and guarantees no production writes. Fixture data also gives every PR the exact roles and job states required to exercise allocation and installer views.

`tests/helpers/feed-stub.js` rejects any unapproved non-GET `ops-api` request and the shared Playwright fixture fails the test if one was attempted. Mutation-path tests must add a stubbed response explicitly and must never use the live-auth tests.

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
