// Sign in and sign out on a job: one tap each (Captain, 2026-10-13).
//
// "when they get to a job they just click like I've arrived on site and then
// when they leave they just click like leave ... it shouldn't be complicated
// or clunky." The pure rules are pinned in scripts/test-trade-site-visit.js;
// this spec proves a trade on a phone meets them on the real screens: the
// Today card, the job screen and the signed-in bar. The one-tap Sign in and
// Sign out switch on only where ops-api keeps the visit record, which the app
// reads from one field: `open_site_visit` on my_jobs (null counts). Against
// the ops-api that is live today the job screen keeps "Start work" and "End
// my day", and the last cases here hold that. No request leaves the machine.
const { test, expect } = require('@playwright/test');
const { installSupabaseAuthStub, signIn } = require('../helpers/auth');
const { installFeedStubs, installExternalRequestGuard, perthDate, addIsoDays } = require('../helpers/feed-stub');

const SUPABASE_ORIGIN = 'https://kevgrhcjxspbxgovpmfl.supabase.co';
const APP_ORIGIN = new URL(process.env.E2E_BASE_URL || 'http://127.0.0.1:4173').origin;
const OPS_API = `${SUPABASE_ORIGIN}/functions/v1/ops-api`;
const ORG = '00000000-0000-0000-0000-000000000001';

const P = {
  alyx: { email: 'alyx@example.test', password: 'x', profile: { id: 'e2e-alyx', email: 'alyx@example.test', name: 'Alyx', role: 'crew', trade_tier: 1, managed_verticals: [], invoice_type: 'hourly', org_id: ORG } },
  hugo: { email: 'hugo@example.test', password: 'x', profile: { id: 'e2e-hugo', email: 'hugo@example.test', name: 'Hugo', role: 'ops_manager', trade_tier: 2, managed_verticals: [], makesafe_manager: true, invoice_type: 'hourly', org_id: ORG } }
};

const TODAY = perthDate();
const EMPTY = { today: [], thisWeek: [], upcoming: [], recent: [], recentCompleted: [], unscheduled: [], makesafePool: [] };

function row(id, jobId, number, suburb, extra) {
  return Object.assign({
    id, scheduled_date: TODAY, scheduled_end: null, start_time: '07:00', status: 'confirmed', role: 'installer', notes: null,
    assignment_type: null, crew_name: 'Alyx', started_at: null, completed_at: null, clocked_on_at: null, clocked_off_at: null,
    break_minutes: 0, job_phase: null,
    jobs: { id: jobId, type: 'fencing', status: 'scheduled', archived: false, client_name: 'Fence Client', client_phone: null, client_email: null, site_address: suburb + ' WA', site_suburb: suburb, notes: null, job_number: number, metadata: {} }
  }, extra || {});
}
const NORTHFIELD = () => row('e2e-asg-north', 'e2e-job-north', 'SWF-270010', 'Northfield');
const KINROSS = () => row('e2e-asg-kinross', 'e2e-job-kinross', 'SWF-270011', 'Kinross');

// An ops-api that keeps the visit record (the paired back end).
function visitApi(state) {
  return async ({ request }) => {
    const body = request.postDataJSON();
    if (body.event === 'clock_on') {
      if (state.open && state.open.job_id !== body.job_id && !body.switch) {
        return { status: 409, body: { error: 'Already signed in', code: 'already_signed_in', ...state.open } };
      }
      state.open = { visit_id: 'e2e-visit-' + (++state.n), job_id: body.job_id, job_number: 'SWF', site_suburb: body.job_id === 'e2e-job-north' ? 'Northfield' : 'Kinross', signed_in_at: body.timestamp, status: 'open' };
      return { success: true, assignment: { id: body.assignment_id, status: 'in_progress', started_at: body.timestamp, clocked_on_at: body.timestamp, clocked_off_at: null }, site_visit: state.open };
    }
    const closed = state.open;
    state.open = null;
    return { success: true, assignment: { id: body.assignment_id, status: 'in_progress', clocked_on_at: closed ? closed.signed_in_at : null, clocked_off_at: body.timestamp }, site_visit: { ...closed, signed_out_at: body.timestamp, status: 'closed' } };
  };
}
// The ops-api as it is live today: no visit record, a sign out completes the row.
function olderApi() {
  return async ({ request }) => {
    const body = request.postDataJSON();
    return body.event === 'clock_on'
      ? { success: true, assignment: { id: body.assignment_id, status: 'in_progress', started_at: body.timestamp, clocked_on_at: body.timestamp, clocked_off_at: null } }
      : { success: true, assignment: { id: body.assignment_id, status: 'complete', clocked_off_at: body.timestamp, hours_worked: 1 }, net_hours: 1 };
  };
}

async function boot(page, persona, actions, { allowedWriteActions = ['clock_event'], openJobs = true, now = null } = {}) {
  await installExternalRequestGuard(page, { allowedOrigins: [APP_ORIGIN] });
  await installSupabaseAuthStub(page, {
    users: Object.fromEntries(Object.values(P).map((entry) => [entry.email, entry])),
    profileEndpoint: `${SUPABASE_ORIGIN}/functions/v1/ghl-proxy`
  });
  const requestLog = [];
  await installFeedStubs(page, {
    endpoint: OPS_API,
    actions: { search_all_jobs: { lens: 'assigned', jobs: [], total: 0 }, ...actions },
    allowedWriteActions,
    requestLog
  });
  await page.setViewportSize({ width: 390, height: 844 });
  // A case about the time of day sets the phone's clock; time still runs.
  if (now) await page.clock.install({ time: now });
  await page.goto('/trade.html');
  await signIn(page, P[persona]);
  // The "you did not sign out" question opens over the app at sign-in; those
  // cases answer it before they go anywhere.
  if (openJobs) await page.locator('[data-view="myJobs"]').click();
  return { requestLog };
}

