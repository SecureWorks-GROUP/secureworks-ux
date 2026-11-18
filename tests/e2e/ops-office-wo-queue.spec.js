// Financials > Work Orders: the office fill queue. Flag off or an unknown
// action paints nothing. A trade role paints nothing. There is no Send.
const { test, expect } = require('@playwright/test');
const { revealOpsStaticFixture } = require('../helpers/ops-auth');

const ROW = {
  id: 'wo-fill-1',
  job_id: 'job-1',
  wo_number: 'WO-100',
  status: 'draft',
  agreed_labour_ex: 1200,
  needs_allowance: false,
  updated_at: '2026-10-21T01:02:03.000Z',
  job_number: 'SWF-100',
  job_type: 'fencing',
  client_name: 'Fixture Client',
  site_suburb: 'Dianella',
};

async function boot(page, fetchImpl) {
  await page.route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname;
    return host === '127.0.0.1' || host === 'localhost' ? route.continue() : route.abort();
  });
  await page.goto('/ops.html');
  // The auth gate hides every body child with display:none !important until
  // sign-in. These specs drive the page functions directly.
  await revealOpsStaticFixture(page);
  // The module loads after the page; wait for it rather than race it.
  await page.waitForFunction(() => Boolean(window.OfficeWoFill));
  await page.evaluate((src) => {
    window.__posts = [];
    window.opsFetch = new Function('action', src);
    window.opsPost = async function (action, body) {
      window.__posts.push({ action, body });
      return { work_order_id: body.work_order_id, agreed_labour_ex: body.agreed_labour_ex, updated_at: '2026-10-21T02:00:00.000Z' };
    };
  }, fetchImpl);
}

// The host lives in Financials > Work Orders, which is display:none until that
// sub-tab is the one on screen. Text assertions work while it is hidden; a
// fill or a click does not.
async function showWorkOrders(page) {
  await page.evaluate(() => {
    var view = document.getElementById('viewFinancials');
    var sub = document.getElementById('subWorkorders');
    if (view) view.classList.add('active');
    if (sub) sub.classList.add('active');
  });
}

test('a flag that is off, or an unknown action, paints nothing', async ({ page }) => {
  await boot(page, `if (action === 'list_office_job_work_orders') return { enabled: false, work_orders: [{ id: 'x', agreed_labour_ex: 99 }] }; return {};`);
  await page.evaluate(() => OfficeWoFill.paint());
  await expect(page.locator('[data-office-wo-fill-queue]')).toHaveCount(0);
  await expect(page.locator('#officeWoFill')).toBeEmpty();
  await expect(page.locator('#officeWoFill')).not.toContainText('$99');
  await expect(page.locator('#officeWoFill')).not.toContainText('Send');

  await page.evaluate(() => {
    window.opsFetch = async function () {
      const e = new Error('Unknown action');
      e.code = 'unknown_action';
      e.status = 400;
      throw e;
    };
    return OfficeWoFill.paint();
  });
  await expect(page.locator('[data-office-wo-fill-queue]')).toHaveCount(0);
  await expect(page.locator('#officeWoFill')).toBeEmpty();
});

test('a trade role paints nothing, even when the queue has an allowance', async ({ page }) => {
  await boot(page, `if (action === 'list_office_job_work_orders') return { enabled: true, work_orders: [{ id: 'wo-1', agreed_labour_ex: 500, needs_allowance: false, wo_number: 'WO-1' }] }; return {};`);
  await page.evaluate(() => {
    window.SECUREWORKS_CLOUD = { auth: { getRole: function () { return 'installer'; } } };
    return OfficeWoFill.paint();
  });
  await expect(page.locator('[data-office-wo-fill-queue]')).toHaveCount(0);
  await expect(page.locator('#officeWoFill')).not.toContainText('$500');
  await expect(page.locator('#officeWoFill')).not.toContainText('Agreed labour');
});

test('an open queue shows the allowance, saves it, and approves, with no Send', async ({ page }) => {
  await boot(page, `if (action === 'list_office_job_work_orders') return { enabled: true, work_orders: ${JSON.stringify([ROW])} }; return {};`);
  await page.evaluate(() => OfficeWoFill.paint());
  await showWorkOrders(page);
  const queue = page.locator('[data-office-wo-fill-queue]');
  await expect(queue).toContainText('Work orders to fill');
  await expect(queue).toContainText('WO-100');
  await expect(queue).toContainText('$1,200.00');
  await expect(queue).toContainText('Fixture Client');
  await expect(queue.locator('button')).toHaveText(['Save allowance', 'Approve']);
  await expect(queue.getByRole('button', { name: 'Send' })).toHaveCount(0);
  await expect(queue).not.toContainText('Send');

  await queue.locator('[data-office-wo-allowance]').fill('0');
  await queue.locator('[data-office-wo-fill-save]').click();
  await expect.poll(() => page.evaluate(() => window.__posts.length)).toBe(1);
  const fill = await page.evaluate(() => window.__posts[0]);
  expect(fill.action).toBe('fill_job_work_order_allowance');
  expect(fill.body).toEqual({
    work_order_id: 'wo-fill-1',
    expected_updated_at: '2026-10-21T01:02:03.000Z',
    agreed_labour_ex: 0,
  });

  await queue.locator('[data-office-wo-fill-approve]').click();
  await expect.poll(() => page.evaluate(() => window.__posts.length)).toBe(2);
  const approve = await page.evaluate(() => window.__posts[1]);
  expect(approve.action).toBe('approve_office_job_work_order');
  expect(approve.body.work_order_id).toBe('wo-fill-1');
  expect(approve.body.expected_updated_at).toBe('2026-10-21T01:02:03.000Z');
  expect(approve.body.agreed_labour_ex).toBeUndefined();
});

