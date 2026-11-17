// SecureWorks Crew: the daily loop on the demo server. Today, Schedule and Jobs.
const { test, expect } = require('@playwright/test');
const { crewUrl, watchErrors, PHONE } = require('../helpers/crew');

test.use(PHONE);

// Exercise the shipped screens against demo records, with requests captured at
// the API boundary. No live calls, customer details or real pay figures.
async function clockFixture(page, { earlier = false, running = true, usual = 45, suggestion = true, enabled = true, breakMin = 0, failedRead = false, start = '07:00' } = {}) {
  await page.goto(crewUrl('#/today').replace('09%3A00', '16%3A00'));
  await page.waitForFunction(() => Boolean(window.__crewDemo));
  const ids = await page.evaluate(async (options) => {
    const { db, ops } = window.__crewDemo;
    const store = await import('/crew/js/lib/store.js');
    const dates = await import('/crew/js/lib/dates.js');
    const { syncClock } = await import('/crew/js/screens/clock.js');
    const today = dates.todayISO();
    const day = options.earlier ? dates.addDays(today, -1) : today;
    db.me.name = 'Crew';
    db.others.forEach((p) => { p.name = 'Crew'; });
    db.jobs.forEach((j) => { j.client_name = 'Customer'; j.site_address = ''; j.site_suburb = 'ZZTEST'; j.client_phone = ''; });
    store.setState({ user: { ...store.getState().user, name: 'Crew', label: 'Crew' } });
    const current = db.assignments.find((a) => a.user_id === db.me.id && a.scheduled_date === today);
    const next = { ...current, id: 'zz-next-booking', job_id: db.jobs.find((j) => j.id !== current.job_id).id };
    db.assignments = [current, next];
    Object.assign(current, { scheduled_date: day, status: options.running ? 'in_progress' : 'confirmed', clocked_on_at: options.running ? `${day}T${options.start}:00+08:00` : null, clocked_off_at: null, break_minutes: options.breakMin });
    Object.assign(next, { scheduled_date: today, status: 'confirmed', clocked_on_at: null, clocked_off_at: null, break_minutes: 0 });
    db.logged = [];
    window.__clockWrites = [];
    for (const action of ['clock_event', 'log_my_job_hours']) {
      const original = ops[action];
      ops[action] = (p, b) => { window.__clockWrites.push({ action, body: { ...b } }); return original(p, b); };
    }
    const read = ops.my_hours;
    ops.my_hours = (p) => {
      const result = read(p);
      if (options.enabled) {
        result.week_summary = {};
        if (options.usual != null) result.usual_break_minutes = options.usual;
        if (options.suggestion) result.assignments.forEach((a) => { if (a.id === current.id) a.suggestion = { finish_time: '15:30', break_minutes: 30 }; });
      }
      return result;
    };
    store.primeQuery('myjobs', ops.my_jobs({}));
    store.primeQuery('hours:' + dates.mondayOf(day), ops.my_hours({ week_ending: dates.addDays(dates.mondayOf(day), 6) }));
    if (options.failedRead) {
      ops.my_hours = () => { window.__hoursReadFailed = true; throw new Error('Hours read unavailable'); };
      store.invalidate('hours');
    }
    syncClock(options.running ? { id: current.id, jobId: current.job_id, clockOn: current.clocked_on_at, job: db.job(current.job_id), breakMin: options.breakMin } : null);
    return { current: current.id, job: current.job_id, next: next.id, nextJob: next.job_id, day };
  }, { earlier, running, usual, suggestion, enabled, breakMin, failedRead, start });
  if (failedRead) await page.waitForFunction(() => window.__hoursReadFailed);
  return ids;
}

async function clockPicture(page, name) {
  if (!process.env.CREW_CLOCK_PROOF) return;
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.screenshot({ path: `${process.env.CREW_CLOCK_PROOF}/${name}-${width}.png`, animations: 'disabled' });
  }
  await page.setViewportSize(PHONE.viewport);
}