function detail(row, crewRow) {
  return {
    access_tier: 'allocated', job: row.jobs,
    crew: [crewRow || { id: row.id, user_id: P.alyx.profile.id, users: { id: P.alyx.profile.id, name: 'Alyx' }, status: row.status, scheduled_date: TODAY, start_time: '07:00', started_at: row.started_at, clocked_on_at: row.clocked_on_at, clocked_off_at: row.clocked_off_at }],
    purchaseOrders: [], media: [], notes: [], documents: [], quote_packs: [], quote_extracts: [], workOrder: null
  };
}

const PLAIN = /clock|timer|shift/i;
const taps = (log) => log.filter((r) => r.action === 'clock_event').map((r) => r.body);
const card = (page, number) => page.locator('#myJobsList .jc').filter({ hasText: number });

test('Today card: one tap signs in, one tap signs out, and nothing else is asked', async ({ page }) => {
  const state = { open: null, n: 0 };
  const { requestLog } = await boot(page, 'alyx', {
    my_jobs: () => ({ ...EMPTY, today: [NORTHFIELD()], open_site_visit: state.open }),
    clock_event: visitApi(state),
    set_site_visit_break: { success: true }
  }, { allowedWriteActions: ['clock_event', 'set_site_visit_break'] });

  const north = card(page, 'SWF-270010');
  await expect(north.locator('[data-card-signin]')).toHaveText('Sign in');
  await expect(page.locator('#siteVisitBar')).toBeHidden();

  // One tap. No confirm, no second screen, and the card does not open the job.
  await north.locator('[data-card-signin]').click();
  await expect.poll(() => taps(requestLog).length).toBe(1);
  await expect(page.locator('#toast')).toContainText(/Signed in \d{1,2}:\d{2} (am|pm)/);
  await expect(page.locator('#toast')).not.toContainText(PLAIN);
  await expect(page.locator('#confirmOverlay')).not.toHaveClass(/active/);
  await expect(page.locator('#viewMyJobs')).toHaveClass(/active/);
  const signIn = taps(requestLog)[0];
  expect(signIn).toEqual(expect.objectContaining({ event: 'clock_on', assignment_id: 'e2e-asg-north', job_id: 'e2e-job-north' }));
  expect(Number.isNaN(Date.parse(signIn.timestamp))).toBe(false);
  expect(typeof signIn.idempotency_key).toBe('string');

  // The bar follows them around the app and carries the Sign out.
  const bar = page.locator('#siteVisitBar');
  await expect(bar).toBeVisible();
  await expect(bar).toContainText(/Signed in \d{1,2}:\d{2} (am|pm)/);
  await expect(bar).toContainText('Northfield');
  await expect(bar).not.toContainText(PLAIN);
  await expect(north).not.toContainText(PLAIN);
  await page.locator('[data-view="hours"]').click();
  await expect(bar).toBeVisible();
  await page.locator('[data-view="myJobs"]').click();
  await expect(north.locator('[data-card-signin]')).toHaveCount(0);
  await expect(north.locator('[data-card-signout]')).toHaveText('Sign out');

  await north.locator('[data-card-signout]').click();
  await expect.poll(() => taps(requestLog).length).toBe(2);
  expect(taps(requestLog)[1]).toEqual(expect.objectContaining({ event: 'clock_off', assignment_id: 'e2e-asg-north', job_id: 'e2e-job-north' }));
  await expect(page.locator('#toast')).toContainText(/Signed out \d{1,2}:\d{2} (am|pm)/);
  await expect(page.locator('#toast')).not.toContainText(PLAIN);

  // Afterwards, and only as an offer: had a break? Skipping it means none.
  await expect(bar.locator('[data-site-break]')).toContainText('Had a break?');
  await expect(bar).not.toContainText(PLAIN);
  await bar.locator('[data-site-break-min="30"]').click();
  await expect.poll(() => requestLog.filter((r) => r.action === 'set_site_visit_break').map((r) => r.body)).toEqual([{ visit_id: 'e2e-visit-1', break_minutes: 30 }]);
  await expect(bar).toBeHidden();
  // Signed out, the job is still theirs to sign in to again (a second visit).
  await expect(north.locator('[data-card-signin]')).toHaveText('Sign in');

  // No word a trade does not use, and no message of any kind was sent.
  expect(requestLog.filter((r) => r.method !== 'GET').map((r) => r.action).sort()).toEqual(['clock_event', 'clock_event', 'set_site_visit_break']);
});

test('the location rides inside the tap when the phone gives one; a sign in is never held up for it', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: -31.9523, longitude: 115.8613, accuracy: 12 });
  const state = { open: null, n: 0 };
  const { requestLog } = await boot(page, 'alyx', {
    my_jobs: () => ({ ...EMPTY, today: [NORTHFIELD()], open_site_visit: state.open }),
    clock_event: visitApi(state)
  });
  await card(page, 'SWF-270010').locator('[data-card-signin]').click();
  await expect.poll(() => taps(requestLog).length).toBe(1);
  expect(taps(requestLog)[0].location).toEqual({ lat: -31.9523, lng: 115.8613, accuracy: 12 });
  // The separate location note is gone: the tap is the only write.
  expect(requestLog.filter((r) => r.method !== 'GET').map((r) => r.action)).toEqual(['clock_event']);
});

