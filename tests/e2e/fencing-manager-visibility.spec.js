const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');
const { perthWeekMonday, addIsoDays } = require('../helpers/feed-stub');

test.use({ persona: 'fencing_manager' });

function requestsFor(feedRequests, action) {
  return feedRequests
    .filter((entry) => entry.action === action)
    .map((entry) => ({ ...entry, parsed: new URL(entry.url) }));
}

function boardWeekLabel(start) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const from = new Date(`${start}T00:00:00Z`);
  const end = new Date(`${addIsoDays(start, 6)}T00:00:00Z`);
  const leftYear = from.getUTCFullYear() === end.getUTCFullYear() ? '' : ` ${from.getUTCFullYear()}`;
  return `Mon ${from.getUTCDate()} ${months[from.getUTCMonth()]}${leftYear} – Sun ${end.getUTCDate()} ${months[end.getUTCMonth()]} ${end.getUTCFullYear()}`;
}

async function swipeBoardLeft(page) {
  const pager = page.locator('#boardContent .tjb-pager');
  const box = await pager.boundingBox();
  if (!box) throw new Error('Board pager is not visible');
  const cdp = await page.context().newCDPSession(page);
  const y = box.y + Math.min(120, box.height / 2);
  await cdp.send('Input.synthesizeScrollGesture', {
    x: box.x + box.width / 2,
    y,
    xDistance: -Math.round(box.width * 0.9),
    yDistance: 0,
    speed: 600,
    gestureSourceType: 'touch'
  });
}

