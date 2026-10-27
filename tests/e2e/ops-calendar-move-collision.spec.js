// Ops Dash calendar drag: collision-safe multi-row rescheduling.
//
// The live failure shape is a Schedule-view bar backed by one assignment row
// per person/day. Moving the segment one day later used to update the rows in
// ascending date order, so Monday -> Tuesday hit the still-present Tuesday row
// for the same job/person and Postgres returned
// job_assignments_job_user_date_key. The real backend also mirrors one hidden
// Shaun observer row per job/date. This fixture keeps those ghosts in the
// database-shaped store while excluding them from the calendar feed, exactly
// like calendar_events does.
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { installOpsSessionStub } = require('../helpers/ops-auth');
const { perthDate, addIsoDays } = require('../helpers/feed-stub');

const OPS_URL = 'file://' + path.resolve(__dirname, '..', '..', 'ops.html') + '?dragv2=1#calendar';
const UNIQUE_ERROR = 'duplicate key value violates unique constraint "job_assignments_job_user_date_key"';

function nextMonday() {
  const today = perthDate();
  const [year, month, day] = today.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  const weekDay = value.getUTCDay();
  return addIsoDays(today, (8 - weekDay) % 7);
}

const MON = nextMonday();
const D = {
  MON,
  TUE: addIsoDays(MON, 1),
  WED: addIsoDays(MON, 2),
  THU: addIsoDays(MON, 3),
  FRI: addIsoDays(MON, 4),
  SAT: addIsoDays(MON, 5),
  SUN: addIsoDays(MON, 6),
};

function fmtDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

const USERS = [
  { id: 'u-hugo', name: 'Hugo', email: 'hugo@secureworkswa.com.au', role: 'lead_installer' },
  { id: 'u-isaac', name: 'Isaac', email: 'isaac.b3lch3r@secureworkswa.com.au', role: 'installer' },
  { id: 'u-shaun', name: 'Shaun', email: 'shaun@secureworkswa.com.au', role: 'ops_manager' },
];

function assignment(id, userId, crewName, date, extra = {}) {
  return {
    id,
    assignment_id: id,
    job_id: 'job-consecutive',
    user_id: userId,
    crew_name: crewName,
    assigned_to: crewName,
    role: extra.role || 'installer',
    is_ghost: extra.is_ghost === true,
    scheduled_date: date,
    scheduled_end: date,
    duration_days: 1,
    start_time: null,
    end_time: null,
    assignment_type: 'install',
    assignment_status: 'scheduled',
    status: 'scheduled',
    confirmation_status: 'tentative',
    job_type: 'fencing',
    job_status: 'processing',
    job_number: 'SWF-261343',
    client_name: 'Calendar Collision',
    site_address: '1 Fixture St',
    site_suburb: 'Perth',
    legacy: false,
    ...extra,
  };
}

function fixtureRows() {
  const rows = [];
  [D.MON, D.TUE, D.WED].forEach((date, index) => {
    rows.push(assignment(`h-${index}`, 'u-hugo', 'Hugo', date, { role: 'lead_installer' }));
    rows.push(assignment(`i-${index}`, 'u-isaac', 'Isaac', date));
    rows.push(assignment(`g-${index}`, 'u-shaun', null, date, {
      role: 'observer',
      is_ghost: true,
      notes: 'ghost_auto_mirror',
    }));
  });
  return rows;
}

function tupleKey(row) {
  return [row.job_id, row.user_id, row.scheduled_date].join('|');
}

function assertUnique(rows) {
  const keys = rows.filter((row) => row.user_id && row.scheduled_date).map(tupleKey);
  expect(new Set(keys).size, 'fixture database must obey the production unique key').toBe(keys.length);
}

// ops-api's releaseGhostObserverMirrorForRealAssignee: a genuine crew row
// landing on (job, user, date) first clears that user's own ghost mirror off
// the key, so the unique constraint never fires against a mirror.
function releaseGhostMirrorForRealRow(rows, candidate) {
  if (candidate.is_ghost || !candidate.user_id || !candidate.scheduled_date) return;
  for (let index = rows.length - 1; index >= 0; index--) {
    if (rows[index].is_ghost && tupleKey(rows[index]) === tupleKey(candidate)) rows.splice(index, 1);
  }
}

