// Server clock recovery at login (trade.html `// <trade-clock-recovery>`).
// Regression for the 2026-09-23 trade-app audit, findings 1 and 2: every
// manager's app adopted another trade's 13-day-old open clock at login ("Still
// working? You've been clocked on for 322 hours"), Cancel opened an end-of-day
// report for that trade's job, and the refused clock-off was queued as offline
// forever behind "Saved locally". Rows are shaped from the real read-only rows
// in the audit; no request leaves the machine and no real user signs in.
const { test, expect } = require('@playwright/test');
const { installSupabaseAuthStub, signIn } = require('../helpers/auth');
const { installFeedStubs, installExternalRequestGuard, perthDate, addIsoDays } = require('../helpers/feed-stub');

const SUPABASE_ORIGIN = 'https://kevgrhcjxspbxgovpmfl.supabase.co';
const APP_ORIGIN = new URL(process.env.E2E_BASE_URL || 'http://127.0.0.1:4173').origin;
const OPS_API = `${SUPABASE_ORIGIN}/functions/v1/ops-api`;
const ORG = '00000000-0000-0000-0000-000000000001';

const P = {
  hugo: { email: 'hugo@example.test', password: 'x', profile: { id: 'e2e-hugo', email: 'hugo@example.test', name: 'Hugo', role: 'ops_manager', trade_tier: 2, managed_verticals: [], makesafe_manager: true, invoice_type: 'hourly', org_id: ORG } },
  alyx: { email: 'alyx@example.test', password: 'x', profile: { id: 'e2e-alyx', email: 'alyx@example.test', name: 'Alyx', role: 'crew', trade_tier: 1, managed_verticals: [], invoice_type: 'hourly', org_id: ORG } }
};

const EMPTY = { today: [], thisWeek: [], upcoming: [], recent: [], recentCompleted: [], unscheduled: [], makesafePool: [] };

// Alyx's real row: SWF-261138 Dianella fencing, job invoiced, assignment
// in_progress, clocked on 2026-09-09T23:09Z and never clocked off.
const ALYX_OPEN_CLOCK = {
  id: 'e2e-asg-swf-261138', scheduled_date: '2026-09-10', scheduled_end: null, start_time: null,
  status: 'in_progress', role: 'installer', notes: null, assignment_type: null, crew_name: 'Alyx',
  started_at: '2026-09-09T23:09:06.716Z', completed_at: null,
  clocked_on_at: '2026-09-09T23:09:06.716Z', clocked_off_at: null, travel_started_at: null,
  arrived_at: '2026-09-09T23:09:06.716Z', break_minutes: 0, job_phase: 'working',
  user: { id: P.alyx.profile.id, name: 'Alyx' },
  jobs: { id: 'e2e-job-swf-261138', type: 'fencing', status: 'invoiced', archived: false, client_name: 'Fence Client', client_phone: null, client_email: null, site_address: 'Dianella WA', site_suburb: 'Dianella', notes: null, job_number: 'SWF-261138', metadata: {} }
};

async function boot(page, persona, actions, { allowedWriteActions = [], initScript, initArg } = {}) {
  await installExternalRequestGuard(page, { allowedOrigins: [APP_ORIGIN] });
  await installSupabaseAuthStub(page, {
    users: Object.fromEntries(Object.values(P).map((entry) => [entry.email, entry])),
    profileEndpoint: `${SUPABASE_ORIGIN}/functions/v1/ghl-proxy`
  });
  const requestLog = [];
  const stub = await installFeedStubs(page, { endpoint: OPS_API, actions, allowedWriteActions, requestLog });
  if (initScript) await page.addInitScript(initScript, initArg);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/trade.html');
  await signIn(page, P[persona]);
  return { requestLog, stub };
}

function storedClocks(page) {
  return page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('sw_clock_')));
}

test('a manager never adopts another trade\'s open clock from the Everyone feed', async ({ page }) => {
  const { requestLog } = await boot(page, 'hugo', {
    my_jobs: () => ({ ...EMPTY, recent: [ALYX_OPEN_CLOCK] }),
    search_all_jobs: { lens: 'company', jobs: [], total: 0 },
    makesafe_board: { schema: 'makesafe-board.v1.2', cards: [], columns: [], permissions: { sees_all_makesafes: true, can_allocate: true } }
  });
  await expect.poll(() => requestLog.some((r) => r.action === 'my_jobs' && new URL(r.url).searchParams.get('mode') === 'all')).toBe(true);
  await page.waitForTimeout(1500);
  await expect(page.getByText('Still working?')).toHaveCount(0);
  await expect(page.locator('#confirmOverlay')).not.toHaveClass(/active/);
  expect(await storedClocks(page)).toEqual([]);
  await expect(page.locator('#eodOverlay')).toBeHidden();
  expect(requestLog.filter((r) => r.method !== 'GET').map((r) => r.action)).toEqual([]);
});