test('a 403 before the switch is on paints nothing', async ({ page }) => {
  await boot(page, `const e = new Error('An authorised operator session is required.'); e.status = 403; e.code = 'access_denied'; e.body = { code: 'operator_access_required', error: e.message }; throw e;`);
  await page.evaluate(() => OfficeWoFill.paint());
  await expect(page.locator('#officeWoFill')).toBeEmpty();
  await expect(page.locator('[data-office-wo-fill-error]')).toHaveCount(0);
  await expect(page.locator('#officeWoFill')).not.toContainText('could not be read');
  await expect(page.locator('#officeWoFill')).not.toContainText('An authorised operator session is required.');
});

test('a 500 before the switch is on paints nothing, and after it is on the queue clears', async ({ page }) => {
  await boot(page, 'return {};');
  await page.evaluate((row) => {
    window.__mode = '500';
    window.opsFetch = async function () {
      if (window.__mode === '500') {
        const e = new Error('Internal Server Error');
        e.status = 500;
        throw e;
      }
      if (window.__mode === 'timeout') {
        const e = new Error('The request timed out');
        e.status = 0;
        throw e;
      }
      return { enabled: true, work_orders: [row] };
    };
    return OfficeWoFill.paint();
  }, ROW);
  await expect(page.locator('#officeWoFill')).toBeEmpty();
  await expect(page.locator('[data-office-wo-fill-error]')).toHaveCount(0);
  await expect(page.locator('#officeWoFill')).not.toContainText('could not be read');

  await page.evaluate(() => {
    window.__mode = 'timeout';
    return OfficeWoFill.paint();
  });
  await expect(page.locator('#officeWoFill')).toBeEmpty();
  await expect(page.locator('[data-office-wo-fill-error]')).toHaveCount(0);

  await page.evaluate(() => {
    window.__mode = 'on';
    return OfficeWoFill.paint();
  });
  await expect(page.locator('[data-office-wo-fill-queue]')).toContainText('WO-100');

  await page.evaluate(() => {
    window.__mode = '500';
    return OfficeWoFill.paint();
  });
  await expect(page.locator('[data-office-wo-fill-queue]')).toHaveCount(0);
  await expect(page.locator('[data-office-wo-fill]')).toHaveCount(0);
  await expect(page.locator('[data-office-wo-fill-error]')).toHaveText('Work orders to fill could not be read.');
  await expect(page.locator('#officeWoFill')).not.toContainText('WO-100');
});

test('a draft with no allowance has no Approve until one is saved', async ({ page }) => {
  const blank = Object.assign({}, ROW, { agreed_labour_ex: null, needs_allowance: true });
  await boot(page, `if (action === 'list_office_job_work_orders') return { enabled: true, work_orders: ${JSON.stringify([blank])} }; return {};`);
  await page.evaluate(() => OfficeWoFill.paint());
  await showWorkOrders(page);
  const queue = page.locator('[data-office-wo-fill-queue]');
  await expect(queue).toContainText('Needs a labour allowance');
  await expect(queue.locator('[data-office-wo-fill-approve]')).toHaveCount(0);
  await queue.locator('[data-office-wo-fill-save]').click();
  await expect(queue.locator('[data-office-wo-fill-msg]')).toHaveText('Set the labour allowance. Use 0 when there is none.');
  expect(await page.evaluate(() => window.__posts.length)).toBe(0);
});

async function bootGaps(page) {
  await page.route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname;
    return host === '127.0.0.1' || host === 'localhost' ? route.continue() : route.abort();
  });
  await page.goto('/ops.html');
  await revealOpsStaticFixture(page);
  await showWorkOrders(page);
  await page.evaluate(() => {
    window.__reads = [];
    window.__posts = [];
    window.__openedJobs = [];
    window.SECUREWORKS_CLOUD = { auth: { getRole: function () { return 'ops_manager'; } } };
    if (window.JobWorkOrderOps) {
      window.JobWorkOrderOps.openForJob = function (jobId) { window.__openedJobs.push(jobId); };
    }
  });
}