function reconcileGhosts(rows) {
  const realDates = new Set(rows.filter((row) => !row.is_ghost).map((row) => row.scheduled_date));
  for (let index = rows.length - 1; index >= 0; index--) {
    if (rows[index].is_ghost && !realDates.has(rows[index].scheduled_date)) rows.splice(index, 1);
  }
  for (const date of realDates) {
    if (rows.some((row) => row.user_id === 'u-shaun' && row.scheduled_date === date)) continue;
    rows.push(assignment(`g-${date}`, 'u-shaun', null, date, {
      role: 'observer', is_ghost: true, notes: 'ghost_auto_mirror',
    }));
  }
  assertUnique(rows);
}

async function bootCalendar(page, options = {}) {
  const rows = options.rows || fixtureRows();
  const writes = [];
  assertUnique(rows);
  await installOpsSessionStub(page);
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith('file://')) return route.continue();
    const match = url.match(/\/functions\/v1\/ops-api\?action=([a-z_]+)/);
    if (!match) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    const action = match[1];
    const json = (body, status = 200) => route.fulfill({
      status, contentType: 'application/json', body: JSON.stringify(body),
    });
    if (action === 'calendar') {
      // calendar_events hides ghosts; a `feed_hidden` row stands for one the
      // feed's 500-row cap (or the window edge) left out of the payload.
      return json({
        events: rows.filter((row) => !row.is_ghost && !row.feed_hidden).map((row) => ({ ...row })),
        truncated: rows.some((row) => row.feed_hidden),
      });
    }
    if (action === 'job_detail') {
      if (options.jobDetailFails) return json({ error: 'e2e job read down' }, 500);
      const jobId = new URL(url).searchParams.get('jobId');
      const job = rows.find((row) => row.job_id === jobId);
      if (!job) return json({ error: 'not found' }, 404);
      return json({
        job: { id: jobId, job_number: job.job_number, type: job.job_type, status: job.job_status },
        assignments: rows.filter((row) => row.job_id === jobId).map((row) => ({
          id: row.id,
          job_id: row.job_id,
          user_id: row.user_id,
          role: row.role,
          status: row.status,
          scheduled_date: row.scheduled_date,
          scheduled_end: row.scheduled_end,
          users: row.user_id ? { id: row.user_id, name: USERS.find((u) => u.id === row.user_id)?.name } : null,
        })),
      });
    }
    if (action === 'pipeline') return json({ columns: { accepted: [] } });
    if (action === 'get_crew_availability') return json({ availability: [] });
    if (action === 'list_users') return json({ users: USERS });
    if (action === 'send_client_update') return json({ ok: true, sent: true });
    if (action === 'create_assignment') {
      const body = route.request().postDataJSON();
      writes.push({ action, body });
      const user = USERS.find((u) => u.id === body.userId);
      const row = assignment(`new-${writes.length}`, body.userId, body.crewName || (user && user.name), body.scheduledDate, {
        job_id: body.jobId, scheduled_end: body.scheduledEnd || body.scheduledDate, role: body.role || 'installer',
      });
      releaseGhostMirrorForRealRow(rows, row);
      if (rows.some((other) => tupleKey(other) === tupleKey(row))) return json({ error: UNIQUE_ERROR }, 409);
      rows.push(row);
      reconcileGhosts(rows);
      return json({ ok: true, assignment: row });
    }
    if (action === 'delete_assignment') {
      const body = route.request().postDataJSON();
      writes.push({ action, body });
      const index = rows.findIndex((candidate) => candidate.id === body.assignmentId);
      if (index === -1) return json({ error: 'assignment not found' }, 404);
      // ops-api refuses to remove a crew member who has already invoiced the job
      if (rows[index].invoiced) {
        return json({ error: 'This crew member has already invoiced this job (TI-0042). The office must adjust the invoice before the allocation can be removed.' }, 409);
      }
      rows.splice(index, 1);
      reconcileGhosts(rows);
      return json({ ok: true });
    }
    if (action === 'update_assignment') {
      const body = route.request().postDataJSON();
      writes.push({ action, body });
      const row = rows.find((candidate) => candidate.id === body.assignmentId);
      if (!row) return json({ error: 'assignment not found' }, 404);
      const candidate = {
        ...row,
        scheduled_date: body.scheduled_date ?? row.scheduled_date,
        scheduled_end: body.scheduled_end ?? row.scheduled_end,
        duration_days: body.duration_days ?? row.duration_days,
      };
      releaseGhostMirrorForRealRow(rows, candidate);
      if (rows.some((other) => other.id !== row.id && tupleKey(other) === tupleKey(candidate))) {
        return json({ error: UNIQUE_ERROR }, 409);
      }
      Object.assign(row, candidate);
      reconcileGhosts(rows);
      return json({ ok: true, assignment: row });
    }
    return json({});
  });
  await page.addInitScript(() => {
    // Calendar v3 lands a first-time browser on the job-based Month once
    // (sw_cal_v3_intro). This spec picks its own view, so mark it seen.
    localStorage.setItem('sw_cal_v3_intro', '1');
    localStorage.setItem('sw_ops_tab', 'calendar');
    localStorage.setItem('sw_cal_range', '2w');
    localStorage.setItem('sw_cal_view_mode', 'crew');
  });
  await page.goto(OPS_URL);
  await expect(page.locator('.cal-job-block').first()).toBeVisible();
  return { rows, writes };
}