test('a trade\'s own old clock on a closed job is not adopted; they are told to ask the office', async ({ page }) => {
  await boot(page, 'alyx', {
    my_jobs: () => ({ ...EMPTY, recent: [ALYX_OPEN_CLOCK] }),
    search_all_jobs: { lens: 'assigned', jobs: [], total: 0 }
  });
  const overlay = page.locator('#confirmOverlay');
  await expect(overlay).toHaveClass(/active/, { timeout: 10000 });
  await expect(page.locator('#confirmMsg')).toContainText('You have an open clock on SWF-261138 from');
  await expect(page.locator('#confirmMsg')).toContainText('ask the office to close it');
  await expect(page.locator('#confirmCancel')).toBeHidden();
  await expect(page.getByText('Still working?')).toHaveCount(0);
  expect(await storedClocks(page)).toEqual([]);
  await page.locator('#confirmOk').click();
  await expect(overlay).not.toHaveClass(/active/);
  expect(await page.locator('#confirmCancel').evaluate((el) => el.style.display)).toBe('');
});

test('own fresh 14h+ clock: "No" loads that job and opens its end-of-day report; a refused clock-off is not "saved locally"', async ({ page }) => {
  const yesterday = addIsoDays(perthDate(), -1);
  const clockedOn = `${yesterday}T06:30:00+08:00`;
  const ownRow = {
    ...ALYX_OPEN_CLOCK,
    id: 'e2e-asg-own-fresh',
    scheduled_date: yesterday,
    clocked_on_at: clockedOn, started_at: clockedOn, arrived_at: clockedOn,
    user: undefined, // the personal feed carries no user
    jobs: { ...ALYX_OPEN_CLOCK.jobs, id: 'e2e-job-own-fresh', status: 'scheduled', job_number: 'SWF-270001' }
  };
  const { requestLog } = await boot(page, 'alyx', {
    my_jobs: () => ({ ...EMPTY, recent: [ownRow] }),
    search_all_jobs: { lens: 'assigned', jobs: [], total: 0 },
    trade_job_detail: {
      job: ownRow.jobs,
      crew: [{ id: ownRow.id, user_id: P.alyx.profile.id, users: { id: P.alyx.profile.id, name: 'Alyx' }, status: 'in_progress', scheduled_date: yesterday, clocked_on_at: clockedOn, clocked_off_at: null, arrived_at: clockedOn, started_at: clockedOn, job_phase: 'working' }],
      purchaseOrders: [], media: [], notes: []
    },
    clock_event: { status: 500, body: { error: 'Not your assignment' } }
  }, { allowedWriteActions: ['clock_event'] });

  await expect(page.getByText('Still working?')).toBeVisible({ timeout: 10000 });
  await page.locator('#confirmCancel').click();
  await expect.poll(() => requestLog.some((r) => r.action === 'trade_job_detail' && new URL(r.url).searchParams.get('jobId') === 'e2e-job-own-fresh')).toBe(true);
  await expect(page.locator('#eodOverlay')).toBeVisible();

  await page.evaluate((id) => window.timerAction('clock_off', id), ownRow.id);
  await expect.poll(() => requestLog.filter((r) => r.action === 'clock_event').length).toBe(1);
  await expect(page.locator('#toast')).toContainText('Not saved');
  await expect(page.locator('#toast')).not.toContainText('Saved locally');
  const leftovers = await page.evaluate(() => ({
    pending: Object.keys(localStorage).filter((k) => k.startsWith('sw_pending_clock_')),
    queue: JSON.parse(localStorage.getItem('sw_action_queue') || '[]').filter((i) => i && i.action === 'clock_event')
  }));
  expect(leftovers).toEqual({ pending: [], queue: [] });
});

test('an already-queued clock event the server refuses is dropped, not retried forever', async ({ page }) => {
  test.setTimeout(40000);
  const body = { assignment_id: ALYX_OPEN_CLOCK.id, event: 'clock_off', timestamp: '2026-09-22T09:00:00.000Z', idempotency_key: 'e2e-ik-1', break_minutes: 0 };
  const { requestLog } = await boot(page, 'hugo', {
    my_jobs: () => EMPTY,
    search_all_jobs: { lens: 'company', jobs: [], total: 0 },
    makesafe_board: { schema: 'makesafe-board.v1.2', cards: [], columns: [], permissions: { sees_all_makesafes: true, can_allocate: true } },
    clock_event: { status: 500, body: { error: 'Not your assignment' } }
  }, {
    allowedWriteActions: ['clock_event'],
    initArg: body,
    initScript: (seed) => {
      if (sessionStorage.getItem('e2e-seeded')) return;
      sessionStorage.setItem('e2e-seeded', '1');
      localStorage.setItem('sw_action_queue', JSON.stringify([{ id: 'e2e-q-1', client_request_id: 'e2e-q-1', action: 'clock_event', body: seed, ts: '2026-09-22T09:00:00.000Z' }]));
      localStorage.setItem('sw_pending_clock_' + seed.assignment_id, JSON.stringify(seed));
    }
  });
  // Seed survives the boot; the queue replays about 5 seconds after sign-in.
  await expect.poll(() => requestLog.filter((r) => r.action === 'clock_event').length, { timeout: 12000 }).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => ({
    queue: JSON.parse(localStorage.getItem('sw_action_queue') || '[]').filter((i) => i && i.action === 'clock_event').length,
    pending: Object.keys(localStorage).filter((k) => k.startsWith('sw_pending_clock_')).length
  })), { timeout: 5000 }).toEqual({ queue: 0, pending: 0 });
});
