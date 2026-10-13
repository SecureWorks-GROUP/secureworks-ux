// Sign in and sign out on a job: one tap each (Captain, 2026-10-13).
//
// "when they get to a job they just click like I've arrived on site and then
// when they leave they just click like leave ... it shouldn't be complicated
// or clunky." The pure rules are pinned in scripts/test-trade-site-visit.js;
// this spec proves a trade on a phone meets them on the real screens: the
// Today card, the job screen and the signed-in bar. Every case runs against
// both an ops-api that keeps a visit record and one that does not yet, because
// the app ships whichever side goes live first. No request leaves the machine.
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

async function boot(page, persona, actions, { allowedWriteActions = ['clock_event'], openJobs = true } = {}) {
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
  await page.goto('/trade.html');
  await signIn(page, P[persona]);
  // The "you did not sign out" question opens over the app at sign-in; those
  // cases answer it before they go anywhere.
  if (openJobs) await page.locator('[data-view="myJobs"]').click();
  return { requestLog };
}

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
  await page.locator('[data-view="hours"]').click();
  await expect(bar).toBeVisible();
  await page.locator('[data-view="myJobs"]').click();
  await expect(north.locator('[data-card-signin]')).toHaveCount(0);
  await expect(north.locator('[data-card-signout]')).toHaveText('Sign out');

  await north.locator('[data-card-signout]').click();
  await expect.poll(() => taps(requestLog).length).toBe(2);
  expect(taps(requestLog)[1]).toEqual(expect.objectContaining({ event: 'clock_off', assignment_id: 'e2e-asg-north', job_id: 'e2e-job-north' }));
  await expect(page.locator('#toast')).toContainText(/Signed out \d{1,2}:\d{2} (am|pm)/);

  // Afterwards, and only as an offer: had a break? Skipping it means none.
  await expect(bar.locator('[data-site-break]')).toContainText('Had a break?');
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

test('an ops-api with no visit record yet: the same two taps work, with no break offer and no error', async ({ page }) => {
  let rows = [NORTHFIELD()];
  const { requestLog } = await boot(page, 'alyx', {
    my_jobs: () => ({ ...EMPTY, today: rows }),
    clock_event: olderApi()
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const north = card(page, 'SWF-270010');
  await north.locator('[data-card-signin]').click();
  await expect(page.locator('#toast')).toContainText('Signed in');
  await expect(page.locator('#siteVisitBar')).toContainText('Signed in');
  await north.locator('[data-card-signout]').click();
  await expect(page.locator('#toast')).toContainText('Signed out');
  await expect(page.locator('#siteVisitBar')).toBeHidden();
  await expect(page.locator('[data-site-break]')).toHaveCount(0);
  expect(taps(requestLog).map((b) => b.event)).toEqual(['clock_on', 'clock_off']);
  expect(requestLog.filter((r) => ['set_site_visit_break', 'close_site_visit_late'].includes(r.action))).toEqual([]);
  expect(errors).toEqual([]);
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
    // An older my_jobs: no open_site_visit, so the phone cannot know.
    my_jobs: () => ({ ...EMPTY, today: [KINROSS()] }),
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
  await overlay.locator('#siteLateTime').fill('06:00');
  await overlay.locator('#siteLateSave').click();
  await expect(overlay.locator('#siteLateErr')).toContainText('must be after you signed in at 7:02 am');
  expect(requestLog.filter((r) => r.action === 'close_site_visit_late')).toEqual([]);

  await overlay.locator('#siteLateTime').fill('15:30');
  await overlay.locator('#siteLateSave').click();
  await expect.poll(() => requestLog.filter((r) => r.action === 'close_site_visit_late').map((r) => r.body)).toEqual([{ visit_id: 'e2e-visit-late', finish_time: '15:30' }]);
  await expect(overlay).toHaveCount(0);
  await expect(page.locator('#toast')).toContainText('Marked as typed');
  await expect(page.locator('#siteVisitBar')).toBeHidden();
});

test('forgot to sign out, answered "Not now": the bar keeps the question and a new sign in is not blocked', async ({ page }) => {
  const yesterday = addIsoDays(TODAY, -1);
  const state = { open: null, n: 0 };
  const late = { visit_id: 'e2e-visit-late', job_id: 'e2e-job-north', job_number: 'SWF-270010', site_suburb: 'Northfield', signed_in_at: `${yesterday}T07:02:00+08:00`, status: 'no_sign_out' };
  const { requestLog } = await boot(page, 'alyx', {
    my_jobs: () => ({ ...EMPTY, today: [KINROSS()], open_site_visit: late }),
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
  await expect(page.locator('#toast')).toContainText('Signed in');
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
  await expect(page.locator('#jobDetailContent')).not.toContainText(/clock|timer|shift/i);
});