test('signed in at another job: asked once, and one tap signs out there and in here', async ({ page }) => {
  const state = { open: { visit_id: 'e2e-visit-north', job_id: 'e2e-job-north', job_number: 'SWF-270010', site_suburb: 'Northfield', signed_in_at: `${TODAY}T07:02:00+08:00`, status: 'open' }, n: 5 };
  const north = { ...NORTHFIELD(), status: 'in_progress', clocked_on_at: `${TODAY}T07:02:00+08:00` };
  const { requestLog } = await boot(page, 'alyx', {
    my_jobs: () => ({ ...EMPTY, today: [north, KINROSS()], open_site_visit: state.open }),
    clock_event: visitApi(state)
  });
  await expect(page.locator('#siteVisitBar')).toContainText('Signed in 7:02 am');
  await expect(page.locator('#siteVisitBar')).toContainText('Northfield');

  await card(page, 'SWF-270011').locator('[data-card-signin]').click();
  await expect(page.locator('#confirmOverlay')).toHaveClass(/active/);
  await expect(page.locator('#confirmMsg')).toHaveText('Sign out of Northfield and sign in here?');
  expect(taps(requestLog)).toEqual([]);
  await page.locator('#confirmOk').click();
  await expect.poll(() => taps(requestLog).length).toBe(1);
  expect(taps(requestLog)[0]).toEqual(expect.objectContaining({ event: 'clock_on', assignment_id: 'e2e-asg-kinross', job_id: 'e2e-job-kinross', switch: true }));
  await expect(page.locator('#siteVisitBar')).toContainText('Kinross');
  await expect(card(page, 'SWF-270011').locator('[data-card-signout]')).toBeVisible();
  await expect(card(page, 'SWF-270010').locator('[data-card-signout]')).toHaveCount(0);
});

test('the server knows of a sign in this phone does not: its 409 asks the same question, then switches', async ({ page }) => {
  const state = { open: { visit_id: 'e2e-visit-north', job_id: 'e2e-job-north', job_number: 'SWF-270010', site_suburb: 'Northfield', signed_in_at: `${TODAY}T07:02:00+08:00`, status: 'open' }, n: 5 };
  const { requestLog } = await boot(page, 'alyx', {
    // They signed in on another phone after this one last asked: it cannot know.
    my_jobs: () => ({ ...EMPTY, today: [KINROSS()], open_site_visit: null }),
    clock_event: visitApi(state)
  });
  await card(page, 'SWF-270011').locator('[data-card-signin]').click();
  await expect(page.locator('#confirmMsg')).toHaveText('Sign out of Northfield and sign in here?');
  // A sign in the server would not double up on is a question, not a failure.
  await expect(page.locator('#toast')).not.toContainText('Not saved');
  await page.locator('#confirmOk').click();
  await expect.poll(() => taps(requestLog).length).toBe(2);
  expect(taps(requestLog)[0].switch).toBeUndefined();
  expect(taps(requestLog)[1]).toEqual(expect.objectContaining({ event: 'clock_on', job_id: 'e2e-job-kinross', switch: true, timestamp: taps(requestLog)[0].timestamp }));
  await expect(page.locator('#siteVisitBar')).toContainText('Kinross');
});

test('the bar signs out of the job they are signed in to, never the job screen opened last', async ({ page }) => {
  const state = { open: { visit_id: 'e2e-visit-north', job_id: 'e2e-job-north', job_number: 'SWF-270010', site_suburb: 'Northfield', signed_in_at: `${TODAY}T07:02:00+08:00`, status: 'open' }, n: 5 };
  const north = { ...NORTHFIELD(), status: 'in_progress', started_at: `${TODAY}T07:02:00+08:00`, clocked_on_at: `${TODAY}T07:02:00+08:00` };
  const kinross = KINROSS();
  const { requestLog } = await boot(page, 'alyx', {
    my_jobs: () => ({ ...EMPTY, today: [north, kinross], open_site_visit: state.open }),
    trade_job_detail: () => detail(kinross),
    clock_event: visitApi(state)
  });
  const bar = page.locator('#siteVisitBar');
  await expect(bar).toContainText('Northfield');

  // They open the other job to look at it. They are not signed in there.
  await card(page, 'SWF-270011').click();
  const stepper = page.locator('[data-job-stepper]');
  await expect(stepper).toHaveAttribute('data-signed-in', '0');
  await expect(stepper.locator('[data-stepper-start]')).toHaveText('Sign in');
  await expect(bar).toContainText('Northfield');

  await bar.locator('[data-site-bar-signout]').click();
  await expect.poll(() => taps(requestLog).length).toBe(1);
  expect(taps(requestLog)[0]).toEqual(expect.objectContaining({ event: 'clock_off', assignment_id: 'e2e-asg-north', job_id: 'e2e-job-north' }));
  await expect(page.locator('#toast')).toContainText(/Signed out \d{1,2}:\d{2} (am|pm)/);
  // The job on screen was never touched, and the break offer is for the job they left.
  await expect(bar.locator('[data-site-break]')).toContainText('Had a break?');
  await expect(stepper.locator('[data-stepper-start]')).toHaveText('Sign in');
  expect(state.open).toBe(null);
});

test('signed in from the card: an expense links to the job they are signed in to, not the job screen opened last', async ({ page }) => {
  const state = { open: null, n: 0 };
  const north = NORTHFIELD();
  const kinross = KINROSS();
  await boot(page, 'alyx', {
    my_jobs: () => ({ ...EMPTY, today: [north, kinross], open_site_visit: state.open }),
    trade_job_detail: () => detail(kinross),
    clock_event: visitApi(state)
  });
  // They read the other job's screen, go back, and sign in at Northfield.
  await card(page, 'SWF-270011').click();
  await expect(page.locator('[data-job-stepper] [data-stepper-start]')).toHaveText('Sign in');
  await page.locator('[data-view="myJobs"]').click();
  await card(page, 'SWF-270010').locator('[data-card-signin]').click();
  await expect(page.locator('#siteVisitBar')).toContainText('Northfield');

  await page.evaluate(() => window.openExpenseOverlay());
  const expense = page.locator('#expenseBody');
  await expect(expense).toContainText('Linking to');
  await expect(expense).toContainText('SWF-270010');
  await expect(expense).not.toContainText('SWF-270011');
});

