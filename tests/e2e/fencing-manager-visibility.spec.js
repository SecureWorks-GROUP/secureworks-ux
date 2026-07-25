const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

test.use({ persona: 'fencing_manager' });

function requestsFor(feedRequests, action) {
  return feedRequests
    .filter((entry) => entry.action === action)
    .map((entry) => ({ ...entry, parsed: new URL(entry.url) }));
}

test.describe('Fencing manager visibility', () => {
  test('Board defaults to all fencing, dedupes stale open rows, and opens other-crew detail read-only', async ({ appPage: page, feedRequests }) => {
    await signIn(page, PERSONAS.fencing_manager);
    await page.locator('#navBoard').click();
    await expect(page.locator('#viewBoard')).toHaveClass(/active/);

    const henry = page.locator('#boardContent .jc').filter({ hasText: 'FENCE-HENRY-001' });
    const otherCrew = page.locator('#boardContent .jc').filter({ hasText: 'FENCE-ALYX-002' });
    const open = page.locator('#boardContent .jc').filter({ hasText: 'FENCE-OPEN-003' });
    await expect(henry).toBeVisible();
    await expect(otherCrew).toHaveCount(1);
    await expect(otherCrew).toContainText('Alyx Crew');
    await expect(open).toBeVisible();
    await expect(open).toContainText('Nobody allocated');
    await expect(page.locator('#boardContent')).not.toContainText('E2E-MS-001');
    await expect(page.locator('#boardContent')).not.toContainText('E2E-JOB-001');

    const boardReads = requestsFor(feedRequests, 'my_jobs')
      .filter((entry) => entry.parsed.searchParams.get('mode') === 'all');
    expect(boardReads.length).toBeGreaterThan(0);
    expect(boardReads.every((entry) => entry.method === 'GET')).toBe(true);
    expect(boardReads.every((entry) => entry.authorization === 'Bearer e2e-access-token')).toBe(true);

    await otherCrew.locator('.jc-place').click();
    await expect(page.locator('#viewJob')).toHaveClass(/active/);
    await expect(page.locator('#jobDetailContent')).toContainText('FENCE-ALYX-002');
    await expect(page.locator('#jobDetailContent')).toContainText('Other Crew Client');
  });

  test('My Jobs defaults to Everyone and Mine removes other-crew and open fencing only', async ({ appPage: page, feedRequests }) => {
    await signIn(page, PERSONAS.fencing_manager);
    await page.locator('[data-view="myJobs"]').click();
    await page.locator('[data-filter="all"]').click();

    await expect(page.locator('#adminJobToggle')).toBeVisible();
    await expect(page.locator('#adminToggleAll')).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(page.locator('#myJobsList')).toContainText('FENCE-HENRY-001');
    await expect(page.locator('#myJobsList')).toContainText('FENCE-ALYX-002');
    await expect(page.locator('#myJobsList')).toContainText('FENCE-OPEN-003');

    await page.locator('#adminToggleMine').click();
    await expect(page.locator('#adminToggleMine')).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(page.locator('#myJobsList')).toContainText('FENCE-HENRY-001');
    await expect(page.locator('#myJobsList')).not.toContainText('FENCE-ALYX-002');
    await expect(page.locator('#myJobsList')).not.toContainText('FENCE-OPEN-003');

    await page.locator('#adminToggleAll').click();
    await expect(page.locator('#myJobsList')).toContainText('FENCE-ALYX-002');
    const modes = requestsFor(feedRequests, 'my_jobs')
      .map((entry) => entry.parsed.searchParams.get('mode'))
      .filter(Boolean);
    expect(modes).toContain('mine');
    expect(modes).toContain('all');
  });

  test('Calendar consumes trade-calendar.v1 as fencing Everyone, then Mine removes only other crew', async ({ appPage: page, feedRequests }) => {
    await signIn(page, PERSONAS.fencing_manager);
    await expect(page.locator('#viewSchedule')).toHaveClass(/active/);

    await expect(page.locator('#ncCalhost .ncard').filter({ hasText: 'FENCE-HENRY-001' })).toBeVisible();
    await expect(page.locator('#ncCalhost .ncard').filter({ hasText: 'FENCE-ALYX-002' })).toBeVisible();

    const allRead = requestsFor(feedRequests, 'trade_calendar')
      .find((entry) => entry.parsed.searchParams.get('mode') === 'all');
    expect(allRead).toBeTruthy();
    expect(allRead.method).toBe('GET');
    expect(allRead.authorization).toBe('Bearer e2e-access-token');
    expect(allRead.parsed.searchParams.get('type')).toBe('fencing');
    expect(allRead.parsed.searchParams.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(allRead.parsed.searchParams.get('to')).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await page.locator('#ncFbtn').click();
    await expect(page.locator('#ncSheetBody [data-ftype="fencing"]')).toHaveClass(/on/);
    await expect(page.locator('#ncSheetBody [data-fscope="everyone"]')).toHaveClass(/on/);
    await page.locator('#ncSheetBody [data-fscope="mine"]').click();

    await expect(page.locator('#ncCalhost .ncard').filter({ hasText: 'FENCE-HENRY-001' })).toBeVisible();
    await expect(page.locator('#ncCalhost')).not.toContainText('FENCE-ALYX-002');
    const mineRead = requestsFor(feedRequests, 'trade_calendar')
      .find((entry) => entry.parsed.searchParams.get('mode') === 'mine');
    expect(mineRead).toBeTruthy();
    expect(mineRead.parsed.searchParams.get('type')).toBe('fencing');
  });
});
