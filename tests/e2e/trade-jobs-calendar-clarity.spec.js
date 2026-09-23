const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');
const { perthDate, addIsoDays } = require('../helpers/feed-stub');

// Jobs / Calendar clarity (trade page review, group 2). Pins, for an hourly
// fencing crew member (Alyx-shaped: role crew, tier 1, no managed verticals)
// and a work-order fencing manager (Henry-shaped: lead_installer, per-metre,
// manages fencing):
//  - Today with nothing booked today says "No jobs today" and offers the
//    trade's OWN next job, never "No jobs assigned to you yet" or Pay;
//  - History is bounded by what is loaded, says how far back it reaches,
//    points to All for older jobs, and has honest empty + reset states;
//  - the calendar opens on the trade's own vertical, Reset returns there, and
//    a crew member can open their own vertical's calendar;
//  - the filter sheet names the scope, and a blank day or week says nothing is
//    scheduled and offers the next job.
// my_jobs / trade_calendar / trade_job_detail are answered here, GET only; the
// shared fixture keeps every other action and blocks every write.

const OPS_API = 'https://kevgrhcjxspbxgovpmfl.supabase.co/functions/v1/ops-api';
const TODAY = perthDate();

function row(id, userId, date, status, job, extra = {}) {
  return {
    id,
    user_id: userId,
    status,
    scheduled_date: date,
    start_time: '07:30',
    crew_name: userId,
    ...extra,
    jobs: {
      status: status === 'complete' ? 'complete' : 'scheduled',
      client_name: 'Clarity Client',
      site_address: '1 Clarity Road',
      scope_summary: 'Fence install',
      scope_json: {},
      po_info: null,
      type: 'fencing',
      ...job
    }
  };
}

function calendarEvent(r) {
  return {
    assignment_id: r.id,
    job_id: r.jobs.id,
    user_id: r.user_id,
    job_number: r.jobs.job_number,
    client_name: r.jobs.client_name,
    site_address: r.jobs.site_address,
    site_suburb: r.jobs.site_suburb,
    scheduled_date: r.scheduled_date,
    scheduled_end: r.scheduled_date,
    start_time: '07:30',
    end_time: '15:30',
    crew_name: r.crew_name,
    assigned_to: r.crew_name,
    assignment_type: 'install',
    assignment_status: 'scheduled',
    confirmation_status: 'confirmed',
    job_type: r.jobs.type,
    job_status: 'scheduled'
  };
}

const EMPTY_MAKESAFE_BOARD = {
  contract_version: 'makesafe-board.v1.2',
  projection: 'trade',
  generated_at: new Date().toISOString(),
  columns: { New: [], Allocated: [], Complete: [], Archive: [] },
  rows: [],
  permissions: { visibility: 'allocated_only', sees_all_makesafes: false, can_allocate: false },
  unmapped_stage_job_ids: [],
  parity: { ok: true, contract_version: 'makesafe-board.v1.2' }
};