test('a my_jobs answer asked for before a sign in does not undo it', async ({ page }) => {
  const state = { open: null, n: 0 };
  let holdNext = false;
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const { requestLog } = await boot(page, 'alyx', {
    my_jobs: async () => {
      // Answered from before the tap: nobody signed in, the row not started.
      const stale = { ...EMPTY, today: [NORTHFIELD()], open_site_visit: null };
      if (holdNext) { holdNext = false; await held; return stale; }
      return { ...EMPTY, today: [NORTHFIELD()], open_site_visit: state.open };
    },
    clock_event: visitApi(state)
  });
  const north = card(page, 'SWF-270010');
  await expect(north.locator('[data-card-signin]')).toHaveText('Sign in');

  // The list repaints from what it holds and refreshes behind it.
  await page.locator('[data-view="hours"]').click();
  holdNext = true;
  const before = requestLog.filter((r) => r.action === 'my_jobs').length;
  await page.locator('[data-view="myJobs"]').click();
  await expect.poll(() => requestLog.filter((r) => r.action === 'my_jobs').length).toBe(before + 1);
  await north.locator('[data-card-signin]').click();
  await expect.poll(() => taps(requestLog).length).toBe(1);
  const bar = page.locator('#siteVisitBar');
  await expect(bar).toContainText(/Signed in \d{1,2}:\d{2} (am|pm)/);

  const answered = page.waitForResponse((r) => new URL(r.url()).searchParams.get('action') === 'my_jobs');
  release();
  await answered;
  await page.waitForTimeout(400);
  await expect(bar).toContainText(/Signed in \d{1,2}:\d{2} (am|pm)/);
  await expect(north.locator('[data-card-signout]')).toHaveText('Sign out');
  await expect(north.locator('[data-card-signin]')).toHaveCount(0);
});

test('forgot to sign out: the trade types the time they left, and it is saved as typed', async ({ page }) => {
  const yesterday = addIsoDays(TODAY, -1);
  let open = { visit_id: 'e2e-visit-late', job_id: 'e2e-job-north', job_number: 'SWF-270010', site_suburb: 'Northfield', signed_in_at: `${yesterday}T07:02:00+08:00`, status: 'no_sign_out' };
  const { requestLog } = await boot(page, 'alyx', {
    my_jobs: () => ({ ...EMPTY, today: [KINROSS()], open_site_visit: open }),
    close_site_visit_late: () => { open = null; return { success: true }; }
  }, { allowedWriteActions: ['clock_event', 'close_site_visit_late'], openJobs: false });

  const overlay = page.locator('#siteLateOverlay');
  await expect(overlay).toBeVisible({ timeout: 10000 });
  await expect(overlay).toContainText('You did not sign out');
  await expect(overlay.locator('#siteLateMsg')).toHaveText(/^You are still signed in at Northfield since 7:02 am \w+day\. What time did you leave\?$/);
  // They are never sent to the office for their own sign in, and no finish is guessed.
  await expect(page.locator('body')).not.toContainText('ask the office to close it');
  await expect(overlay.locator('#siteLateTime')).toHaveValue('');

  await overlay.locator('#siteLateSave').click();
  await expect(overlay.locator('#siteLateErr')).toHaveText('Add the time you left.');
  await overlay.locator('#siteLateTime').fill('07:02');
  await overlay.locator('#siteLateSave').click();
  await expect(overlay.locator('#siteLateErr')).toContainText('must be after you signed in at 7:02 am');
  expect(requestLog.filter((r) => r.action === 'close_site_visit_late')).toEqual([]);

  await overlay.locator('#siteLateTime').fill('15:30');
  await overlay.locator('#siteLateSave').click();
  await expect.poll(() => requestLog.filter((r) => r.action === 'close_site_visit_late').map((r) => r.body)).toEqual([{ visit_id: 'e2e-visit-late', finish_date: yesterday, finish_time: '15:30' }]);
  // A time on the day they signed in names no other day.
  await expect(page.locator('#toast')).not.toContainText('the day after');
  await expect(overlay).toHaveCount(0);
  await expect(page.locator('#toast')).toContainText('Marked as typed');
  await expect(page.locator('#siteVisitBar')).toBeHidden();
});

test('a leave time typed later may fall on the day after the sign in, and says which day', async ({ page }) => {
  // A night callout, two nights ago: signed in 11:30 pm, never signed out.
  const signedInDay = addIsoDays(TODAY, -2);
  let open = { visit_id: 'e2e-visit-night', job_id: 'e2e-job-north', job_number: 'SWF-270010', site_suburb: 'Northfield', signed_in_at: `${signedInDay}T23:30:00+08:00`, status: 'no_sign_out' };
  const { requestLog } = await boot(page, 'alyx', {
    my_jobs: () => ({ ...EMPTY, today: [KINROSS()], open_site_visit: open }),
    close_site_visit_late: () => { open = null; return { success: true }; }
  }, { allowedWriteActions: ['clock_event', 'close_site_visit_late'], openJobs: false });

  const overlay = page.locator('#siteLateOverlay');
  await expect(overlay.locator('#siteLateMsg')).toHaveText(/^You are still signed in at Northfield since 11:30 pm \w+day\. What time did you leave\?$/, { timeout: 10000 });
  await expect(overlay.locator('#siteLateDay')).toBeHidden();
  // 1:15 am can only be the morning after: the app says so before they save.
  await overlay.locator('#siteLateTime').fill('01:15');
  await expect(overlay.locator('#siteLateDay')).toHaveText(/^That is 1:15 am \w+day, the day after you signed in\.$/);
  await expect(overlay.locator('#siteLateErr')).toBeHidden();
  // A time before midnight is the night they signed in, and names no day.
  await overlay.locator('#siteLateTime').fill('23:45');
  await expect(overlay.locator('#siteLateDay')).toBeHidden();

  await overlay.locator('#siteLateTime').fill('01:15');
  await overlay.locator('#siteLateSave').click();
  await expect.poll(() => requestLog.filter((r) => r.action === 'close_site_visit_late').map((r) => r.body))
    .toEqual([{ visit_id: 'e2e-visit-night', finish_date: addIsoDays(signedInDay, 1), finish_time: '01:15' }]);
  await expect(overlay).toHaveCount(0);
  await expect(page.locator('#toast')).toContainText(/you left at 1:15 am \w+day, the day after you signed in\. Marked as typed/);
});