for (const route of ['today', 'job']) {
  test(`clock on takes one press from ${route}`, async ({ page }) => {
    const ids = await clockFixture(page, { running: false });
    if (route === 'job') await page.evaluate((id) => { location.hash = '#/job/' + id; }, ids.job);
    const host = route === 'job' ? page.locator('.foot') : page.locator('.nowjob');
    await host.getByRole('button', { name: 'Clock on', exact: true }).click();
    await expect(route === 'today' ? page.locator('.nowjob') : page.locator('.clockbar')).toContainText('On site');
    expect(await page.evaluate(() => window.__clockWrites)).toEqual([
      { action: 'clock_event', body: expect.objectContaining({ event: 'clock_on', assignment_id: ids.current }) }
    ]);
  });
}

for (const [label, options, expected] of [
  ['usual break', {}, 45],
  ['running break', { breakMin: 15 }, 15],
  ['long-day fallback', { usual: null }, 30],
  ['short-day fallback', { usual: null, start: '13:00' }, 0],
  ['zero usual break', { usual: 0 }, 0],
  ['failed hours refresh', { failedRead: true }, 45]
]) {
  test(`clock off is ready with ${label} and saves it in one press`, async ({ page }) => {
    const ids = await clockFixture(page, options);
    await page.locator('.nowjob').getByRole('button', { name: 'Clock off', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Clock off', exact: true });
    await expect(sheet.locator('select')).toHaveValue(String(expected));
    const save = sheet.getByRole('button', { name: /^Clock off ·/ });
    await expect(save).toBeEnabled();
    if (label === 'usual break') await clockPicture(page, 'clock-off');
    await save.click();
    await expect(sheet).not.toBeVisible();
    const writes = await page.evaluate(() => window.__clockWrites);
    expect(writes).toHaveLength(2);
    expect(writes[0].body).toMatchObject({ event: 'clock_off', break_minutes: expected });
    expect(writes[1]).toMatchObject({ action: 'log_my_job_hours', body: { assignmentId: ids.current, work_date: ids.day, start_time: options.start || '07:00', finish_time: '16:00', break_minutes: expected, source: 'clock_off' } });
    expect(await page.evaluate(() => window.__crewDemo.db.logged[0].break_minutes)).toBe(expected);
  });
}

test('forgotten clock off shows the server finish and saves the earlier day', async ({ page }) => {
  const ids = await clockFixture(page, { earlier: true });
  await page.getByRole('button', { name: 'Sort it out' }).click();
  const sheet = page.getByRole('dialog', { name: /^You did not clock off on/ });
  await expect(sheet.locator('input[type=time]').first()).toHaveValue('07:00');
  await expect(sheet.locator('input[type=time]').nth(1)).toHaveValue('15:30');
  await expect(sheet).toContainText('Suggested finish. Change it if it is wrong.');
  expect(await page.evaluate(() => window.__clockWrites)).toHaveLength(0);
  await clockPicture(page, 'forgotten-clock-off');
  await sheet.getByRole('button', { name: /^Save .* ·/ }).click();
  await expect(sheet).not.toBeVisible();
  expect(await page.evaluate(() => window.__clockWrites)).toEqual([
    { action: 'clock_event', body: expect.objectContaining({ event: 'clock_off', assignment_id: ids.current, break_minutes: 45 }) },
    { action: 'log_my_job_hours', body: expect.objectContaining({ assignmentId: ids.current, work_date: ids.day, start_time: '07:00', finish_time: '15:30', break_minutes: 45, hours: 7.75, source: 'clock_off_suggested' }) }
  ]);
  expect(await page.evaluate(() => window.__crewDemo.db.logged[0])).toMatchObject({ work_date: ids.day, hours: 7.75 });
});

test('forgotten finish falls back to eight hours and a half-hour break', async ({ page }) => {
  await clockFixture(page, { earlier: true, suggestion: false, usual: null });
  await page.getByRole('button', { name: 'Sort it out' }).click();
  const sheet = page.getByRole('dialog', { name: /^You did not clock off on/ });
  await expect(sheet.locator('input[type=time]').nth(1)).toHaveValue('15:00');
  await expect(sheet.locator('select')).toHaveValue('30');
  await expect(sheet.getByRole('button', { name: /^Save .* · 7.5 h$/ })).toBeEnabled();
});

test('a refused earlier save preserves edits and a retry starts the next job only after saving', async ({ page }) => {
  const ids = await clockFixture(page, { earlier: true });
  await page.evaluate(async (id) => {
    const { ops } = window.__crewDemo;
    const original = ops.log_my_job_hours;
    const { ApiError } = await import('/crew/js/lib/api.js');
    let refused = false;
    ops.log_my_job_hours = (p, b) => {
      if (!refused) { refused = true; throw new ApiError('The office changed this booking. Check the times.', { status: 409 }); }
      return original(p, b);
    };
    location.hash = '#/job/' + id;
  }, ids.nextJob);
  await page.locator('.foot').getByRole('button', { name: 'Clock on', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: /^You did not clock off on/ });
  await expect(sheet).toBeVisible();
  await sheet.locator('input[type=time]').nth(1).fill('15:00');
  await sheet.getByRole('button', { name: /^Save .* ·/ }).click();
  await expect(page.locator('.toast')).toContainText('The office changed this booking');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('input[type=time]').nth(1)).toHaveValue('15:00');
  expect((await page.evaluate(() => window.__clockWrites)).filter((w) => w.body.event === 'clock_on')).toHaveLength(0);
  await sheet.getByRole('button', { name: /^Save .* ·/ }).click();
  await expect(sheet).not.toBeVisible();
  await expect(page.locator('.clockbar')).toContainText('On site');
  const writes = await page.evaluate(() => window.__clockWrites);
  expect(writes.filter((w) => w.body.event === 'clock_off')).toHaveLength(1);
  expect(writes.find((w) => w.action === 'log_my_job_hours').body).toMatchObject({ assignmentId: ids.current, work_date: ids.day, finish_time: '15:00', source: 'clock_off_suggested' });
  expect(writes.filter((w) => w.body.event === 'clock_on')).toEqual([{ action: 'clock_event', body: expect.objectContaining({ assignment_id: ids.next }) }]);
});

test('earlier hours waiting for signal are retained and do not start another clock', async ({ page }) => {
  const ids = await clockFixture(page, { earlier: true });
  await page.evaluate(async (id) => {
    const { ApiError } = await import('/crew/js/lib/api.js');
    window.__crewDemo.ops.log_my_job_hours = () => { throw new ApiError('No signal', { offline: true }); };
    location.hash = '#/job/' + id;
  }, ids.nextJob);
  await page.locator('.foot').getByRole('button', { name: 'Clock on', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: /^You did not clock off on/ });
  await sheet.getByRole('button', { name: /^Save .* ·/ }).click();
  await expect(sheet).not.toBeVisible();
  await expect(page.locator('.toast')).toContainText('earlier times are saved on this phone');
  expect((await page.evaluate(() => window.__clockWrites)).filter((w) => w.body.event === 'clock_on')).toHaveLength(0);
  const queued = await page.evaluate(async () => (await import('/crew/js/lib/outbox.js')).outboxItems());
  expect(queued).toEqual([expect.objectContaining({ action: 'log_my_job_hours', body: expect.objectContaining({ work_date: ids.day, source: 'clock_off_suggested' }) })]);
});

test('today shows the next job and clocks on and off with saved times', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(crewUrl('#/today'));
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  const card = page.locator('.nowjob');
  await expect(card).toContainText('42 Lakeside Drive, Joondalup');
  await expect(card.locator('.jobtag')).toHaveText('SWF-26767');
  // Today is only "now": the calendar lives in Schedule.
  await expect(page.locator('.week')).toHaveCount(0);

  await card.getByRole('button', { name: 'Clock on' }).click();
  await expect(card).toContainText('Time on site');
  await expect(card.locator('.badge')).toContainText('On site');

  await card.getByRole('button', { name: 'Clock off' }).click();
  const sheet = page.getByRole('dialog', { name: 'Clock off' });
  await expect(sheet).toBeVisible();
  await sheet.locator('input[type="time"]').first().fill('07:00');
  await sheet.locator('input[type="time"]').nth(1).fill('15:30');
  await sheet.locator('select').selectOption('30');
  await expect(sheet).toContainText('8.0 h');
  await sheet.getByRole('button', { name: 'Save to timesheet' }).click();
  await expect(page.getByText('Done for today')).toBeVisible();
  expect(errors).toEqual([]);
});

