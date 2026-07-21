> **Docs hub:** read [`C:/Coding Projects/secureworks-docs/CLAUDE.md`](C:/Coding Projects/secureworks-docs/CLAUDE.md) first for the where-to-look table + canonical-source decision tree. **Live operational data** (jobs, invoices, contacts, POs) → Supabase `kevgrhcjxspbxgovpmfl`, never the wiki. **Historical/archived docs** (anything under `_archive/`, `strategy/dreaming/`, or carrying a "HISTORICAL SNAPSHOT" banner) are not current canon — cross-check `strategy/master-plan.md` v1.1 (2026-04-17) before acting on anything older than 2026-04.

---

# Claude Code Instructions — ops-dashboard / SecureSuite

## Bug Tracking

When Shaun says **"new bug"**, **"log a bug"**, **"add a bug"**, **"found a bug"**, or any similar phrase:
1. Ask for (or infer from context) the bug description and where it lives
2. Add it as a new row to the bug list in `C:\Users\shaun\.claude\projects\C--Coding-Projects-ops-dashboard\memory\bugs.md`
3. Confirm it's been logged with the bug number

When Shaun asks for the **bug list**, **"what bugs do we have"**, **"show me bugs"**, or similar:
1. Read `C:\Users\shaun\.claude\projects\C--Coding-Projects-ops-dashboard\memory\bugs.md`
2. Present the full table clearly, grouped by status (Open → In Progress → Fixed)

## Trunk Worktree (Do Not Work Here)

This directory (`/Users/marninstobbe/Projects/securedash`) is the trunk worktree. It must always be on `main` and clean. A pre-commit hook will refuse commits here.

For any work, create a named worktree:
- Via `gstack` (preferred): see `gstack` docs.
- Via raw git: `git worktree add ../securedash-<feature-name> -b <branch-name>`.

Why: previously, deploys from stale base worktrees caused production breakage. See `secureworks-docs/architecture/deploy-lane.md`.

> **Note:** This repo does not yet use Husky. The trunk guard is installed as a `.git/hooks/pre-commit` (per-clone, not tracked by git). Adopting Husky would make this hook portable across clones — tracked as a recommended follow-up.

## Testing

Trade App changes are guarded by a Playwright E2E suite that runs on every pull request (`.github/workflows/playwright-e2e.yml`). Run it locally with `npm ci && npx playwright install chromium && npm run test:e2e`. Changing `trade.html` markup or element IDs can break these specs. See `README-tests.md` for the covered flows and the copyable-template details.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