test('signed in 11:30 pm, still on site after midnight: the sign in stays live and 1:15 am is one tap', async ({ page }) => {
  const yesterday = addIsoDays(TODAY, -1);
  const state = { open: { visit_id: 'e2e-visit-night', job_id: 'e2e-job-north', job_number: 'SWF-270010', site_suburb: 'Northfield', signed_in_at: `${yesterday}T23:30:00+08:00`, status: 'open' }, n: 5 };
  const north = { ...NORTHFIELD(), status: 'in_progress', started_at: `${yesterday}T23:30:00+08:00`, clocked_on_at: `${yesterday}T23:30:00+08:00` };
  const leftAt = new Date(`${TODAY}T01:15:00+08:00`);
  const { requestLog } = await boot(page, 'alyx', {
    my_jobs: () => ({ ...EMPTY, today: [north], open_site_visit: state.open }),
    trade_job_detail: () => detail(north),
    clock_event: visitApi(state)
  }, { now: leftAt });

  // Nothing calls it forgotten: no question, and Sign out is where it was.
  const bar = page.locator('#siteVisitBar');
  await expect(bar).toContainText('Signed in 11:30 pm');
  await expect(bar.locator('[data-site-bar-signout]')).toHaveText('Sign out');
  await expect(bar.locator('[data-site-bar-late]')).toHaveCount(0);
  await expect(bar).not.toContainText('You did not sign out');
  await expect(page.locator('#siteLateOverlay')).toHaveCount(0);
  await expect(card(page, 'SWF-270010').locator('[data-card-signout]')).toHaveText('Sign out');
  await card(page, 'SWF-270010').click();
  const stepper = page.locator('[data-job-stepper]');
  await expect(stepper).toHaveAttribute('data-signed-in', '1');
  await expect(stepper.locator('[data-signed-in-state]')).toContainText('Signed in 11:30 pm');
  await expect(stepper.locator('[data-stepper-endday]')).toHaveText('Sign out');

  await stepper.locator('[data-stepper-endday]').click();
  await expect.poll(() => taps(requestLog).length).toBe(1);
  const out = taps(requestLog)[0];
  expect(out).toEqual(expect.objectContaining({ event: 'clock_off', assignment_id: 'e2e-asg-north', job_id: 'e2e-job-north' }));
  // The tap carries its own time, 1:15 am on the day after the sign in.
  expect(Math.abs(Date.parse(out.timestamp) - leftAt.getTime())).toBeLessThan(120000);
  await expect(page.locator('#toast')).toContainText(/Signed out 1:1[5-7] am/);
  expect(requestLog.filter((r) => r.action === 'close_site_visit_late')).toEqual([]);
  expect(state.open).toBe(null);
});

test('forgot to sign out, answered "Not now": the bar keeps the question and a new sign in is not blocked', async ({ page }) => {
  const yesterday = addIsoDays(TODAY, -1);
  const late = { visit_id: 'e2e-visit-late', job_id: 'e2e-job-north', job_number: 'SWF-270010', site_suburb: 'Northfield', signed_in_at: `${yesterday}T07:02:00+08:00`, status: 'no_sign_out' };
  // The server holds the forgotten sign in too. As the contract asks, it does
  // not refuse a new sign in over it and does not close it.
  const state = { open: null, owing: { ...late }, n: 0 };
  const { requestLog } = await boot(page, 'alyx', {
    my_jobs: () => ({ ...EMPTY, today: [KINROSS()], open_site_visit: state.owing }),
    clock_event: visitApi(state)
  }, { openJobs: false });
  await page.locator('#siteLateSkip').click();
  await expect(page.locator('#siteLateOverlay')).toHaveCount(0);
  await page.locator('[data-view="myJobs"]').click();
  const bar = page.locator('#siteVisitBar');
  await expect(bar).toContainText('You did not sign out');
  await expect(bar.locator('[data-site-bar-late]')).toHaveText('Add the time you left');
  await expect(bar.locator('[data-site-bar-signout]')).toHaveCount(0);

  // Signing in elsewhere asks for the leave time once more, then goes ahead.
  await card(page, 'SWF-270011').locator('[data-card-signin]').click();
  await expect(page.locator('#siteLateOverlay')).toBeVisible();
  await page.locator('#siteLateSkip').click();
  await expect.poll(() => taps(requestLog).length).toBe(1);
  expect(taps(requestLog)[0]).toEqual(expect.objectContaining({ event: 'clock_on', job_id: 'e2e-job-kinross' }));
  expect(taps(requestLog)[0].switch).toBeUndefined();
  await expect(page.locator('#toast')).toContainText('Signed in');
  // The forgotten sign in was given no finish: it still waits for the trade.
  expect(state.owing).toEqual(late);
});