async function realDrag(page, source, target) {
  const src = await source.boundingBox();
  const dst = await target.boundingBox();
  if (!src || !dst) throw new Error('drag endpoints not visible');
  const sx = src.x + src.width * 0.2;
  const sy = src.y + src.height / 2;
  const dx = dst.x + dst.width / 2;
  const dy = dst.y + dst.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let step = 1; step <= 25; step++) {
    await page.mouse.move(sx + ((dx - sx) * step) / 25, sy + ((dy - sy) * step) / 25);
  }
  await page.waitForTimeout(150);
  await page.mouse.up();
}

test('Schedule-view move orders same-person day rows safely and keeps ghost mirrors coherent', async ({ page }) => {
  const { rows, writes } = await bootCalendar(page);
  await page.locator('#btnViewSchedule').click();
  const bar = page.locator('.cal-schedule-bar[data-job-id="job-consecutive"]').first();
  await expect(bar).toBeVisible();
  await expect(bar.locator('.bar-crew .crew-initial')).toHaveCount(2);

  // Moving Mon-Wed one day later is the smallest real shape that reproduces
  // the live failure: Mon -> Tue must wait until the same person's Tue row has
  // moved to Wed, which in turn must wait for Wed -> Thu.
  await realDrag(page, bar, page.locator(`.cal-schedule-cell[data-date="${D.TUE}"]`));

  await expect.poll(() => writes.length, { message: 'all six genuine rows should move' }).toBe(6);
  await expect(page.locator('body')).not.toContainText(UNIQUE_ERROR);
  await expect(page.locator('#calConfirmBackdrop')).toHaveClass(/open/);

  const genuine = rows.filter((row) => !row.is_ghost);
  for (const userId of ['u-hugo', 'u-isaac']) {
    expect(genuine.filter((row) => row.user_id === userId).map((row) => row.scheduled_date).sort())
      .toEqual([D.TUE, D.WED, D.THU]);
  }
  expect(rows.filter((row) => row.is_ghost).map((row) => row.scheduled_date).sort())
    .toEqual([D.TUE, D.WED, D.THU]);
  expect(writes.some((write) => write.body.assignmentId.startsWith('g-')),
    'observer rows are backend-owned and must never be moved by the browser').toBe(false);
  assertUnique(rows);
});

test('a bar dropped on the same person\'s other visit of the job is refused, and a drop elsewhere moves only that bar', async ({ page }) => {
  // Hugo has Mon and Wed on this job, two bars, two bookings (Captain
  // 2026-10-27: each booking stands on its own). Mon dropped on Wed would put
  // two of his bookings on one date, so it is refused and both stay; Mon
  // dropped on Thu moves Mon only and Wed stays where it is.
  const rows = [
    assignment('h-source', 'u-hugo', 'Hugo', D.MON, { role: 'lead_installer' }),
    assignment('h-existing', 'u-hugo', 'Hugo', D.WED, { role: 'lead_installer' }),
    assignment('g-mon', 'u-shaun', null, D.MON, { role: 'observer', is_ghost: true }),
    assignment('g-wed', 'u-shaun', null, D.WED, { role: 'observer', is_ghost: true }),
  ];
  const { writes } = await bootCalendar(page, { rows });
  await page.locator('#btnViewSchedule').click();
  await expect(page.locator('.cal-schedule-bar[data-job-id="job-consecutive"]')).toHaveCount(2);
  const sourceBar = page.locator('.cal-schedule-bar[data-job-id="job-consecutive"]').first();
  await realDrag(page, sourceBar, page.locator(`.cal-schedule-cell[data-date="${D.WED}"]`));
  await expect(page.getByText('Already scheduled there — existing visit kept')).toBeVisible();
  await page.waitForTimeout(300);
  expect(writes).toHaveLength(0);

  await realDrag(page, page.locator('.cal-schedule-bar[data-job-id="job-consecutive"]').first(),
    page.locator(`.cal-schedule-cell[data-date="${D.THU}"]`));
  await expect.poll(() => writes.length).toBe(1);
  await page.waitForTimeout(300);
  expect(writes.map((w) => w.body.assignmentId)).toEqual(['h-source']);
  expect(rows.find((row) => row.id === 'h-source').scheduled_date).toBe(D.THU);
  expect(rows.find((row) => row.id === 'h-existing').scheduled_date).toBe(D.WED);
  await expect(page.locator('body')).not.toContainText(UNIQUE_ERROR);
  assertUnique(rows);
});