test('P1-05.3 renders two gaps above the queue with counts, buttons, and waiting note only when held_lines > 0', async ({ page }) => {
  await bootGaps(page);
  const threeDaysAgo = new Date(Date.now() - (3 * 86400000 + 3600000)).toISOString();
  const gapsPayload = {
    counts: { no_work_order: 1, no_amount: 1, jobs_with_held_lines: 1 },
    jobs: [
      {
        job_id: 'ZZTEST-job-201',
        job_number: 'ZZTEST-201',
        type: 'fencing',
        status: 'scheduled',
        reason: 'no_work_order',
        work_order_id: null,
        held_lines: 2,
        held_amount_ex: 748,
        held_trades: 2,
        oldest_held_at: threeDaysAgo,
      },
      {
        job_id: 'ZZTEST-job-202',
        job_number: 'ZZTEST-202',
        type: 'repair',
        status: 'accepted',
        reason: 'no_amount',
        work_order_id: 'ZZTEST-wo-202',
        held_lines: 0,
        held_amount_ex: 0,
        held_trades: 0,
        oldest_held_at: null,
      },
    ],
  };
  const fillRow = {
    id: 'ZZTEST-wo-202',
    job_id: 'ZZTEST-job-202',
    wo_number: 'WO-202',
    status: 'draft',
    agreed_labour_ex: null,
    needs_allowance: true,
    updated_at: '2026-11-18T01:00:00.000Z',
    job_number: 'ZZTEST-202',
    job_type: 'repair',
    client_name: 'ZZTEST',
    site_suburb: null,
  };

  await page.evaluate(({ gaps, draft }) => {
    window.opsFetch = async function (action) {
      window.__reads.push(action);
      if (action === 'job_work_order_gaps') return gaps;
      if (action === 'list_office_job_work_orders') return { enabled: true, work_orders: [draft] };
      if (action === 'list_work_orders') return { work_orders: [], cap_read: 'ok' };
      if (action === 'work_order_changes') return { changes: [] };
      return {};
    };
    return loadWOs();
  }, { gaps: gapsPayload, draft: fillRow });

  const section = page.locator('[data-office-wo-gaps]');
  await expect(section).toContainText('Needs a work order');
  await expect(section).toContainText('Jobs with no work order: 1');
  await expect(section).toContainText('Work orders with no amount: 1');
  await expect(section).toContainText('Jobs with pay waiting: 1');

  const isAbove = await page.evaluate(() => {
    const gapsEl = document.getElementById('officeWoGaps');
    const fillEl = document.getElementById('officeWoFill');
    return Boolean(gapsEl && fillEl && (gapsEl.compareDocumentPosition(fillEl) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  expect(isAbove).toBe(true);

  const row1 = section.locator('[data-office-wo-gap="ZZTEST-job-201"]');
  await expect(row1).toContainText('ZZTEST-201');
  await expect(row1).toContainText('fencing');
  await expect(row1).toContainText('No work order');
  await expect(row1.getByRole('button', { name: 'Open a work order' })).toBeVisible();
  await expect(row1.locator('[data-office-wo-gap-waiting]')).toHaveText(
    '2 pay lines from 2 trades are waiting on this job ($748.00), oldest 3 days'
  );

  const row2 = section.locator('[data-office-wo-gap="ZZTEST-job-202"]');
  await expect(row2).toContainText('ZZTEST-202');
  await expect(row2).toContainText('repair');
  await expect(row2).toContainText('No amount yet');
  await expect(row2.getByRole('button', { name: 'Fill the amount' })).toBeVisible();
  await expect(row2.locator('[data-office-wo-gap-waiting]')).toHaveCount(0);

  await row2.getByRole('button', { name: 'Fill the amount' }).click();
  await expect(page.locator('[data-office-wo-fill="ZZTEST-wo-202"] [data-office-wo-allowance]')).toBeFocused();
});

test('P1-05.3 loading, empty, error without zero, Retry recovery, and trade exclusion', async ({ page }) => {
  await bootGaps(page);
  await page.evaluate(() => {
    window.__gapMode = 'hold';
    window.opsFetch = function (action) {
      window.__reads.push(action);
      if (action === 'list_office_job_work_orders') return Promise.resolve({ enabled: false, work_orders: [] });
      if (action === 'job_work_order_gaps') {
        if (window.__gapMode === 'hold') {
          return new Promise((resolve) => { window.__resolveHold = resolve; });
        }
        if (window.__gapMode === 'error') {
          const err = new Error('The list of jobs needing a work order could not be read');
          err.status = 503;
          err.code = 'gaps_unreadable';
          return Promise.reject(err);
        }
        if (window.__gapMode === 'malformed') {
          return Promise.resolve({ counts: { no_work_order: null, no_amount: 0, jobs_with_held_lines: 0 }, jobs: [] });
        }
        return Promise.resolve({
          counts: { no_work_order: 0, no_amount: 0, jobs_with_held_lines: 0 },
          jobs: [],
        });
      }
      return Promise.resolve({});
    };
    window.__paintPromise = OfficeWoFill.paint();
  });

  const host = page.locator('#officeWoGaps');
  await expect(host).toContainText('Checking for jobs with no work order...');
  await expect(host).not.toContainText('0');

  await page.evaluate(() => {
    window.__resolveHold({
      counts: { no_work_order: 0, no_amount: 0, jobs_with_held_lines: 0 },
      jobs: [],
    });
    return window.__paintPromise;
  });
  await expect(host).toContainText('Jobs with no work order: 0');
  await expect(host).toContainText('Work orders with no amount: 0');
  await expect(host).toContainText('Jobs with pay waiting: 0');
  await expect(host).toContainText('Every live job has a work order with an amount.');

  await page.evaluate(() => {
    window.__gapMode = 'error';
    return OfficeWoFill.paint();
  });
  await expect(host.locator('[data-office-wo-gaps-error]')).toContainText(
    'The list could not be read, so it is not shown. Try again.'
  );
  await expect(host.locator('[data-office-wo-gaps-counts]')).toHaveCount(0);
  await expect(host).not.toContainText('0');

  await page.evaluate(() => {
    window.__gapMode = 'malformed';
    return OfficeWoFill.paint();
  });
  await expect(host.locator('[data-office-wo-gaps-error]')).toContainText(
    'The list could not be read, so it is not shown. Try again.'
  );
  await expect(host.locator('[data-office-wo-gaps-counts]')).toHaveCount(0);
  await expect(host).not.toContainText('0');

  await page.evaluate(() => { window.__gapMode = 'empty'; });
  await host.getByRole('button', { name: 'Retry' }).click();
  await expect(host).toContainText('Every live job has a work order with an amount.');

  await page.evaluate(() => {
    window.opsFetch = async function (action) {
      if (action === 'list_office_job_work_orders') return { enabled: false, work_orders: [] };
      if (action === 'job_work_order_gaps') {
        return {
          counts: { no_work_order: 0, no_amount: 1, jobs_with_held_lines: 0 },
          jobs: [{
            job_id: 'ZZTEST-job-off',
            job_number: 'ZZTEST-299',
            type: 'repair',
            status: 'accepted',
            reason: 'no_amount',
            work_order_id: 'ZZTEST-wo-299',
            held_lines: 0,
            held_amount_ex: 0,
            held_trades: 0,
            oldest_held_at: null,
          }],
        };
      }
      return {};
    };
    return OfficeWoFill.paint();
  });
  await host.getByRole('button', { name: 'Fill the amount' }).click();
  expect(await page.evaluate(() => window.__openedJobs)).toEqual(['ZZTEST-job-off']);

  await page.evaluate(() => {
    window.__reads = [];
    window.SECUREWORKS_CLOUD = { auth: { getRole: function () { return 'installer'; } } };
    return OfficeWoFill.paint();
  });
  await expect(host).toBeEmpty();
  expect(await page.evaluate(() => window.__reads)).toEqual([]);
});

test('P1-05.3 Open a work order retries after refusal, reloads, and saving plus approving shows Work order approved', async ({ page }) => {
  await bootGaps(page);
  const twoDaysAgo = new Date(Date.now() - (2 * 86400000 + 3600000)).toISOString();

  await page.evaluate((oldestAt) => {
    window.__stage = 'no_wo';
    window.__failCreateOnce = true;
    window.opsFetch = async function (action) {
      window.__reads.push(action);
      if (action === 'job_work_order_gaps') {
        if (window.__stage === 'no_wo') {
          return {
            counts: { no_work_order: 1, no_amount: 0, jobs_with_held_lines: 1 },
            jobs: [{
              job_id: 'ZZTEST-job-301',
              job_number: 'ZZTEST-301',
              type: 'patio',
              status: 'scheduled',
              reason: 'no_work_order',
              work_order_id: null,
              held_lines: 3,
              held_amount_ex: 960,
              held_trades: 2,
              oldest_held_at: oldestAt,
            }],
          };
        }
        if (window.__stage === 'draft' || window.__stage === 'filled') {
          return {
            counts: { no_work_order: 0, no_amount: 1, jobs_with_held_lines: 1 },
            jobs: [{
              job_id: 'ZZTEST-job-301',
              job_number: 'ZZTEST-301',
              type: 'patio',
              status: 'scheduled',
              reason: 'no_amount',
              work_order_id: 'ZZTEST-wo-301',
              held_lines: 3,
              held_amount_ex: 960,
              held_trades: 2,
              oldest_held_at: oldestAt,
            }],
          };
        }
        return {
          counts: { no_work_order: 0, no_amount: 0, jobs_with_held_lines: 0 },
          jobs: [],
        };
      }
      if (action === 'list_office_job_work_orders') {
        if (window.__stage === 'draft') {
          return {
            enabled: true,
            work_orders: [{
              id: 'ZZTEST-wo-301',
              job_id: 'ZZTEST-job-301',
              wo_number: 'WO-301',
              status: 'draft',
              agreed_labour_ex: null,
              needs_allowance: true,
              updated_at: '2026-11-18T02:00:00.000Z',
              job_number: 'ZZTEST-301',
              job_type: 'patio',
              client_name: 'ZZTEST',
              site_suburb: null,
            }],
          };
        }
        if (window.__stage === 'filled') {
          return {
            enabled: true,
            work_orders: [{
              id: 'ZZTEST-wo-301',
              job_id: 'ZZTEST-job-301',
              wo_number: 'WO-301',
              status: 'draft',
              agreed_labour_ex: 1200,
              needs_allowance: false,
              updated_at: '2026-11-18T02:05:00.000Z',
              job_number: 'ZZTEST-301',
              job_type: 'patio',
              client_name: 'ZZTEST',
              site_suburb: null,
            }],
          };
        }
        return { enabled: true, work_orders: [] };
      }
      return {};
    };
    window.opsPost = async function (action, body) {
      window.__posts.push({ action, body });
      if (action === 'create_work_order') {
        if (window.__failCreateOnce) {
          window.__failCreateOnce = false;
          throw new Error('Could not create draft right now.');
        }
        window.__stage = 'draft';
        return { created: true, work_order: { id: 'ZZTEST-wo-301' } };
      }
      if (action === 'fill_job_work_order_allowance') {
        window.__stage = 'filled';
        return { work_order_id: body.work_order_id, agreed_labour_ex: body.agreed_labour_ex, updated_at: '2026-11-18T02:05:00.000Z' };
      }
      if (action === 'approve_office_job_work_order') {
        window.__stage = 'approved';
        return { work_order_id: body.work_order_id, status: 'approved' };
      }
      return {};
    };
    return OfficeWoFill.paint();
  }, twoDaysAgo);

  const section = page.locator('[data-office-wo-gaps]');
  const gapRow = section.locator('[data-office-wo-gap="ZZTEST-job-301"]');
  await gapRow.getByRole('button', { name: 'Open a work order' }).click();
  await expect(gapRow.locator('[data-office-wo-gap-msg]')).toHaveText('Could not create draft right now.');

  await gapRow.getByRole('button', { name: 'Open a work order' }).click();
  await expect(section.locator('[data-office-wo-gap="ZZTEST-job-301"]')).toContainText('No amount yet');
  const postsAfterCreate = await page.evaluate(() => window.__posts.slice(0, 2));
  expect(postsAfterCreate).toEqual([
    { action: 'create_work_order', body: { kind: 'job', job_id: 'ZZTEST-job-301' } },
    { action: 'create_work_order', body: { kind: 'job', job_id: 'ZZTEST-job-301' } },
  ]);

  await section.locator('[data-office-wo-gap="ZZTEST-job-301"]').getByRole('button', { name: 'Fill the amount' }).click();
  const fillRow = page.locator('[data-office-wo-fill="ZZTEST-wo-301"]');
  await expect(fillRow.locator('[data-office-wo-allowance]')).toBeFocused();
  await fillRow.locator('[data-office-wo-allowance]').fill('1200');
  await fillRow.locator('[data-office-wo-fill-save]').click();
  await expect(section.locator('[data-office-wo-gaps-released]')).toHaveCount(0);

  await page.locator('[data-office-wo-fill="ZZTEST-wo-301"] [data-office-wo-fill-approve]').click();
  await expect(section.locator('[data-office-wo-gaps-released]')).toHaveText(
    'Work order approved'
  );
  await expect(section).toContainText('Every live job has a work order with an amount.');
});

for (const width of [1280, 820]) {
  test(`P1-05.3 fits cleanly at ${width}px without horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    await bootGaps(page);
    const fourDaysAgo = new Date(Date.now() - (4 * 86400000 + 3600000)).toISOString();
    await page.evaluate((oldestAt) => {
      window.opsFetch = async function (action) {
        if (action === 'job_work_order_gaps') {
          return {
            counts: { no_work_order: 1, no_amount: 1, jobs_with_held_lines: 1 },
            jobs: [
              {
                job_id: 'ZZTEST-job-401',
                job_number: 'ZZTEST-401',
                type: 'fencing',
                status: 'scheduled',
                reason: 'no_work_order',
                work_order_id: null,
                held_lines: 2,
                held_amount_ex: 640,
                held_trades: 2,
                oldest_held_at: oldestAt,
              },
              {
                job_id: 'ZZTEST-job-402',
                job_number: 'ZZTEST-402',
                type: 'repair',
                status: 'accepted',
                reason: 'no_amount',
                work_order_id: 'ZZTEST-wo-402',
                held_lines: 0,
                held_amount_ex: 0,
                held_trades: 0,
                oldest_held_at: null,
              },
            ],
          };
        }
        if (action === 'list_office_job_work_orders') {
          return {
            enabled: true,
            work_orders: [{
              id: 'ZZTEST-wo-402',
              job_id: 'ZZTEST-job-402',
              wo_number: 'WO-402',
              status: 'draft',
              agreed_labour_ex: null,
              needs_allowance: true,
              updated_at: '2026-11-18T03:00:00.000Z',
              job_number: 'ZZTEST-402',
              job_type: 'repair',
              client_name: 'ZZTEST',
              site_suburb: null,
            }],
          };
        }
        if (action === 'list_work_orders') return { work_orders: [], cap_read: 'ok' };
        if (action === 'work_order_changes') return { changes: [] };
        return {};
      };
      return loadWOs();
    }, fourDaysAgo);

    await expect(page.locator('[data-office-wo-gaps]')).toContainText('ZZTEST-401');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

// FU49 9(a): the sealed quote's labour amount proposed on a draft with no
// amount, and one office press (confirm_job_work_order_labour) that fills the
// draft. A named approver still approves. Switch job_work_order_labour_confirm_v1.
function labourGapRow(n, reason) {
  return {
    job_id: `ZZTEST-job-${n}`,
    job_number: `ZZTEST-${n}`,
    type: 'fencing',
    status: 'accepted',
    reason: reason || 'no_amount',
    work_order_id: reason === 'no_work_order' ? null : `ZZTEST-wo-${n}`,
    held_lines: 0,
    held_amount_ex: 0,
    held_trades: 0,
    oldest_held_at: null,
  };
}

function labourConfirmRow(n, reason, amount) {
  return {
    job_id: `ZZTEST-job-${n}`,
    job_number: `ZZTEST-${n}`,
    job_type: 'fencing',
    job_status: 'accepted',
    work_order_id: `ZZTEST-wo-${n}`,
    wo_number: `WO-${n}`,
    work_order_updated_at: '2026-11-18T01:00:00.000Z',
    reason,
    proposal: reason === 'sealed_amount'
      ? { agreed_labour_ex: amount, job_budget_id: `00000000-0000-4000-8000-000000000${n}`, scope_revision_id: `00000000-0000-4000-9000-000000000${n}` }
      : null,
  };
}

const LABOUR_GAPS = {
  counts: { no_work_order: 1, no_amount: 5, jobs_with_held_lines: 0 },
  jobs: [
    labourGapRow(500, 'no_work_order'),
    labourGapRow(501),
    labourGapRow(502),
    labourGapRow(503),
    labourGapRow(504),
    labourGapRow(505),
  ],
};

const LABOUR_LIST = {
  enabled: true,
  press: 'fill_draft',
  limit: 50,
  offset: 0,
  more: false,
  jobs: [
    labourConfirmRow(501, 'sealed_amount', 2450),
    labourConfirmRow(502, 'no_amount_in_sealed_quote'),
    labourConfirmRow(503, 'no_sealed_quote'),
    labourConfirmRow(504, 'revision_differs'),
    // A sealed_amount row the page cannot read proposes nothing, never $0.00.
    Object.assign(labourConfirmRow(505, 'sealed_amount', 0), { proposal: { agreed_labour_ex: null, job_budget_id: 'x' } }),
  ],
};

async function paintLabour(page, { gaps, labour, roleName }) {
  await page.waitForFunction(() => Boolean(window.OfficeWoFill));
  await page.evaluate(({ gaps, labour, roleName }) => {
    window.__labourReads = [];
    window.SECUREWORKS_CLOUD = { auth: { getRole: function () { return roleName; } } };
    window.opsFetch = async function (action, params) {
      window.__reads.push(action);
      if (action === 'job_work_order_gaps') return gaps;
      if (action === 'list_job_work_order_labour_confirm') {
        window.__labourReads.push(params || null);
        if (typeof window.__labourImpl === 'function') return window.__labourImpl();
        return labour;
      }
      if (action === 'list_office_job_work_orders') return { enabled: false, work_orders: [] };
      return {};
    };
    return OfficeWoFill.paint();
  }, { gaps, labour, roleName: roleName || 'ops_manager' });
}

test('FU49 9a: each draft shows the sealed quote labour, one Fill from sealed quote press, and says a named approver still approves', async ({ page }) => {
  await bootGaps(page);
  await paintLabour(page, { gaps: LABOUR_GAPS, labour: LABOUR_LIST });
  const section = page.locator('[data-office-wo-gaps]');
  expect(await page.evaluate(() => window.__labourReads)).toEqual([{ limit: 50 }]);

  const r501 = section.locator('[data-office-wo-gap="ZZTEST-job-501"]');
  await expect(r501.locator('[data-office-wo-labour-amount]')).toHaveText('$2,450.00');
  await expect(r501).toContainText('Sealed quote labour');
  await expect(r501).toContainText('proposed');
  await expect(r501.getByRole('button', { name: 'Fill from sealed quote' })).toBeVisible();
  await expect(r501).toContainText('Fills the draft only. A named approver still approves it.');
  // The manual path stays beside it.
  await expect(r501.getByRole('button', { name: 'Fill the amount' })).toBeVisible();

  const r502 = section.locator('[data-office-wo-gap="ZZTEST-job-502"]');
  await expect(r502).toContainText('No amount in the sealed quote');
  await expect(r502.locator('[data-office-wo-labour-confirm]')).toHaveCount(0);
  await expect(r502).not.toContainText('$');

  const r503 = section.locator('[data-office-wo-gap="ZZTEST-job-503"]');
  await expect(r503).toContainText('No sealed quote for this job');
  await expect(r503.locator('[data-office-wo-labour-confirm]')).toHaveCount(0);

  const r504 = section.locator('[data-office-wo-gap="ZZTEST-job-504"]');
  await expect(r504).toContainText('different quote revision, so nothing is proposed');
  await expect(r504.locator('[data-office-wo-labour-confirm]')).toHaveCount(0);

  const r505 = section.locator('[data-office-wo-gap="ZZTEST-job-505"]');
  await expect(r505).toContainText('The sealed quote amount could not be read, so nothing is proposed');
  await expect(r505.locator('[data-office-wo-labour-confirm]')).toHaveCount(0);
  await expect(r505).not.toContainText('$0.00');

  // A job with no work order gets no proposal.
  await expect(section.locator('[data-office-wo-gap="ZZTEST-job-500"] [data-office-wo-labour]')).toHaveCount(0);
  await expect(section.locator('[data-office-wo-labour-confirm]')).toHaveCount(1);
});

test('FU49 9a: the press posts what was shown, repaints, and names the approver step; a second answer reads already filled', async ({ page }) => {
  await bootGaps(page);
  await page.evaluate(() => {
    window.opsPost = async function (action, body) {
      window.__posts.push({ action, body });
      window.__labourDone = true;
      return {
        state: window.__answerState || 'confirmed',
        work_order_id: body.work_order_id,
        job_budget_id: body.job_budget_id,
        agreed_labour_ex: 2450,
        confirmed_by: '00000000-0000-4000-a000-000000000001',
        confirmed_at: '2026-11-18T07:00:00.000Z',
      };
    };
  });
  const after = { counts: { no_work_order: 1, no_amount: 4, jobs_with_held_lines: 0 }, jobs: LABOUR_GAPS.jobs.filter((j) => j.job_id !== 'ZZTEST-job-501') };
  await paintLabour(page, { gaps: LABOUR_GAPS, labour: LABOUR_LIST });
  await page.evaluate((after) => {
    const base = window.opsFetch;
    window.opsFetch = async function (action, params) {
      if (action === 'job_work_order_gaps' && window.__labourDone) return after;
      return base(action, params);
    };
  }, after);

  const section = page.locator('[data-office-wo-gaps]');
  await section.locator('[data-office-wo-gap="ZZTEST-job-501"]').getByRole('button', { name: 'Fill from sealed quote' }).click();
  await expect(section.locator('[data-office-wo-labour-confirmed]')).toHaveText(
    '$2,450.00 on ZZTEST-501 was filled from the sealed quote. A named approver still approves the work order in Work orders to fill.'
  );
  const posts = await page.evaluate(() => window.__posts);
  expect(posts).toEqual([{
    action: 'confirm_job_work_order_labour',
    body: { work_order_id: 'ZZTEST-wo-501', job_budget_id: '00000000-0000-4000-8000-000000000501', agreed_labour_ex: 2450 },
  }]);
  await expect(section.locator('[data-office-wo-gap="ZZTEST-job-501"]')).toHaveCount(0);
  // The press never approves and never sends.
  expect(posts.some((p) => /approve|send/i.test(p.action))).toBe(false);

  // A retry after a lost reply answers the first record: no second fill.
  await page.evaluate(() => { window.__labourDone = false; window.__answerState = 'already_confirmed'; window.__posts = []; return OfficeWoFill.paint(); });
  await section.locator('[data-office-wo-gap="ZZTEST-job-501"]').getByRole('button', { name: 'Fill from sealed quote' }).click();
  await expect(section.locator('[data-office-wo-labour-confirmed]')).toHaveText(
    '$2,450.00 on ZZTEST-501 was already filled from the sealed quote. A named approver still approves the work order in Work orders to fill.'
  );
});

test('FU49 9a: a refusal says what changed and saves nothing; a failed press can be tried again', async ({ page }) => {
  await bootGaps(page);
  await paintLabour(page, { gaps: LABOUR_GAPS, labour: LABOUR_LIST });
  await page.evaluate(() => {
    window.__failNext = 'proposal_changed';
    window.opsPost = async function (action, body) {
      window.__posts.push({ action, body });
      const e = new Error('The agreed amount was not confirmed.');
      e.status = window.__failNext === 'proposal_changed' ? 409 : 503;
      e.code = window.__failNext;
      throw e;
    };
  });
  const row = page.locator('[data-office-wo-gap="ZZTEST-job-501"]');
  const btn = row.locator('[data-office-wo-labour-confirm]');
  await btn.click();
  await expect(row.locator('[data-office-wo-gap-msg]')).toHaveText(
    'The sealed quote changed since this list was read. Nothing was saved. Read the list again.'
  );
  await expect(btn).toBeDisabled();
  await expect(page.locator('[data-office-wo-labour-confirmed]')).toHaveCount(0);

  await page.evaluate(() => { window.__failNext = 'labour_confirm_failed'; return OfficeWoFill.paint(); });
  await row.locator('[data-office-wo-labour-confirm]').click();
  await expect(row.locator('[data-office-wo-gap-msg]')).toHaveText(
    'The amount could not be filled. Nothing was saved. Read the list again.'
  );
  await expect(row.locator('[data-office-wo-labour-confirm]')).toBeEnabled();
  await expect(page.locator('[data-office-wo-labour-confirmed]')).toHaveCount(0);
});

test('FU49 9a: switch off, not deployed, or refused before the switch hides the press and every proposal', async ({ page }) => {
  await bootGaps(page);
  for (const impl of [
    'return { enabled: false, press: "fill_draft", jobs: [], more: false };',
    'const e = new Error("Unknown action"); e.code = "unknown_action"; e.status = 400; throw e;',
    'const e = new Error("An authorised operator session is required."); e.status = 403; e.code = "operator_access_required"; throw e;',
    'return {};',
  ]) {
    await paintLabour(page, { gaps: LABOUR_GAPS, labour: null });
    await page.evaluate((src) => { window.__labourImpl = new Function(src); return OfficeWoFill.paint(); }, impl);
    const section = page.locator('[data-office-wo-gaps]');
    await expect(section).toContainText('ZZTEST-501');
    await expect(section.locator('[data-office-wo-labour]')).toHaveCount(0);
    await expect(section.locator('[data-office-wo-labour-confirm]')).toHaveCount(0);
    await expect(section.locator('[data-office-wo-labour-error]')).toHaveCount(0);
    await expect(section).not.toContainText('sealed quote');
    await expect(section.locator('[data-office-wo-gap="ZZTEST-job-501"]').getByRole('button', { name: 'Fill the amount' })).toBeVisible();
  }
});

test('FU49 9a: a failed read shows the error state and proposes nothing, never $0.00; a staff role that is not office sees no press', async ({ page }) => {
  await bootGaps(page);
  await paintLabour(page, { gaps: LABOUR_GAPS, labour: null });
  await page.evaluate(() => {
    window.__labourImpl = function () {
      const e = new Error('The jobs’ sealed budgets could not be read.');
      e.status = 503;
      e.code = 'labour_confirm_budget_unreadable';
      throw e;
    };
    return OfficeWoFill.paint();
  });
  const section = page.locator('[data-office-wo-gaps]');
  await expect(section.locator('[data-office-wo-labour-error]')).toHaveText('The sealed quote amounts could not be read, so none is proposed.');
  await expect(section.locator('[data-office-wo-labour]')).toHaveCount(0);
  await expect(section.locator('[data-office-wo-labour-confirm]')).toHaveCount(0);
  await expect(section).not.toContainText('$0.00');
  await expect(section).toContainText('Work orders with no amount: 5');

  // Malformed (no jobs array) is the same error, not an empty list.
  await page.evaluate(() => { window.__labourImpl = function () { return { enabled: true }; }; return OfficeWoFill.paint(); });
  await expect(section.locator('[data-office-wo-labour-error]')).toHaveCount(1);

  await paintLabour(page, { gaps: LABOUR_GAPS, labour: LABOUR_LIST, roleName: 'estimator' });
  await page.evaluate(() => { window.__labourImpl = null; return OfficeWoFill.paint(); });
  const r501 = section.locator('[data-office-wo-gap="ZZTEST-job-501"]');
  await expect(r501.locator('[data-office-wo-labour-amount]')).toHaveText('$2,450.00');
  await expect(r501.locator('[data-office-wo-labour-confirm]')).toHaveCount(0);
});