test('a server that refuses a sign in over a forgotten one: the trade types the time they left, and it is never closed by a switch', async ({ page }) => {
  const yesterday = addIsoDays(TODAY, -1);
  // The server's 409 names a sign in that owes its finish. This phone had not heard of it.
  const state = { open: { visit_id: 'e2e-visit-late', job_id: 'e2e-job-north', job_number: 'SWF-270010', site_suburb: 'Northfield', signed_in_at: `${yesterday}T07:02:00+08:00`, status: 'no_sign_out' }, n: 5 };
  const { requestLog } = await boot(page, 'alyx', {
    my_jobs: () => ({ ...EMPTY, today: [KINROSS()], open_site_visit: null }),
    clock_event: visitApi(state),
    close_site_visit_late: () => { state.open = null; return { success: true }; }
  }, { allowedWriteActions: ['clock_event', 'close_site_visit_late'] });

  await card(page, 'SWF-270011').locator('[data-card-signin]').click();
  const overlay = page.locator('#siteLateOverlay');
  await expect(overlay.locator('#siteLateMsg')).toHaveText(/^You are still signed in at Northfield since 7:02 am \w+day\. What time did you leave\?$/);
  // It is the leave-time question, not "Sign out of Northfield and sign in here?".
  await expect(page.locator('#confirmOverlay')).not.toHaveClass(/active/);

  // "Not now": nothing is guessed for them, so nothing is sent.
  await overlay.locator('#siteLateSkip').click();
  await expect(page.locator('#toast')).toContainText('Add the time you left Northfield before you sign in here.');
  expect(taps(requestLog).filter((b) => b.switch)).toEqual([]);
  expect(state.open.visit_id).toBe('e2e-visit-late');

  // They give the time: it is saved as typed, then the sign in goes through.
  await card(page, 'SWF-270011').locator('[data-card-signin]').click();
  await overlay.locator('#siteLateTime').fill('15:30');
  await overlay.locator('#siteLateSave').click();
  await expect.poll(() => requestLog.filter((r) => r.action === 'close_site_visit_late').map((r) => r.body))
    .toEqual([{ visit_id: 'e2e-visit-late', finish_date: yesterday, finish_time: '15:30' }]);
  await expect(page.locator('#siteVisitBar')).toContainText('Kinross');
  expect(taps(requestLog).filter((b) => b.switch)).toEqual([]);
  expect(taps(requestLog).every((b) => b.event === 'clock_on' && b.job_id === 'e2e-job-kinross')).toBe(true);
});

test('no signal: the tap is kept with its tap time and shows "waiting for signal"', async ({ page }) => {
  const { requestLog } = await boot(page, 'alyx', {
    my_jobs: () => ({ ...EMPTY, today: [NORTHFIELD()], open_site_visit: null }),
    clock_event: { success: true }
  });
  await page.route(`${OPS_API}**`, async (route) => {
    if (new URL(route.request().url()).searchParams.get('action') === 'clock_event') return route.abort('internetdisconnected');
    return route.fallback();
  });
  await card(page, 'SWF-270010').locator('[data-card-signin]').click();
  await expect(page.locator('#toast')).toContainText(/Signed in \d{1,2}:\d{2} (am|pm) · waiting for signal/);
  await expect(page.locator('#siteVisitBar')).toContainText('waiting for signal');
  await expect(card(page, 'SWF-270010').locator('[data-card-signout]')).toBeVisible();
  const queued = await page.evaluate(() => JSON.parse(localStorage.getItem('sw_action_queue') || '[]').filter((i) => i && i.action === 'clock_event').map((i) => i.body));
  expect(queued).toHaveLength(1);
  expect(queued[0]).toEqual(expect.objectContaining({ event: 'clock_on', assignment_id: 'e2e-asg-north', job_id: 'e2e-job-north' }));
  expect(Math.abs(Date.now() - Date.parse(queued[0].timestamp))).toBeLessThan(60000);
  expect(requestLog.filter((r) => r.action === 'clock_event')).toEqual([]);
});

test('no signal all day: the sign in and the sign out reach the server in the order they were tapped', async ({ page }) => {
  const state = { open: null, n: 0 };
  let signal = false;
  const { requestLog } = await boot(page, 'alyx', {
    my_jobs: () => ({ ...EMPTY, today: [NORTHFIELD()], open_site_visit: state.open }),
    clock_event: visitApi(state)
  });
  await page.route(`${OPS_API}**`, async (route) => {
    if (!signal && new URL(route.request().url()).searchParams.get('action') === 'clock_event') return route.abort('internetdisconnected');
    return route.fallback();
  });
  const north = card(page, 'SWF-270010');
  await north.locator('[data-card-signin]').click();
  await expect(page.locator('#toast')).toContainText(/Signed in \d{1,2}:\d{2} (am|pm) · waiting for signal/);
  await north.locator('[data-card-signout]').click();
  await expect(page.locator('#toast')).toContainText(/Signed out \d{1,2}:\d{2} (am|pm) · waiting for signal/);
  await expect(page.locator('#siteVisitBar')).toContainText('waiting for signal');
  const queued = () => page.evaluate(() => JSON.parse(localStorage.getItem('sw_action_queue') || '[]').filter((i) => i && i.action === 'clock_event').map((i) => i.body.event));
  await expect.poll(queued).toEqual(['clock_on', 'clock_off']);
  expect(taps(requestLog)).toEqual([]);

  // Back in coverage.
  signal = true;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => taps(requestLog).map((b) => b.event), { timeout: 12000 }).toEqual(['clock_on', 'clock_off']);
  const sent = taps(requestLog);
  expect(Date.parse(sent[0].timestamp)).toBeLessThan(Date.parse(sent[1].timestamp));
  await expect.poll(queued).toEqual([]);
  await expect(page.locator('#siteVisitBar')).toBeHidden();
  // Each tap went once, and the trade is told nothing was lost.
  await page.waitForTimeout(600);
  expect(taps(requestLog).map((b) => b.event)).toEqual(['clock_on', 'clock_off']);
  await expect(page.locator('#toast')).not.toContainText('was not saved');
  expect(state.open).toBe(null);
});