test('schedule: the week, the month, and confirming a booking', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(crewUrl('#/schedule'));
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
  await expect(page.getByText('9 to 15 Nov 2026')).toBeVisible();
  // Every day of the week is a row, booked or not.
  for (const dow of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) await expect(page.locator('.daycell', { hasText: dow }).first()).toBeVisible();
  await expect(page.locator('.item.today')).toContainText('Joondalup');
  // A trade sees only their own bookings: no Everyone switch.
  await expect(page.getByRole('button', { name: 'Everyone' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Month', exact: true }).click();
  await expect(page.getByText('November 2026')).toBeVisible();
  await expect(page.getByText('Free weekdays')).toBeVisible();

  await page.getByRole('button', { name: 'Week', exact: true }).click();
  await page.getByRole('button', { name: 'Later week' }).click();
  const row = page.locator('.item', { hasText: 'Hillarys' }).first();
  await expect(row.locator('.badge')).toHaveText('To confirm');
  await row.click();
  await expect(page.getByRole('heading', { name: 'Booking' })).toBeVisible();
  await expect(page.getByText('Allocated')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(page.locator('.badge', { hasText: 'Confirmed' }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('any job can be found and opened, and a trade can add themselves', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(crewUrl('#/jobs'));
  await expect(page.getByRole('heading', { name: 'Jobs' })).toBeVisible();
  await page.getByLabel('Search every job').fill('kinross');
  await page.locator('.item', { hasText: 'Kinross' }).first().click();
  // Looking only: no customer number, and the scope is readable.
  await expect(page.getByText('Add yourself to clock on')).toBeVisible();
  await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Scope' }).click();
  await expect(page.getByText('Gable patio 6.0 x 3.6 m')).toBeVisible();

  await page.getByRole('button', { name: 'Add me to this job' }).click();
  const sheet = page.getByRole('dialog', { name: 'Which days?' });
  await sheet.getByRole('button', { name: 'Add me' }).click();
  await expect(page.locator('.foot').getByRole('button', { name: 'Clock on' })).toBeVisible();
  await expect(page.locator('a[href^="tel:"]').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('job record: overview, scope, a note, and a problem report', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(crewUrl('#/job/j-joon'));
  await expect(page.getByRole('heading', { name: 'SWF-26767' })).toBeVisible();
  await expect(page.getByText('42 Lakeside Drive, Joondalup')).toBeVisible();
  await expect(page.getByText('Your work on this job')).toBeVisible();
  // Pay type comes from the server's answer for the job, never from the app.
  await expect(page.locator('.kvrow', { hasText: 'Pay type' })).toBeVisible();

  await page.getByRole('tab', { name: 'Scope' }).click();
  await expect(page.getByText('Hand dig the first three posts')).toBeVisible();
  await expect(page.getByText('Strip old fence, rear and left')).toBeVisible();

  await page.getByRole('tab', { name: /Notes/ }).click();
  await page.getByPlaceholder('Write a note for the office and crew').fill('Gate code is 4410');
  await page.getByRole('button', { name: 'Send note' }).click();
  await expect(page.getByText('Gate code is 4410')).toBeVisible();

  await page.getByRole('button', { name: 'Problem' }).click();
  const sheet = page.getByRole('dialog', { name: 'Tell the office' });
  await sheet.getByRole('button', { name: 'Materials missing' }).click();
  await sheet.getByRole('button', { name: 'Send to the office' }).click();
  await expect(page.locator('.toast', { hasText: 'Sent to the office' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('no price reaches a trade on the job page', async ({ page }) => {
  await page.goto(crewUrl('#/job/j-joon'));
  await expect(page.getByRole('heading', { name: 'SWF-26767' })).toBeVisible();
  for (const tab of ['Overview', 'Scope', 'Files']) {
    await page.getByRole('tab', { name: new RegExp(tab) }).click();
    await expect(page.locator('main.page')).not.toContainText('$');
  }
});

test('a manager sees who is where and the board; a trade does not', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(crewUrl('#/schedule', 'lead'));
  await page.getByRole('button', { name: 'Everyone' }).click();
  await expect(page.getByText('To schedule')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Allocate' }).first()).toBeVisible();
  await page.goto(crewUrl('#/jobs/board', 'lead'));
  await expect(page.getByRole('button', { name: 'Board', exact: true })).toBeVisible();
  // A plain trade who lands on the managers' view gets their own week.
  await page.goto(crewUrl('#/schedule/everyone', 'crew'));
  await page.reload();
  await expect(page.getByText('9 to 15 Nov 2026')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Everyone' })).toHaveCount(0);
  expect(errors).toEqual([]);
});
