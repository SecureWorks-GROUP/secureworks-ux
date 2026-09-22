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
};

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

function reconcileGhosts(rows) {
  const realDates = new Set(rows.filter((row) => !row.is_ghost).map((row) => row.scheduled_date));
  for (let index = rows.length - 1; index >= 0; index--) {
    if (rows[index].is_ghost && !realDates.has(rows[index].scheduled_date)) rows.splice(index, 1);
  }
  for (const date of realDates) {
    if (rows.some((row) => row.is_ghost && row.scheduled_date === date)) continue;
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
      return json({ events: rows.filter((row) => !row.is_ghost).map((row) => ({ ...row })) });
    }
    if (action === 'pipeline') return json({ columns: { accepted: [] } });
    if (action === 'get_crew_availability') return json({ availability: [] });
    if (action === 'list_users') return json({ users: USERS });
    if (action === 'send_client_update') return json({ ok: true, sent: true });
    if (action === 'create_assignment' || action === 'delete_assignment') {
      writes.push({ action, body: route.request().postDataJSON() });
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

test('a genuine visit already on the target date is kept and the separate visit is not dropped', async ({ page }) => {
  const rows = [
    assignment('h-source', 'u-hugo', 'Hugo', D.MON, { role: 'lead_installer' }),
    assignment('h-existing', 'u-hugo', 'Hugo', D.WED, { role: 'lead_installer' }),
    assignment('g-mon', 'u-shaun', null, D.MON, { role: 'observer', is_ghost: true }),
    assignment('g-wed', 'u-shaun', null, D.WED, { role: 'observer', is_ghost: true }),
  ];
  const { writes } = await bootCalendar(page, { rows });
  await page.locator('#btnViewSchedule').click();
  const sourceBar = page.locator('.cal-schedule-bar[data-job-id="job-consecutive"]').first();
  await realDrag(page, sourceBar, page.locator(`.cal-schedule-cell[data-date="${D.WED}"]`));

  await expect(page.getByText('Already scheduled there — existing visit kept')).toBeVisible();
  expect(writes).toHaveLength(0);
  expect(rows.filter((row) => !row.is_ghost).map((row) => row.scheduled_date).sort())
    .toEqual([D.MON, D.WED]);
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