test('weak signal: a sign in still waiting is sent before the sign out that gets through', async ({ page }) => {
  const state = { open: null, n: 0 };
  let signal = false;
  const { requestLog } = await boot(page, 'alyx', {
    my_jobs: () => ({ ...EMPTY, today: [NORTHFIELD()], open_site_visit: state.open }),
    clock_event: visitApi(state),
    set_site_visit_break: { success: true }
  });
  await page.route(`${OPS_API}**`, async (route) => {
    if (!signal && new URL(route.request().url()).searchParams.get('action') === 'clock_event') return route.abort('internetdisconnected');
    return route.fallback();
  });
  const north = card(page, 'SWF-270010');
  await north.locator('[data-card-signin]').click();
  await expect(page.locator('#toast')).toContainText('waiting for signal');
  expect(taps(requestLog)).toEqual([]);

  // The signal is back, but nothing has told the phone so.
  signal = true;
  await north.locator('[data-card-signout]').click();
  await expect.poll(() => taps(requestLog).map((b) => b.event)).toEqual(['clock_on', 'clock_off']);
  await expect(page.locator('#toast')).toContainText(/Signed out \d{1,2}:\d{2} (am|pm)$/);
  // The server closed the visit the sign in opened, so the break can go on it.
  await expect(page.locator('#siteVisitBar [data-site-break]')).toContainText('Had a break?');
  expect(state.open).toBe(null);
});

test('another crew\'s job in the Everyone list carries no Sign in', async ({ page }) => {
  const theirs = { ...NORTHFIELD(), user: { id: P.alyx.profile.id, name: 'Alyx' } };
  const mine = { ...KINROSS(), crew_name: 'Hugo', user: { id: P.hugo.profile.id, name: 'Hugo' } };
  await boot(page, 'hugo', {
    my_jobs: () => ({ ...EMPTY, today: [theirs, mine], open_site_visit: null }),
    search_all_jobs: { lens: 'company', jobs: [], total: 0 },
    makesafe_board: { schema: 'makesafe-board.v1.2', cards: [], columns: [], permissions: { sees_all_makesafes: true, can_allocate: true } }
  });
  await expect(card(page, 'SWF-270011').locator('[data-card-signin]')).toHaveText('Sign in');
  await expect(card(page, 'SWF-270010')).toBeVisible();
  await expect(card(page, 'SWF-270010').locator('[data-card-signin], [data-card-signout]')).toHaveCount(0);
});

test('job screen: Sign in, "Signed in 7:02 am", Sign out, the break offer, and a materials line that never blocks', async ({ page }) => {
  const state = { open: null, n: 0 };
  const north = NORTHFIELD();
  const crewRow = { id: north.id, user_id: P.alyx.profile.id, users: { id: P.alyx.profile.id, name: 'Alyx' }, status: 'confirmed', scheduled_date: TODAY, start_time: '07:00', clocked_on_at: null, clocked_off_at: null };
  const { requestLog } = await boot(page, 'alyx', {
    my_jobs: () => ({ ...EMPTY, today: [north], open_site_visit: state.open }),
    trade_job_detail: () => ({
      access_tier: 'allocated', job: north.jobs, crew: [crewRow],
      purchaseOrders: [{ id: 'po-1', status: 'confirmed', supplier_name: 'Fence Supply', line_items: [{ Description: 'Colorbond sheets', Quantity: 12 }] }],
      media: [], notes: [], documents: [], quote_packs: [], quote_extracts: [], workOrder: null
    }),
    clock_event: async (ctx) => {
      const out = await visitApi(state)(ctx);
      Object.assign(crewRow, out.assignment);
      return out;
    },
    set_site_visit_break: { success: true }
  }, { allowedWriteActions: ['clock_event', 'set_site_visit_break'] });

  await card(page, 'SWF-270010').click();
  const stepper = page.locator('[data-job-stepper]');
  await expect(stepper.locator('[data-stepper-start]')).toHaveText('Sign in');
  await stepper.locator('[data-stepper-start]').click();
  await expect(stepper).toHaveAttribute('data-signed-in', '1');
  await expect(stepper.locator('[data-signed-in-state]')).toContainText(/^Signed in \d{1,2}:\d{2} (am|pm)/);
  await expect(stepper.locator('#timerElapsed')).toBeVisible();
  await expect(stepper.locator('[data-stepper-finish]')).toHaveText('Job complete');
  await expect(stepper.locator('[data-stepper-endday]')).toHaveText('Sign out');

  // The materials check is a line they answer when they like, never a pop-up.
  await expect(page.locator('#materialsCheckOverlay.active')).toHaveCount(0);
  await page.waitForTimeout(800);
  await expect(page.locator('#materialsCheckOverlay.active')).toHaveCount(0);
  await expect(page.locator('[data-materials-line]')).toContainText('Materials on site?');
  await page.locator('[data-materials-line] button').click();
  await expect(page.locator('#materialsCheckOverlay')).toHaveClass(/active/);
  await page.locator('[data-materials-later]').click();
  await expect(page.locator('#materialsCheckOverlay')).not.toHaveClass(/active/);

  await stepper.locator('[data-stepper-endday]').click();
  await expect(stepper).toHaveAttribute('data-signed-in', '0');
  await expect(stepper.locator('[data-signed-out-state]')).toContainText(/^Signed out \d{1,2}:\d{2} (am|pm)$/);
  await expect(stepper.locator('[data-site-break]')).toContainText('Had a break?');
  // The break offer is on the job screen, so the bar does not repeat it.
  await expect(page.locator('#siteVisitBar')).toBeHidden();
  await stepper.locator('[data-site-break-min="0"]').click();
  await expect(stepper.locator('[data-site-break]')).toHaveCount(0);
  expect(requestLog.filter((r) => r.action === 'set_site_visit_break')).toEqual([]);
  // They can sign in again (a second visit) or finish the job from here.
  await expect(stepper.locator('[data-stepper-start]')).toHaveText('Sign in');
  await expect(stepper.locator('[data-stepper-finish]')).toHaveText('Job complete');

  // Nothing on these screens says clock, timer or shift.
  await expect(page.locator('#jobDetailContent')).not.toContainText(PLAIN);
});