test.describe('Fencing manager visibility', () => {
  test('Board defaults to the current Perth week, keeps Unscheduled deliberate, and opens other-crew detail read-only', async ({ appPage: page, feedRequests }) => {
    await signIn(page, PERSONAS.fencing_manager);
    await page.locator('#navBoard').click();
    await expect(page.locator('#viewBoard')).toHaveClass(/active/);
    await expect(page.locator('#fenceWeekLabel')).toHaveText(boardWeekLabel(perthWeekMonday()));
    await expect(page.locator('#boardContent .tjb-col')).toHaveCount(6);
    await expect(page.locator('#boardContent .tjb-pager')).toHaveCSS('display', 'block');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.locator('[data-board-status-target="attention"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-board-status-target="attention"]')).toHaveAttribute('aria-current', 'true');

    const henry = page.locator('#boardContent .jc').filter({ hasText: 'FENCE-HENRY-001' });
    const otherCrew = page.locator('#boardContent .jc').filter({ hasText: 'FENCE-ALYX-002' });
    const open = page.locator('#boardContent .jc').filter({ hasText: 'FENCE-OPEN-003' });
    await expect(henry).toBeVisible();
    await expect(otherCrew).toHaveCount(1);
    await expect(otherCrew).toContainText('Alyx Crew');
    await expect(open).toHaveCount(0);
    await expect(page.locator('#boardContent')).not.toContainText('OTHER-TENANT-FENCE');
    await expect(page.locator('#boardContent')).not.toContainText('PATIO-NOT-AUTHORISED');
    await page.getByRole('button', { name: 'Unscheduled' }).click();
    await expect(open).toBeVisible();
    await expect(open).toContainText('Nobody allocated');
    await expect(page.locator('#fenceWeekLabel')).toHaveText('Unscheduled fencing work');
    await page.getByRole('button', { name: 'This week' }).click();
    await expect(page.locator('#boardContent')).not.toContainText('E2E-MS-001');
    await expect(page.locator('#boardContent')).not.toContainText('E2E-JOB-001');

    const boardReads = requestsFor(feedRequests, 'my_jobs')
      .filter((entry) => entry.parsed.searchParams.get('mode') === 'all');
    expect(boardReads.length).toBeGreaterThan(0);
    expect(boardReads.every((entry) => entry.method === 'GET')).toBe(true);
    expect(boardReads.every((entry) => entry.authorization === 'Bearer e2e-access-token')).toBe(true);
    expect(boardReads.every((entry) => !entry.parsed.searchParams.has('from') && !entry.parsed.searchParams.has('to'))).toBe(true);

    await otherCrew.locator('.jc-place').click();
    await expect(page.locator('#viewJob')).toHaveClass(/active/);
    await expect(page.locator('#jobDetailContent')).toContainText('FENCE-ALYX-002');
    await expect(page.locator('#jobDetailContent')).toContainText('Other Crew Client');

    // Visibility is not authority: another crew's job is view-only.
    const detail = page.locator('#jobDetailContent');
    await expect(page.locator('#jobViewOnlyBanner')).toContainText('View only');
    await expect(detail).not.toContainText('Clock On');
    await expect(detail).not.toContainText('Start Travel');
    await expect(detail).not.toContainText("I've Read & Understood");
    await expect(detail.locator('.sf-action-btn')).toHaveCount(0);
    await expect(page.locator('#bottomNoteInput')).toHaveCount(0);

    await page.locator('.jd-tab[data-tab="photos"]').click();
    await expect(page.locator('#jdTab_photos')).toBeVisible();
    await expect(page.locator('#tabPhotoInput')).toHaveCount(0);
    await expect(page.locator('#jdTab_photos .upload-area')).toHaveCount(0);

    await page.locator('.jd-tab[data-tab="log"]').click();
    await expect(page.locator('#jdTab_log')).toBeVisible();
    await expect(page.locator('#tabNoteInput')).toHaveCount(0);
    await expect(page.locator('.jd-tab[data-tab="comms"]')).toHaveCount(0);

    // Even a forced write against the other crew's assignment must not leave the client,
    // and must not be parked in the offline retry queue.
    await page.evaluate(() => window.timerAction('clock_on', 'fence-assignment-alyx'));
    await expect(page.locator('#toast')).toContainText('View only');
    expect(await page.evaluate(() => localStorage.getItem('sw_action_queue') || '[]')).toBe('[]');
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('sw_pending_clock_')))).toEqual([]);
    expect(feedRequests.filter((entry) => entry.method !== 'GET')).toEqual([]);
  });

  test('week controls reveal previous, historical, far-future, and Unscheduled fencing without a reload', async ({ appPage: page }) => {
    await signIn(page, PERSONAS.fencing_manager);
    await page.locator('#navBoard').click();
    await expect(page.locator('#fenceWeekLabel')).toHaveText(boardWeekLabel(perthWeekMonday()));
    await expect(page.locator('[data-board-status-target="scheduled"] .n')).toHaveText('2');
    let navigations = 0;
    page.on('framenavigated', () => { navigations += 1; });

    await page.getByRole('button', { name: 'Previous week' }).click();
    await expect(page.locator('#fenceWeekLabel')).toHaveText(boardWeekLabel(addIsoDays(perthWeekMonday(), -7)));
    await expect(page.locator('#boardContent')).toContainText('FENCE-PREVIOUS-009');
    await expect(page.locator('#boardContent')).not.toContainText('FENCE-HENRY-001');
    await expect(page.locator('[data-board-status-target="done"] .n')).toHaveText('1');

    await page.evaluate(() => window.shiftFencingBoardWeek(-11));
    await expect(page.locator('#fenceWeekLabel')).toHaveText(boardWeekLabel(addIsoDays(perthWeekMonday(), -84)));
    await expect(page.locator('#boardContent')).toContainText('FENCE-HISTORICAL-010');
    await expect(page.locator('[data-board-status-target="done"] .n')).toHaveText('1');

    await page.getByRole('button', { name: 'This week' }).click();
    await page.evaluate(() => window.shiftFencingBoardWeek(26));
    await expect(page.locator('#fenceWeekLabel')).toHaveText(boardWeekLabel(addIsoDays(perthWeekMonday(), 182)));
    await expect(page.locator('#boardContent')).toContainText('FENCE-FUTURE-008');
    await expect(page.locator('[data-board-status-target="scheduled"] .n')).toHaveText('1');

    await page.getByRole('button', { name: 'Unscheduled' }).click();
    await expect(page.locator('#boardContent')).toContainText('FENCE-OPEN-003');
    await expect(page.locator('#boardContent .jc').filter({ hasText: 'FENCE-OPEN-003' })).toHaveCount(1);
    await expect(page.locator('[data-board-status-target="needs"] .n')).toHaveText('1');
    expect(navigations).toBe(0);
  });

  test('own fencing job keeps its crew actions', async ({ appPage: page }) => {
    await signIn(page, PERSONAS.fencing_manager);
    await page.locator('#navBoard').click();
    await page.locator('#boardContent .jc').filter({ hasText: 'FENCE-HENRY-001' }).locator('.jc-place').click();

    await expect(page.locator('#viewJob')).toHaveClass(/active/);
    await expect(page.locator('#jobDetailContent')).toContainText('FENCE-HENRY-001');
    await expect(page.locator('#jobViewOnlyBanner')).toHaveCount(0);
    await expect(page.locator('#jobDetailContent .sf-action-btn').filter({ hasText: 'Accept' })).toBeVisible();
    await expect(page.locator('#bottomNoteInput')).toBeVisible();
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

  test.describe('Calendar backend ordering', () => {
    test.use({ feedScenario: 'calendar-unknown-action' });

    test('keeps the authenticated trade_calendar failure visible when the action is not deployed', async ({ appPage: page, feedRequests }) => {
      await signIn(page, PERSONAS.fencing_manager);
      await expect(page.locator('#viewSchedule')).toHaveClass(/active/);
      await expect(page.getByText('Could not load the calendar')).toBeVisible();
      const request = requestsFor(feedRequests, 'trade_calendar')[0];
      expect(request).toBeTruthy();
      expect(request.method).toBe('GET');
      expect(request.authorization).toBe('Bearer e2e-access-token');
      expect(request.parsed.searchParams.get('type')).toBe('fencing');
      expect(request.parsed.searchParams.get('mode')).toBe('all');
      expect(request.parsed.searchParams.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(request.parsed.searchParams.get('to')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  test.describe('fencing allocation refresh', () => {
    test.use({ feedScenario: 'fencing-allocation' });

    test('allocates an Unscheduled Ready job into its chosen week and status exactly once', async ({ appPage: page, feedRequests }) => {
      const chosenDate = addIsoDays(perthWeekMonday(), 182);
      await signIn(page, PERSONAS.fencing_manager);
      await page.locator('#navBoard').click();
      await page.getByRole('button', { name: 'Unscheduled' }).click();
      const open = page.locator('#boardContent .jc').filter({ hasText: 'FENCE-OPEN-003' });
      await open.locator('button.act.primary').click();
      await page.locator('#allocDate').fill(chosenDate);
      await page.locator('#allocStart').fill('08:15');
      await page.locator('#allocConfirmBtn').click();
      await expect(page.locator('#toast')).toContainText('Job allocated');

      await expect(page.locator('#fenceWeekLabel')).toHaveText(boardWeekLabel(chosenDate));
      const scheduled = page.locator('#board-col-scheduled .jc').filter({ hasText: 'FENCE-OPEN-003' });
      await expect(scheduled).toHaveCount(1);
      await expect(scheduled).toContainText('Henry Fence');
      await expect(page.locator('#boardContent .jc').filter({ hasText: 'FENCE-OPEN-003' })).toHaveCount(1);
      await expect(page.locator('[data-board-status-target="scheduled"] .n')).toHaveText('2');

      const writes = feedRequests.filter((entry) => entry.action === 'allocate_job');
      expect(writes).toHaveLength(1);
      expect(writes[0].method).toBe('POST');
      expect(writes[0].authorization).toBe('Bearer e2e-access-token');
      expect(writes[0].body).toEqual({
        jobId: 'fence-job-open',
        userId: 'e2e-henry',
        scheduledDate: chosenDate,
        startTime: '08:15'
      });
      expect(requestsFor(feedRequests, 'my_jobs').filter((entry) => entry.parsed.searchParams.get('mode') === 'all').length).toBeGreaterThan(1);
    });
  });

  test('an empty invoice week opens the authorised fencing work-order flow without creating money', async ({ appPage: page, feedRequests }) => {
    await signIn(page, PERSONAS.fencing_manager);
    await page.locator('[data-view="hours"]').click();
    await expect(page.getByText('No completed jobs this week')).toBeVisible();
    await page.getByRole('button', { name: 'Choose a Work Order' }).click();
    await expect(page.getByRole('heading', { name: 'My Work Orders' })).toBeVisible();
    await expect(page.locator('[data-work-order-card]')).toHaveCount(1);
    await expect(page.locator('#hoursContent')).toContainText('WO-FENCE-001');
    await expect(page.locator('#hoursContent')).toContainText('Total: $110.00');
    await expect(page.getByRole('button', { name: 'Invoice This Work Order' })).toBeVisible();
    await expect(page.locator('#hoursContent')).not.toContainText('WO-PATIO-002');
    await expect(page.locator('#hoursContent')).not.toContainText('WO-OTHER-TENANT');

    await page.locator('#workOrderSearch').fill('PATIO-NOT-AUTHORISED');
    await expect(page.locator('[data-work-order-card]:visible')).toHaveCount(0);
    await page.locator('#workOrderSearch').fill('FENCE-HENRY-001');
    await expect(page.locator('[data-work-order-card]:visible')).toHaveCount(1);
    await page.evaluate(() => window.invoiceWorkOrder('wo-other-tenant'));
    await expect(page.locator('#toast')).toContainText('not available to invoice');
    await page.evaluate(() => window.invoiceWorkOrder('wo-patio-not-managed'));
    await expect(page.locator('#toast')).toContainText('not available to invoice');
    expect(feedRequests.filter((entry) => entry.method !== 'GET')).toEqual([]);
  });
});

for (const width of [390, 360]) {
  test.describe(`mobile fencing Board at ${width}px`, () => {
    test.use({ viewport: { width, height: 844 }, hasTouch: true, isMobile: true });

    test('swipes and taps through every status without changing the selected week', async ({ appPage: page }) => {
      await signIn(page, PERSONAS.fencing_manager);
      await page.locator('#navBoard').click();
      const expectedWeek = boardWeekLabel(perthWeekMonday());
      await expect(page.locator('#fenceWeekLabel')).toHaveText(expectedWeek);
      await expect(page.locator('.tjb-pager')).toHaveCSS('scroll-snap-type', /x mandatory/);

      await page.getByRole('button', { name: /Scheduled/ }).click();
      await expect(page.locator('[data-board-status-target="scheduled"]')).toHaveAttribute('aria-current', 'true');
      await expect.poll(() => page.locator('.tjb-pager').evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      await swipeBoardLeft(page);
      await expect(page.locator('[data-board-status-target="onsite"]')).toHaveAttribute('aria-current', 'true');
      await expect(page.locator('#fenceWeekLabel')).toHaveText(expectedWeek);

      for (const key of ['needs', 'scheduled', 'onsite', 'done', 'attention', 'cancelled']) {
        await page.locator(`[data-board-status-target="${key}"]`).click();
        await expect(page.locator(`[data-board-status-target="${key}"]`)).toHaveAttribute('aria-current', 'true');
      }
      await expect(page.locator('#fenceWeekLabel')).toHaveText(expectedWeek);
      await expect(page.getByRole('button', { name: 'Previous week' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Next week' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Unscheduled' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  });
}
