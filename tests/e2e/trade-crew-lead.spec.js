// Crew roster + lead installer on the Trade App job surfaces.
//
// Captain, 2026-08-03: "allow everyone in the company to see who they're
// allocated to the job with, and an option to assign someone as the lead
// installer ... then it's clear to see who else is just part of the team".
//
// Backed by secureworks-backend PR #513 (trade_job_detail gains crew[].is_lead
// + leadInstaller, and the set_job_lead action). The pure model is covered by
// scripts/test-trade-crew-lead-core.js; this spec covers what a user sees and
// what actually leaves the browser.
const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

const panel = (page) => page.locator('#crewRosterPanel');
const row = (page, name) => panel(page).locator('.crw-row').filter({ hasText: name });

async function openAlyxFenceJob(page) {
  await signIn(page, PERSONAS.fencing_manager);
  await page.locator('#navBoard').click();
  await expect(page.locator('#viewBoard')).toHaveClass(/active/);
  await page.locator('#boardContent .jc').filter({ hasText: 'FENCE-ALYX-002' }).locator('.jc-place').click();
  await expect(page.locator('#viewJob')).toHaveClass(/active/);
  await expect(panel(page)).toBeVisible();
}

test.describe('Everyone sees who they are on the job with', () => {
  test.use({ persona: 'installer' });

  test('an installer sees the whole crew and who leads it, but cannot change it', async ({ appPage: page, feedRequests }) => {
    await signIn(page, PERSONAS.installer);
    await page.locator('[data-view="myJobs"]').click();
    await page.locator('#myJobsList .jc').filter({ hasText: 'E2E-JOB-001' }).click();
    await expect(page.locator('#viewJob')).toHaveClass(/active/);

    // Every allocated person is named — the point of the feature.
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).locator('.crw-row')).toHaveCount(2);
    await expect(panel(page)).toContainText('E2E Installer');
    await expect(panel(page)).toContainText('E2E Allocator');
    await expect(panel(page).locator('.crw-count')).toHaveText('2 people');

    // The distinction: exactly one LEAD badge, on the designated person's row.
    await expect(panel(page).locator('.crw-badge')).toHaveCount(1);
    await expect(row(page, 'E2E Allocator')).toContainText('Lead installer');
    await expect(row(page, 'E2E Allocator')).toHaveClass(/lead/);
    await expect(row(page, 'E2E Installer')).not.toContainText('Lead installer');
    await expect(row(page, 'E2E Installer')).not.toHaveClass(/lead/);
    // The viewer is marked so a crew list of similar names is still readable.
    await expect(row(page, 'E2E Installer')).toContainText('You');

    // Authority mirrors the server: an ordinary installer is offered nothing,
    // including on their own row.
    await expect(panel(page).locator('.crw-act')).toHaveCount(0);
    await expect(panel(page)).not.toContainText('No lead installer set');
    expect(feedRequests.filter((entry) => entry.action === 'set_job_lead')).toEqual([]);
  });
});