async function stubOwnWork(page, { myJobs, calendarRows, log, makesafeBoard }) {
  const jobs = {};
  Object.values(myJobs).forEach((bucket) => {
    if (Array.isArray(bucket)) bucket.forEach((r) => { jobs[r.jobs.id] = r.jobs; });
  });
  await page.route(`${OPS_API}**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const action = url.searchParams.get('action');
    if (request.method() !== 'GET') return route.fallback();
    const reply = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (action === 'makesafe_board' && makesafeBoard) {
      return reply(makesafeBoard);
    }
    if (action === 'my_jobs') {
      log.push({ action, mode: url.searchParams.get('mode') });
      return reply(myJobs);
    }
    if (action === 'trade_calendar') {
      const type = url.searchParams.get('type');
      const mode = url.searchParams.get('mode') === 'all' ? 'all' : 'mine';
      log.push({ action, type, mode });
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      const events = calendarRows
        .filter((r) => r.jobs.type === type && r.scheduled_date >= from && r.scheduled_date <= to)
        .filter((r) => mode === 'all' || r.user_id === log.viewerId)
        .map(calendarEvent);
      return reply({ schema: 'trade-calendar.v1', mode, type, events, truncated: false });
    }
    if (action === 'trade_job_detail' && jobs[url.searchParams.get('jobId')]) {
      return reply({ job: jobs[url.searchParams.get('jobId')], crew: [], purchaseOrders: [], documents: [], media: [], notes: [] });
    }
    return route.fallback();
  });
}

async function openFilterSheet(page) {
  await page.locator('#ncFbtn').click();
  await expect(page.locator('#ncSheetBody')).toBeVisible();
}

test.describe('Jobs and Calendar clarity: hourly fencing crew (Alyx-shaped)', () => {
  test.use({ persona: 'installer', timezoneId: 'Australia/Perth' });

  const me = PERSONAS.installer.profile.id;
  const next = row('alyx-next', me, addIsoDays(TODAY, 9), 'scheduled', { id: 'alyx-job-next', job_number: 'FENCE-ALYX-NEXT', site_suburb: 'Wanneroo' });
  const later = row('alyx-later', me, addIsoDays(TODAY, 12), 'scheduled', { id: 'alyx-job-later', job_number: 'FENCE-ALYX-LATER', site_suburb: 'Butler' });
  const done10 = row('alyx-done-10', me, addIsoDays(TODAY, -10), 'complete', { id: 'alyx-job-done10', job_number: 'FENCE-ALYX-DONE10', site_suburb: 'Clarkson' });
  const done25 = row('alyx-done-25', me, addIsoDays(TODAY, -25), 'complete', { id: 'alyx-job-done25', job_number: 'FENCE-ALYX-DONE25', site_suburb: 'Hocking' });
  const myJobs = {
    today: [],
    thisWeek: [],
    upcoming: [next, later],
    recent: [],
    recentCompleted: [done10, done25],
    unscheduled: [],
    makesafePool: [],
    _adminView: false
  };

  let log;
  test.beforeEach(async ({ appPage: page }) => {
    log = [];
    log.viewerId = me;
    await stubOwnWork(page, { myJobs, calendarRows: [next, later], log });
    await signIn(page, PERSONAS.installer);
  });

  test('Today says No jobs today, offers the next job, and never sends the trade to Pay', async ({ appPage: page }) => {
    await page.locator('[data-view="myJobs"]').click();
    const empty = page.locator('#myJobsList [data-jobs-empty="today"]');
    await expect(empty).toContainText('No jobs today');
    await expect(empty).toContainText('Your next job is');
    await expect(empty).toContainText('FENCE-ALYX-NEXT');
    await expect(page.locator('#myJobsList')).not.toContainText('No jobs assigned to you yet');
    await expect(page.locator('#myJobsList')).not.toContainText('Pay');
    await expect(empty.locator('[data-next-job="alyx-job-next"]')).toHaveText('Open next job');

    await empty.getByRole('button', { name: 'Open next job' }).click();
    await expect(page.locator('#viewJob')).toHaveClass(/active/);
    await expect(page.locator('#jobDetailContent')).toContainText('FENCE-ALYX-NEXT');
  });

  test('History is bounded by the loaded list, says how far back it reaches, and resets honestly', async ({ appPage: page }) => {
    await page.locator('[data-view="myJobs"]').click();
    await page.locator('.filter-chip[data-filter="history"]').click();

    const note = page.locator('#historyRangeNote');
    await expect(note).toContainText('back to');
    await expect(note).toContainText('about the last 30 days (make-safe jobs about 180 days)');
    await expect(note.getByRole('button', { name: 'search in All' })).toBeVisible();

    const from = page.locator('#historyFrom');
    const to = page.locator('#historyTo');
    await expect(from).toHaveValue(addIsoDays(TODAY, -25));
    await expect(from).toHaveAttribute('min', addIsoDays(TODAY, -25));
    await expect(to).toHaveValue(TODAY);
    await expect(to).toHaveAttribute('max', TODAY);
    await expect(page.locator('#myJobsList')).toContainText('History (2)');
    await expect(page.locator('#myJobsList')).toContainText('FENCE-ALYX-DONE25');

    // A From date older than anything loaded cannot stick: it clamps back.
    await from.fill(addIsoDays(TODAY, -90));
    await expect(from).toHaveValue(addIsoDays(TODAY, -25));

    // A range with no past jobs says so and offers a reset and All search.
    await from.fill(addIsoDays(TODAY, -5));
    const empty = page.locator('#myJobsList [data-history-empty]');
    await expect(empty).toContainText('No past jobs between');
    await expect(empty.getByRole('button', { name: 'Search All jobs' })).toBeVisible();
    await empty.getByRole('button', { name: 'Reset dates' }).click();
    await expect(from).toHaveValue(addIsoDays(TODAY, -25));
    await expect(page.locator('#myJobsList')).toContainText('History (2)');

    await note.getByRole('button', { name: 'search in All' }).click();
    await expect(page.locator('.filter-chip[data-filter="all"]')).toHaveClass(/active/);
    await expect(page.locator('#jobSearchInput')).toBeFocused();
  });

  test('Calendar opens on her own fencing work, names the scope, and offers the next job on a blank day and week', async ({ appPage: page }) => {
    await expect(page.locator('#viewSchedule')).toHaveClass(/active/);
    await expect.poll(() => log.some((e) => e.action === 'trade_calendar' && e.type === 'fencing')).toBe(true);
    expect(log.filter((e) => e.action === 'trade_calendar').every((e) => e.mode === 'mine')).toBe(true);

    const blankDay = page.locator('#ncCalhost [data-cal-empty]');
    await expect(blankDay).toContainText('Nothing scheduled for');
    await expect(blankDay).toContainText('Showing your Fencing jobs.');
    await expect(blankDay).toContainText('Your next job:');
    await expect(blankDay).toContainText('FENCE-ALYX-NEXT');

    await openFilterSheet(page);
    await expect(page.locator('#ncScopeLabel')).toHaveText('Showing your Fencing jobs');
    await expect(page.locator('#ncSheetBody [data-ftype="fencing"]')).toHaveClass(/on/);
    await expect(page.locator('#ncSheetBody [data-fscope="everyone"]')).toHaveCount(0);
    await page.locator('#ncSheetBody [data-ftype="makesafe"]').click();
    await expect(page.locator('#ncScopeLabel')).toHaveText('Showing your Make-safe jobs');
    await page.locator('#ncResetBtn').click();
    await expect(page.locator('#ncSheetBody [data-ftype="fencing"]')).toHaveClass(/on/);
    await expect(page.locator('#ncScopeLabel')).toHaveText('Showing your Fencing jobs');
    await page.locator('#ncDoneBtn').click();

    // A blank week says so for the whole week and still offers the next job.
    await page.locator('#ncScaleseg [data-sc="week"]').click();
    const blankWeek = page.locator('#ncCalhost [data-cal-empty]');
    await expect(blankWeek).toContainText('Nothing scheduled for');
    await expect(blankWeek).toContainText('Showing your Fencing jobs.');
    await blankWeek.locator('[data-ncnext]').click();
    await expect(page.locator('#ncCalhost')).toContainText('FENCE-ALYX-NEXT');
    await expect(page.locator('#ncCalhost [data-cal-empty]')).toHaveCount(0);
  });

  test('Today search empty-state names her own jobs and All asks for two letters', async ({ appPage: page }) => {
    await page.locator('[data-view="myJobs"]').click();
    await page.locator('#jobSearchInput').fill('z');
    const empty = page.locator('#myJobsList [data-jobs-empty="today"]');
    await expect(empty).toContainText('No match in your jobs.');
    await expect(empty.getByRole('button', { name: 'Search every job in All' })).toBeVisible();
    await expect(empty).not.toContainText('This list only holds your own jobs');

    await empty.getByRole('button', { name: 'Search every job in All' }).click();
    await expect(page.locator('.filter-chip[data-filter="all"]')).toHaveClass(/active/);
    await page.locator('#jobSearchInput').fill('z');
    const allEmpty = page.locator('#myJobsList [data-jobs-empty="all"]');
    await expect(allEmpty).toContainText('Type at least 2 letters to search every job.');
    await expect(allEmpty.getByRole('button')).toHaveCount(0);
  });
});

test.describe('Jobs and Calendar clarity: work-order fencing manager (Henry-shaped)', () => {
  test.use({ persona: 'fencing_manager', timezoneId: 'Australia/Perth' });

  const me = PERSONAS.fencing_manager.profile.id;
  const otherCrew = row('other-soon', 'e2e-alyx', addIsoDays(TODAY, 1), 'scheduled', { id: 'other-job-soon', job_number: 'FENCE-OTHER-SOON', site_suburb: 'Midland' }, { crew_name: 'Alyx Crew' });
  const ghost = row('henry-ghost', me, addIsoDays(TODAY, 1), 'scheduled', { id: 'ghost-job', job_number: 'FENCE-GHOST-WATCH', site_suburb: 'Bassendean' }, { role: 'observer' });
  const mine = row('henry-next', me, addIsoDays(TODAY, 2), 'scheduled', { id: 'henry-job-next', job_number: 'FENCE-HENRY-NEXT', site_suburb: 'Balcatta' });
  const past = row('henry-past', me, addIsoDays(TODAY, -12), 'complete', { id: 'henry-job-past', job_number: 'FENCE-HENRY-PAST', site_suburb: 'Osborne Park' });
  const myJobs = {
    today: [],
    thisWeek: [],
    upcoming: [otherCrew, ghost, mine],
    recent: [],
    recentCompleted: [past],
    unscheduled: [],
    makesafePool: [],
    _adminView: true
  };

  let log;
  test.beforeEach(async ({ appPage: page }) => {
    log = [];
    log.viewerId = me;
    await stubOwnWork(page, { myJobs, calendarRows: [otherCrew, mine], log });
    await signIn(page, PERSONAS.fencing_manager);
  });

  test('Today offers his own next job, not another crew member\'s or a watcher row', async ({ appPage: page }) => {
    await page.locator('[data-view="myJobs"]').click();
    const empty = page.locator('#myJobsList [data-jobs-empty="today"]');
    await expect(empty).toContainText('No jobs today');
    await expect(empty).toContainText('FENCE-HENRY-NEXT');
    await expect(empty).not.toContainText('FENCE-OTHER-SOON');
    await expect(empty).not.toContainText('FENCE-GHOST-WATCH');
    await expect(page.locator('#myJobsList')).not.toContainText('Pay');

    await page.locator('.filter-chip[data-filter="history"]').click();
    await expect(page.locator('#historyRangeNote')).toContainText('about the last 30 days');
    await expect(page.locator('#historyFrom')).toHaveValue(addIsoDays(TODAY, -12));
    await expect(page.locator('#myJobsList')).toContainText('FENCE-HENRY-PAST');
  });

  test('Calendar opens on the fencing team, names the scope, and Reset returns there', async ({ appPage: page }) => {
    await expect(page.locator('#viewSchedule')).toHaveClass(/active/);
    await expect.poll(() => log.some((e) => e.action === 'trade_calendar' && e.type === 'fencing' && e.mode === 'all')).toBe(true);

    const blankDay = page.locator('#ncCalhost [data-cal-empty]');
    await expect(blankDay).toContainText('Nothing scheduled for');
    await expect(blankDay).toContainText('Showing everyone’s Fencing jobs.');
    await expect(blankDay).toContainText('FENCE-HENRY-NEXT');

    await openFilterSheet(page);
    await expect(page.locator('#ncScopeLabel')).toHaveText('Showing everyone’s Fencing jobs');
    await expect(page.locator('#ncSheetBody [data-ftype="fencing"]')).toHaveClass(/on/);
    await page.locator('#ncSheetBody [data-fscope="mine"]').click();
    await expect(page.locator('#ncScopeLabel')).toHaveText('Showing your Fencing jobs');
    await page.locator('#ncResetBtn').click();
    await expect(page.locator('#ncScopeLabel')).toHaveText('Showing everyone’s Fencing jobs');
    await expect(page.locator('#ncSheetBody [data-ftype="fencing"]')).toHaveClass(/on/);
    await page.locator('#ncDoneBtn').click();

    await blankDay.locator('[data-ncnext]').click();
    await expect(page.locator('#ncCalhost')).toContainText('FENCE-HENRY-NEXT');
  });

  test('Today search empty-state names the Everyone lens', async ({ appPage: page }) => {
    await page.locator('[data-view="myJobs"]').click();
    await expect(page.locator('#adminToggleAll')).toHaveText('Everyone · fencing');
    await page.locator('#jobSearchInput').fill('z');
    const empty = page.locator('#myJobsList [data-jobs-empty="today"]');
    await expect(empty).toContainText('No match in Everyone · fencing jobs.');
    await expect(empty.getByRole('button', { name: 'Search every job in All' })).toBeVisible();
    await expect(empty).not.toContainText('No match in your jobs.');
  });
});

test.describe('Jobs and Calendar clarity: decking-only crew', () => {
  test.use({ persona: 'installer', timezoneId: 'Australia/Perth' });

  const me = PERSONAS.installer.profile.id;
  const next = row('alyx-deck', me, addIsoDays(TODAY, 3), 'scheduled', {
    id: 'alyx-job-deck',
    job_number: 'DECK-ALYX-NEXT',
    site_suburb: 'Joondalup',
    type: 'decking'
  });
  const myJobs = {
    today: [],
    thisWeek: [],
    upcoming: [next],
    recent: [],
    recentCompleted: [],
    unscheduled: [],
    makesafePool: [],
    _adminView: false
  };

  let log;
  test.beforeEach(async ({ appPage: page }) => {
    log = [];
    log.viewerId = me;
    await stubOwnWork(page, { myJobs, calendarRows: [next], log, makesafeBoard: EMPTY_MAKESAFE_BOARD });
    await signIn(page, PERSONAS.installer);
  });

  test('Blank day opens an unsupported next job instead of staying on a blank calendar', async ({ appPage: page }) => {
    await expect(page.locator('#viewSchedule')).toHaveClass(/active/);
    const blankDay = page.locator('#ncCalhost [data-cal-empty]');
    await expect(blankDay).toContainText('Showing your Make-safe jobs.');
    expect(log.filter((e) => e.action === 'trade_calendar').every((e) => e.type !== 'decking')).toBe(true);
    const offer = blankDay.getByRole('button', { name: 'Open your next job: DECK-ALYX-NEXT' });
    await expect(offer).toHaveText('Open your next job: DECK-ALYX-NEXT');

    await openFilterSheet(page);
    await expect(page.locator('#ncSheetBody [data-ftype="decking"]')).toHaveCount(0);
    await page.locator('#ncDoneBtn').click();

    await offer.click();
    await expect(page.locator('#viewJob')).toHaveClass(/active/);
    await expect(page.locator('#jobDetailContent')).toContainText('DECK-ALYX-NEXT');
  });
});

test.describe('Jobs and Calendar clarity: own my_jobs beats the make-safe board', () => {
  test.use({ persona: 'installer', timezoneId: 'Australia/Perth' });

  const me = PERSONAS.installer.profile.id;
  const mine = row('alyx-one-fence', me, addIsoDays(TODAY, 4), 'scheduled', {
    id: 'alyx-job-one-fence',
    job_number: 'FENCE-ALYX-ONLY',
    site_suburb: 'Wanneroo'
  });
  const myJobs = {
    today: [],
    thisWeek: [],
    upcoming: [mine],
    recent: [],
    recentCompleted: [],
    unscheduled: [],
    makesafePool: [],
    _adminView: false
  };

  let log;
  test.beforeEach(async ({ appPage: page }) => {
    log = [];
    log.viewerId = me;
    await stubOwnWork(page, { myJobs, calendarRows: [mine], log });
    await signIn(page, PERSONAS.installer);
  });

  test('One own fencing assignment still opens Fencing, even when the board holds her make-safe', async ({ appPage: page }) => {
    await expect(page.locator('#viewSchedule')).toHaveClass(/active/);
    await expect.poll(() => log.some((e) => e.action === 'trade_calendar' && e.type === 'fencing')).toBe(true);

    const blankDay = page.locator('#ncCalhost [data-cal-empty]');
    await expect(blankDay).toContainText('Showing your Fencing jobs.');
    await expect(blankDay).toContainText('FENCE-ALYX-ONLY');
  });
});