test('start-edge resize onto a same-person visit is skipped without changing either visit', async ({ page }) => {
  const rows = [
    assignment('h-existing', 'u-hugo', 'Hugo', D.MON, { role: 'lead_installer' }),
    assignment('h-span', 'u-hugo', 'Hugo', D.WED, {
      role: 'lead_installer', scheduled_end: D.THU, duration_days: 2,
    }),
    assignment('g-mon', 'u-shaun', null, D.MON, { role: 'observer', is_ghost: true }),
    assignment('g-wed', 'u-shaun', null, D.WED, { role: 'observer', is_ghost: true }),
  ];
  const { writes } = await bootCalendar(page, { rows });
  const source = page.locator(`.cal-swim-cell[data-date="${D.WED}"][data-crew="Hugo"] .cal-job-block`);
  await source.hover();
  await realDrag(page, source.locator('.cal-resize-handle.left'),
    page.locator(`.cal-swim-cell[data-date="${D.MON}"][data-crew="Hugo"]`));

  await expect(page.getByText('Already scheduled there — existing visit kept')).toBeVisible();
  expect(writes).toHaveLength(0);
  expect(rows.find((row) => row.id === 'h-span').scheduled_date).toBe(D.WED);
  expect(rows.find((row) => row.id === 'h-span').scheduled_end).toBe(D.THU);
  assertUnique(rows);
});

test('crew reassignment onto an existing job/person/date skips before delete-and-create', async ({ page }) => {
  const rows = [
    assignment('h-source', 'u-hugo', 'Hugo', D.MON, { role: 'lead_installer' }),
    assignment('i-existing', 'u-isaac', 'Isaac', D.MON),
    assignment('g-mon', 'u-shaun', null, D.MON, { role: 'observer', is_ghost: true }),
  ];
  const { writes } = await bootCalendar(page, { rows });
  const source = page.locator(`.cal-swim-cell[data-date="${D.MON}"][data-crew="Hugo"] .cal-job-block`);
  const target = page.locator(`.cal-swim-cell[data-date="${D.MON}"][data-crew="Isaac"]`);
  await realDrag(page, source, target);

  await expect(page.getByText('Already scheduled there — existing visit kept')).toBeVisible();
  expect(writes).toHaveLength(0);
  expect(rows.filter((row) => !row.is_ghost).map((row) => row.id).sort())
    .toEqual(['h-source', 'i-existing']);
  assertUnique(rows);
});