test.describe('Naming the lead installer', () => {
  test.use({ persona: 'fencing_manager', feedScenario: 'crew-lead' });

  test('a managed-vertical lead names, changes and clears the lead on another crew\'s job', async ({ appPage: page, feedRequests }) => {
    await openAlyxFenceJob(page);

    // This is Alyx's job, not Henry's: the manager is here as a manager. The
    // view-only guard must keep blocking crew writes while still allowing the
    // manager action the server gates by allocation authority.
    await expect(page.locator('#jobViewOnlyBanner')).toContainText('View only');

    // Alyx holds two day-rows on this job. That is ONE crew member, not two.
    await expect(panel(page).locator('.crw-row')).toHaveCount(2);
    await expect(panel(page).locator('.crw-count')).toHaveText('2 people');
    await expect(row(page, 'Alyx Crew')).toHaveCount(1);
    await expect(row(page, 'Alyx Crew').locator('.crw-sub')).toContainText('more day');

    // Nobody was backfilled a lead, and the panel says so rather than staying silent.
    await expect(panel(page)).toContainText('No lead installer set');
    await expect(panel(page).locator('.crw-badge')).toHaveCount(0);
    await expect(panel(page).locator('.crw-act')).toHaveCount(2);
    await page.screenshot({
      path: 'test-results/evidence/trade-crew-lead/no-lead-with-actions.png',
      animations: 'disabled',
    });

    await row(page, 'Sam Offsider').getByRole('button', { name: 'Make lead' }).click();
    await expect(row(page, 'Sam Offsider')).toContainText('Lead installer');
    await expect(panel(page).locator('.crw-badge')).toHaveCount(1);
    await expect(panel(page)).not.toContainText('No lead installer set');
    await page.screenshot({
      path: 'test-results/evidence/trade-crew-lead/sam-as-lead.png',
      animations: 'disabled',
    });
    // The lead reads first.
    await expect(panel(page).locator('.crw-row').first()).toContainText('Sam Offsider');

    const first = feedRequests.filter((entry) => entry.action === 'set_job_lead');
    expect(first).toHaveLength(1);
    expect(first[0].method).toBe('POST');
    expect(first[0].body).toEqual({ jobId: 'fence-job-alyx', assignmentId: 'fence-assignment-sam' });

    // Changing the lead moves the badge; it never produces two leads.
    await row(page, 'Alyx Crew').getByRole('button', { name: 'Make lead' }).click();
    await expect(row(page, 'Alyx Crew')).toContainText('Lead installer');
    await expect(panel(page).locator('.crw-badge')).toHaveCount(1);
    await expect(row(page, 'Sam Offsider')).not.toContainText('Lead installer');

    // Clearing returns the job to the honest no-lead state.
    await row(page, 'Alyx Crew').getByRole('button', { name: 'Clear' }).click();
    await expect(panel(page)).toContainText('No lead installer set');
    await expect(panel(page).locator('.crw-badge')).toHaveCount(0);

    const writes = feedRequests.filter((entry) => entry.action === 'set_job_lead');
    expect(writes).toHaveLength(3);
    expect(writes[2].body).toEqual({ jobId: 'fence-job-alyx', clear: true });
    // Designating a lead is the ONLY write this flow makes.
    expect(feedRequests.filter((entry) => entry.method !== 'GET' && entry.action !== 'set_job_lead')).toEqual([]);
  });
});

test.describe('A refused set-lead keeps the panel truthful', () => {
  test.use({ persona: 'fencing_manager', feedScenario: 'crew-lead-refused' });

  test('a server refusal is shown and no lead is claimed', async ({ appPage: page }) => {
    await openAlyxFenceJob(page);
    await expect(panel(page)).toContainText('No lead installer set');

    await row(page, 'Sam Offsider').getByRole('button', { name: 'Make lead' }).click();
    await expect(panel(page).locator('.crw-err')).toContainText('not an active crew member');
    // The optimistic badge that never was: only the server's answer may move it.
    await expect(panel(page).locator('.crw-badge')).toHaveCount(0);
    await expect(panel(page)).toContainText('No lead installer set');
    // The controls come back so the manager can retry or pick someone else.
    await expect(panel(page).locator('.crw-act').first()).toBeEnabled();
  });
});

test.describe('A server that predates PR 513', () => {
  test.use({ persona: 'fencing_manager', feedScenario: 'crew-lead-legacy' });

  test('renders the crew and claims nothing about a lead', async ({ appPage: page, feedRequests }) => {
    await openAlyxFenceJob(page);

    // The crew list is the half that needs no new column.
    await expect(panel(page).locator('.crw-row')).toHaveCount(2);
    await expect(panel(page)).toContainText('Alyx Crew');
    await expect(panel(page)).toContainText('Sam Offsider');

    // A payload with no opinion must not be reported as "nobody leads".
    await expect(panel(page)).toHaveAttribute('data-lead-supported', '0');
    await expect(panel(page)).not.toContainText('No lead installer set');
    await expect(panel(page).locator('.crw-badge')).toHaveCount(0);
    await expect(panel(page)).toContainText('not available from this server yet');

    // And the action is not offered against a server that cannot store it.
    await expect(panel(page).locator('.crw-act')).toHaveCount(0);
    expect(feedRequests.filter((entry) => entry.action === 'set_job_lead')).toEqual([]);
  });
});

test.describe('Make-safe board cards name everyone allocated', () => {
  test.use({ persona: 'allocator' });

  test('a card lists every allocated crew member instead of "first + N"', async ({ appPage: page }) => {
    await signIn(page, PERSONAS.allocator);
    await page.locator('#navBoard').click();
    await expect(page.locator('#viewBoard')).toHaveClass(/active/);
    // E2E-MS-002 carries two assignments (E2E Installer + E2E Allocator); both
    // names must appear on the card face, not "E2E Installer +1".
    const card = page.locator('#boardContent .jc').filter({ hasText: 'E2E-MS-002' });
    const crewLine = card.locator('.jc-rail .crew');
    await expect(crewLine).toContainText('E2E Installer');
    await expect(crewLine).toContainText('E2E Allocator');
    await expect(crewLine).not.toContainText(/\+\d/);
  });
});