// ── The ops-api that is live today: no visit record ────────────────────────
// my_jobs carries no open_site_visit key, so the one-tap Sign in and Sign out
// stay off and the app keeps the flow it had: the start and end taps on the
// job screen, where the end tap completes the day's row.
test('an ops-api with no visit record keeps today\'s flow: Start work and End my day on the job, nothing on the card or the bar', async ({ page }) => {
  const north = NORTHFIELD();
  const crewRow = { id: north.id, user_id: P.alyx.profile.id, users: { id: P.alyx.profile.id, name: 'Alyx' }, status: 'confirmed', scheduled_date: TODAY, start_time: '07:00', clocked_on_at: null, clocked_off_at: null };
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const { requestLog } = await boot(page, 'alyx', {
    my_jobs: () => ({ ...EMPTY, today: [north] }),
    trade_job_detail: () => detail(north, crewRow),
    clock_event: async (ctx) => {
      const out = await olderApi()(ctx);
      Object.assign(crewRow, out.assignment);
      return out;
    }
  });
  const bar = page.locator('#siteVisitBar');
  await expect(card(page, 'SWF-270010')).toBeVisible();
  await expect(card(page, 'SWF-270010').locator('[data-card-signin], [data-card-signout]')).toHaveCount(0);
  await expect(bar).toBeHidden();

  await card(page, 'SWF-270010').click();
  const stepper = page.locator('[data-job-stepper]');
  await expect(stepper.locator('[data-stepper-start]')).toHaveText('Start work');
  await stepper.locator('[data-stepper-start]').click();
  await expect.poll(() => taps(requestLog).map((b) => b.event)).toEqual(['clock_on']);
  await expect(page.locator('#toast')).not.toContainText(PLAIN);
  await expect(stepper).toHaveAttribute('data-stepper-state', 'working');
  await expect(stepper).toContainText('Working since');
  await expect(stepper.locator('[data-stepper-finish]')).toHaveText('Job complete');
  await expect(stepper.locator('[data-stepper-endday]')).toHaveText('End my day (job continues)');
  await expect(page.locator('#jobDetailContent')).not.toContainText(PLAIN);
  await expect(bar).toBeHidden();

  await stepper.locator('[data-stepper-endday]').click();
  await expect.poll(() => taps(requestLog).map((b) => b.event)).toEqual(['clock_on', 'clock_off']);
  await expect(page.locator('#toast')).not.toContainText(PLAIN);
  await expect(page.locator('[data-site-break]')).toHaveCount(0);
  await expect(bar).toBeHidden();
  await page.locator('[data-view="myJobs"]').click();
  await expect(card(page, 'SWF-270010').locator('[data-card-signin], [data-card-signout]')).toHaveCount(0);
  await expect(bar).toBeHidden();
  expect(requestLog.filter((r) => ['set_site_visit_break', 'close_site_visit_late'].includes(r.action))).toEqual([]);
  expect(errors).toEqual([]);
});

test('an ops-api with no visit record: starting a second job asks nothing and gives the first no finish time', async ({ page }) => {
  const since = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  const north = { ...NORTHFIELD(), status: 'in_progress', started_at: since, clocked_on_at: since };
  const kinross = KINROSS();
  const { requestLog } = await boot(page, 'alyx', {
    my_jobs: () => ({ ...EMPTY, today: [north, kinross] }),
    trade_job_detail: ({ url }) => (new URL(url).searchParams.get('jobId') === 'e2e-job-kinross' ? detail(kinross) : detail(north)),
    clock_event: olderApi()
  }, { openJobs: false });

  // The app opens the job they started, as it does today.
  const stepper = page.locator('[data-job-stepper]');
  await expect(page.locator('#viewJob')).toHaveClass(/active/, { timeout: 10000 });
  await expect(stepper.locator('[data-stepper-endday]')).toHaveText('End my day (job continues)');
  await expect(page.locator('#siteVisitBar')).toBeHidden();

  await page.locator('[data-view="myJobs"]').click();
  await card(page, 'SWF-270011').click();
  await expect(stepper.locator('[data-stepper-start]')).toHaveText('Start work');
  await stepper.locator('[data-stepper-start]').click();
  await expect.poll(() => taps(requestLog).length).toBe(1);
  await expect(page.locator('#confirmOverlay')).not.toHaveClass(/active/);
  await expect(stepper.locator('[data-stepper-endday]')).toHaveText('End my day (job continues)');
  // One tap went out, for the second job. Nothing ended the first for them.
  const sent = taps(requestLog);
  expect(sent.map((b) => [b.event, b.job_id])).toEqual([['clock_on', 'e2e-job-kinross']]);
  expect(sent[0].switch).toBeUndefined();
});