test('a visit of the job the calendar feed left out still holds its date: the bar is refused, never sent into Postgres', async ({ page }) => {
  // Hugo holds Mon+Tue (one bar) and a separate Fri visit that the truncated
  // feed did not deliver. Dragging the bar to Thu would put Tue on Fri, which
  // the window snapshot alone cannot see; the job-scoped read supplies the Fri
  // row, it stays where it is (another booking) and the bar is refused whole.
  const rows = [
    assignment('h-0', 'u-hugo', 'Hugo', D.MON, { role: 'lead_installer' }),
    assignment('h-1', 'u-hugo', 'Hugo', D.TUE, { role: 'lead_installer' }),
    assignment('h-hidden', 'u-hugo', 'Hugo', D.FRI, { role: 'lead_installer', feed_hidden: true }),
    assignment('g-mon', 'u-shaun', null, D.MON, { role: 'observer', is_ghost: true }),
    assignment('g-tue', 'u-shaun', null, D.TUE, { role: 'observer', is_ghost: true }),
    assignment('g-fri', 'u-shaun', null, D.FRI, { role: 'observer', is_ghost: true }),
  ];
  const { writes } = await bootCalendar(page, { rows });
  await page.locator('#btnViewSchedule').click();
  await expect(page.locator(`.cal-schedule-bar[data-job-id="job-consecutive"]`)).toHaveCount(1);
  const bar = page.locator('.cal-schedule-bar[data-job-id="job-consecutive"]').first();
  await realDrag(page, bar, page.locator(`.cal-schedule-cell[data-date="${D.THU}"]`));

  await expect(page.getByText('Already scheduled there — existing visit kept')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(UNIQUE_ERROR);
  await page.waitForTimeout(300);
  expect(writes).toHaveLength(0);
  const byId = Object.fromEntries(rows.map((row) => [row.id, row.scheduled_date]));
  expect([byId['h-0'], byId['h-1'], byId['h-hidden']]).toEqual([D.MON, D.TUE, D.FRI]);
  assertUnique(rows);
});

test('a multi-crew bar is all-or-nothing: one blocked crew chain moves nobody and names the real visit', async ({ page }) => {
  // Hugo and Isaac share Mon+Tue; Isaac also has a cancelled Fri row the feed
  // hides but the unique key still binds. Dragging the bar to Thu would move
  // Hugo cleanly but block Isaac's Tue -> Fri row. The job must not be torn
  // across crews, and the toast counts the ONE real holder, not Isaac's two
  // cascaded candidates.
  const rows = [
    assignment('h-0', 'u-hugo', 'Hugo', D.MON, { role: 'lead_installer' }),
    assignment('h-1', 'u-hugo', 'Hugo', D.TUE, { role: 'lead_installer' }),
    assignment('i-0', 'u-isaac', 'Isaac', D.MON),
    assignment('i-1', 'u-isaac', 'Isaac', D.TUE),
    assignment('i-existing', 'u-isaac', 'Isaac', D.FRI, {
      status: 'cancelled', assignment_status: 'cancelled', feed_hidden: true,
    }),
    assignment('g-mon', 'u-shaun', null, D.MON, { role: 'observer', is_ghost: true }),
    assignment('g-tue', 'u-shaun', null, D.TUE, { role: 'observer', is_ghost: true }),
  ];
  const { writes } = await bootCalendar(page, { rows });
  await page.locator('#btnViewSchedule').click();
  await expect(page.locator(`.cal-schedule-bar[data-job-id="job-consecutive"]`)).toHaveCount(1);
  const bar = page.locator('.cal-schedule-bar[data-job-id="job-consecutive"]').first();
  await expect(bar.locator('.bar-crew .crew-initial')).toHaveCount(2);
  await realDrag(page, bar, page.locator(`.cal-schedule-cell[data-date="${D.THU}"]`));

  await expect(page.getByText(`Not moved — 1 existing visit kept: Isaac on ${fmtDate(D.FRI)} (cancelled visit still holds that date)`)).toBeVisible();
  await expect(page.locator('body')).not.toContainText(UNIQUE_ERROR);
  await expect(page.locator('#calConfirmBackdrop')).not.toHaveClass(/open/);
  expect(writes).toHaveLength(0);
  const byId = Object.fromEntries(rows.map((row) => [row.id, row.scheduled_date]));
  expect([byId['h-0'], byId['h-1'], byId['i-0'], byId['i-1'], byId['i-existing']])
    .toEqual([D.MON, D.TUE, D.MON, D.TUE, D.FRI]);
  assertUnique(rows);
});

test('an ops user who is both crew and observer mirror on a job can be moved onto their own mirror date', async ({ page }) => {
  // The mirror is invisible on the calendar and the job-scoped read supplies
  // it, but ops-api releases the manager's own mirror off (job, user, date)
  // before writing the real row, so a ghost-only holder must not refuse the
  // drag or surface in any toast.
  const rows = [
    assignment('s-crew', 'u-shaun', 'Shaun', D.MON, { role: 'lead_installer' }),
    assignment('h-mon', 'u-hugo', 'Hugo', D.MON, { role: 'installer' }),
    assignment('h-wed', 'u-hugo', 'Hugo', D.WED, { role: 'installer' }),
    assignment('g-wed', 'u-shaun', null, D.WED, { role: 'observer', is_ghost: true }),
  ];
  const { writes } = await bootCalendar(page, { rows });
  const source = page.locator(`.cal-swim-cell[data-date="${D.MON}"][data-crew="Shaun"] .cal-job-block`);
  await realDrag(page, source, page.locator(`.cal-swim-cell[data-date="${D.WED}"][data-crew="Shaun"]`));

  await expect(page.locator(`.cal-swim-cell[data-date="${D.WED}"][data-crew="Shaun"] .cal-job-block`)).toBeVisible();
  await expect(page.locator('body')).not.toContainText(UNIQUE_ERROR);
  await expect(page.locator('body')).not.toContainText('Already scheduled there');
  expect(writes.map((w) => [w.action, w.body.assignmentId])).toEqual([['update_assignment', 's-crew']]);
  expect(rows.find((row) => row.id === 's-crew').scheduled_date).toBe(D.WED);
  expect(rows.some((row) => row.is_ghost && row.user_id === 'u-shaun' && row.scheduled_date === D.WED)).toBe(false);
  assertUnique(rows);
});

test('a real visit sharing its key with the mirror still refuses the move without naming the mirror', async ({ page }) => {
  const rows = [
    assignment('s-crew', 'u-shaun', 'Shaun', D.MON, { role: 'lead_installer' }),
    assignment('s-wed', 'u-shaun', 'Shaun', D.WED, { role: 'lead_installer' }),
    assignment('h-mon', 'u-hugo', 'Hugo', D.MON, { role: 'installer' }),
    assignment('h-wed', 'u-hugo', 'Hugo', D.WED, { role: 'installer' }),
  ];
  const { writes } = await bootCalendar(page, { rows });
  const source = page.locator(`.cal-swim-cell[data-date="${D.MON}"][data-crew="Shaun"] .cal-job-block`);
  await realDrag(page, source, page.locator(`.cal-swim-cell[data-date="${D.WED}"][data-crew="Shaun"]`));

  await expect(page.getByText('Already scheduled there — existing visit kept')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(UNIQUE_ERROR);
  expect(writes).toHaveLength(0);
  expect(rows.find((row) => row.id === 's-crew').scheduled_date).toBe(D.MON);
  assertUnique(rows);
});

test('a bar with deliberately scheduled Sat and Sun rows says its days would collapse, not that a visit exists', async ({ page }) => {
  // Fri, Sat and Sun rows share one bar. Working-day offsets give Sat and Sun
  // the same offset, so a drop on Thu lands both on Fri: no existing visit is
  // involved and the toast must not claim one.
  const rows = [
    assignment('h-fri', 'u-hugo', 'Hugo', D.FRI, { role: 'lead_installer' }),
    assignment('h-sat', 'u-hugo', 'Hugo', D.SAT, { role: 'lead_installer' }),
    assignment('h-sun', 'u-hugo', 'Hugo', D.SUN, { role: 'lead_installer' }),
    assignment('g-fri', 'u-shaun', null, D.FRI, { role: 'observer', is_ghost: true }),
    assignment('g-sat', 'u-shaun', null, D.SAT, { role: 'observer', is_ghost: true }),
    assignment('g-sun', 'u-shaun', null, D.SUN, { role: 'observer', is_ghost: true }),
  ];
  const { writes } = await bootCalendar(page, { rows });
  await page.locator('#btnViewSchedule').click();
  await expect(page.locator('.cal-schedule-bar[data-job-id="job-consecutive"]')).toHaveCount(1);
  const bar = page.locator('.cal-schedule-bar[data-job-id="job-consecutive"]').first();
  await realDrag(page, bar, page.locator(`.cal-schedule-cell[data-date="${D.THU}"]`));

  await expect(page.getByText('Not moved - two days of this job would land on the same date')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(UNIQUE_ERROR);
  expect(writes).toHaveLength(0);
  expect(rows.filter((row) => !row.is_ghost).map((row) => row.scheduled_date).sort())
    .toEqual([D.FRI, D.SAT, D.SUN]);
  assertUnique(rows);
});

test('a cancelled row that still holds the target date is named as cancelled, not as a visit on the calendar', async ({ page }) => {
  // The feed never shows a cancelled row, but the unique key still binds it;
  // the job-scoped read supplies it and the toast must say why nothing is
  // visible where the Captain is being told a visit exists.
  const rows = [
    assignment('h-source', 'u-hugo', 'Hugo', D.MON, { role: 'lead_installer' }),
    assignment('h-cancelled', 'u-hugo', 'Hugo', D.WED, {
      role: 'lead_installer', status: 'cancelled', assignment_status: 'cancelled', feed_hidden: true,
    }),
    assignment('g-mon', 'u-shaun', null, D.MON, { role: 'observer', is_ghost: true }),
  ];
  const { writes } = await bootCalendar(page, { rows });
  const source = page.locator(`.cal-swim-cell[data-date="${D.MON}"][data-crew="Hugo"] .cal-job-block`);
  await realDrag(page, source, page.locator(`.cal-swim-cell[data-date="${D.WED}"][data-crew="Hugo"]`));

  await expect(page.getByText(`Already scheduled there — Hugo on ${fmtDate(D.WED)} (cancelled visit still holds that date)`)).toBeVisible();
  await expect(page.locator('body')).not.toContainText(UNIQUE_ERROR);
  expect(writes).toHaveLength(0);
  expect(rows.find((row) => row.id === 'h-source').scheduled_date).toBe(D.MON);
  assertUnique(rows);
});

test('a multi-crew bar blocked by a completed row names it as completed in the combined toast', async ({ page }) => {
  const rows = [
    assignment('h-0', 'u-hugo', 'Hugo', D.MON, { role: 'lead_installer' }),
    assignment('h-1', 'u-hugo', 'Hugo', D.TUE, { role: 'lead_installer' }),
    assignment('i-0', 'u-isaac', 'Isaac', D.MON),
    assignment('i-1', 'u-isaac', 'Isaac', D.TUE),
    assignment('i-done', 'u-isaac', 'Isaac', D.FRI, {
      status: 'complete', assignment_status: 'complete', feed_hidden: true,
    }),
    assignment('g-mon', 'u-shaun', null, D.MON, { role: 'observer', is_ghost: true }),
    assignment('g-tue', 'u-shaun', null, D.TUE, { role: 'observer', is_ghost: true }),
    assignment('g-fri', 'u-shaun', null, D.FRI, { role: 'observer', is_ghost: true }),
  ];
  const { writes } = await bootCalendar(page, { rows });
  await page.locator('#btnViewSchedule').click();
  const bar = page.locator('.cal-schedule-bar[data-job-id="job-consecutive"]').first();
  await expect(bar.locator('.bar-crew .crew-initial')).toHaveCount(2);
  await realDrag(page, bar, page.locator(`.cal-schedule-cell[data-date="${D.THU}"]`));

  await expect(page.getByText(`Not moved — 1 existing visit kept: Isaac on ${fmtDate(D.FRI)} (completed visit still holds that date)`)).toBeVisible();
  await expect(page.locator('body')).not.toContainText(UNIQUE_ERROR);
  expect(writes).toHaveLength(0);
  assertUnique(rows);
});

test('another visit of the same crew member stays put and refuses only the bar that would land on it', async ({ page }) => {
  // Hugo and Isaac share Mon+Tue and Isaac also has the job's Fri visit, a
  // booking of its own. The Mon+Tue bar dropped on Thu would put Isaac's Tue
  // on his Fri: the bar is all-or-nothing, so nobody moves and the Fri visit
  // is named. Dropped on Wed instead, the bar moves and Fri is untouched.
  const rows = [
    assignment('h-0', 'u-hugo', 'Hugo', D.MON, { role: 'lead_installer' }),
    assignment('h-1', 'u-hugo', 'Hugo', D.TUE, { role: 'lead_installer' }),
    assignment('i-0', 'u-isaac', 'Isaac', D.MON),
    assignment('i-1', 'u-isaac', 'Isaac', D.TUE),
    assignment('i-fri', 'u-isaac', 'Isaac', D.FRI),
    assignment('g-mon', 'u-shaun', null, D.MON, { role: 'observer', is_ghost: true }),
    assignment('g-tue', 'u-shaun', null, D.TUE, { role: 'observer', is_ghost: true }),
    assignment('g-fri', 'u-shaun', null, D.FRI, { role: 'observer', is_ghost: true }),
  ];
  const { writes } = await bootCalendar(page, { rows });
  await page.locator('#btnViewSchedule').click();
  await expect(page.locator(`.cal-schedule-bar[data-job-id="job-consecutive"]`)).toHaveCount(2);
  const bar = page.locator('.cal-schedule-bar[data-job-id="job-consecutive"]').first();
  await realDrag(page, bar, page.locator(`.cal-schedule-cell[data-date="${D.THU}"]`));
  await expect(page.getByText(`Not moved — 1 existing visit kept: Isaac on ${fmtDate(D.FRI)}`)).toBeVisible();
  await page.waitForTimeout(300);
  expect(writes).toHaveLength(0);

  await realDrag(page, page.locator('.cal-schedule-bar[data-job-id="job-consecutive"]').first(),
    page.locator(`.cal-schedule-cell[data-date="${D.WED}"]`));
  await expect.poll(() => writes.length).toBe(4);
  await expect(page.locator('body')).not.toContainText(UNIQUE_ERROR);
  const byId = Object.fromEntries(rows.map((row) => [row.id, row.scheduled_date]));
  expect([byId['h-0'], byId['h-1'], byId['i-0'], byId['i-1'], byId['i-fri']])
    .toEqual([D.WED, D.THU, D.WED, D.THU, D.FRI]);
  expect(writes.some((w) => w.body.assignmentId === 'i-fri')).toBe(false);
  assertUnique(rows);
});

test('a stretch that would remove an invoiced day says so plainly and puts the bar back', async ({ page }) => {
  // Hugo and Isaac on Mon-Wed, one row per day. Pulling the end back to Tue
  // removes both Wed rows; Isaac has already invoiced his, so ops-api refuses
  // that delete. The refusal is shown in words and the calendar re-reads.
  const rows = [
    assignment('h-0', 'u-hugo', 'Hugo', D.MON, { role: 'lead_installer' }),
    assignment('h-1', 'u-hugo', 'Hugo', D.TUE, { role: 'lead_installer' }),
    assignment('h-2', 'u-hugo', 'Hugo', D.WED, { role: 'lead_installer' }),
    assignment('i-0', 'u-isaac', 'Isaac', D.MON),
    assignment('i-1', 'u-isaac', 'Isaac', D.TUE),
    assignment('i-2', 'u-isaac', 'Isaac', D.WED, { invoiced: true }),
    assignment('g-mon', 'u-shaun', null, D.MON, { role: 'observer', is_ghost: true }),
    assignment('g-tue', 'u-shaun', null, D.TUE, { role: 'observer', is_ghost: true }),
    assignment('g-wed', 'u-shaun', null, D.WED, { role: 'observer', is_ghost: true }),
  ];
  const { writes } = await bootCalendar(page, { rows });
  await page.locator('#btnViewSchedule').click();
  const bar = page.locator('.cal-schedule-bar[data-job-id="job-consecutive"]').first();
  await bar.hover();
  await realDrag(page, bar.locator('.cal-resize-handle.right'), page.locator(`.cal-schedule-cell[data-date="${D.TUE}"]`));

  await expect(page.getByText(`Not removed: Isaac on ${fmtDate(D.WED)} - This crew member has already invoiced this job (TI-0042).`, { exact: false })).toBeVisible();
  expect(writes.filter((w) => w.action === 'delete_assignment').map((w) => w.body.assignmentId).sort()).toEqual(['h-2', 'i-2']);
  expect(writes.some((w) => w.action !== 'delete_assignment')).toBe(false);
  // what the server kept is what the calendar shows after its quiet re-read
  expect(rows.find((row) => row.id === 'i-2')).toBeTruthy();
  await expect(page.locator(`.cal-schedule-bar[data-job-id="job-consecutive"] .bar-crew .crew-initial`).first()).toBeVisible();
  assertUnique(rows);
});

test('a bar drag whose job read failed moves nothing and says so', async ({ page }) => {
  const { rows, writes } = await bootCalendar(page, { jobDetailFails: true });
  await page.locator('#btnViewSchedule').click();
  const bar = page.locator('.cal-schedule-bar[data-job-id="job-consecutive"]').first();
  await realDrag(page, bar, page.locator(`.cal-schedule-cell[data-date="${D.TUE}"]`));
  await expect(page.getByText("Not changed - could not read this job's bookings. Try again.")).toBeVisible();
  expect(writes).toHaveLength(0);
  expect(rows.filter((row) => !row.is_ghost && row.user_id === 'u-hugo').map((row) => row.scheduled_date).sort())
    .toEqual([D.MON, D.TUE, D.WED]);
});
