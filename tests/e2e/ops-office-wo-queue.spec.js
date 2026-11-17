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
  await page.goto('/ops.html');
  // The auth gate hides every body child with display:none !important until
  // sign-in. These specs drive the page functions directly.
  await revealOpsStaticFixture(page);
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

// The queue holds every job type's drafts in one list. The type buttons show
// one type at a time, so a repair is not lost among make-safes.
const MIXED = [
  { ...ROW, id: 'wo-f1', wo_number: 'WO-F1', job_number: 'SWF-1', job_type: 'fencing' },
  { ...ROW, id: 'wo-m1', wo_number: 'WO-M1', job_number: 'SWMS-1', job_type: 'makesafe', agreed_labour_ex: null, needs_allowance: true },
  { ...ROW, id: 'wo-r1', wo_number: 'WO-R1', job_number: 'SWR-1', job_type: 'repair', agreed_labour_ex: null, needs_allowance: true },
  { ...ROW, id: 'wo-m2', wo_number: 'WO-M2', job_number: 'SWMS-2', job_type: 'makesafe', agreed_labour_ex: null, needs_allowance: true },
  { ...ROW, id: 'wo-x1', wo_number: 'WO-X1', job_number: 'SWM-1', job_type: 'miscellaneous', agreed_labour_ex: null, needs_allowance: true },
];

test('a queue of one job type draws no type buttons', async ({ page }) => {
  await boot(page, `if (action === 'list_office_job_work_orders') return { enabled: true, work_orders: ${JSON.stringify([ROW, { ...ROW, id: 'wo-fill-2', wo_number: 'WO-101' }])} }; return {};`);
  await page.evaluate(() => OfficeWoFill.paint());
  await expect(page.locator('[data-office-wo-fill]')).toHaveCount(2);
  await expect(page.locator('[data-office-wo-types]')).toHaveCount(0);
});

test('type buttons count each job type and show one type at a time', async ({ page }) => {
  await boot(page, `if (action === 'list_office_job_work_orders') return { enabled: true, work_orders: ${JSON.stringify(MIXED)} }; return {};`);
  await page.evaluate(() => { try { localStorage.removeItem('sw_owf_type'); } catch (e) {} return OfficeWoFill.paint(); });
  await showWorkOrders(page);
  const queue = page.locator('[data-office-wo-fill-queue]');
  const types = queue.locator('[data-office-wo-type]');
  await expect(types).toHaveText(['All (5)', 'Fencing (1)', 'Repair (1)', 'Make-safe (2)', 'Other (1)']);
  await expect(queue.locator('[data-office-wo-type="all"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(queue.locator('[data-office-wo-fill]')).toHaveCount(5);

  await queue.locator('[data-office-wo-type="repair"]').click();
  await expect(queue.locator('[data-office-wo-fill]')).toHaveCount(1);
  await expect(queue.locator('[data-office-wo-fill]')).toContainText('SWR-1');
  await expect(queue.locator('[data-office-wo-type="repair"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(queue.locator('[data-office-wo-type="all"]')).toHaveAttribute('aria-pressed', 'false');
  // The counts still describe the whole queue, not the type on screen.
  await expect(types).toHaveText(['All (5)', 'Fencing (1)', 'Repair (1)', 'Make-safe (2)', 'Other (1)']);
  // Choosing a type reads nothing again and writes nothing.
  expect(await page.evaluate(() => window.__posts.length)).toBe(0);

  // A save from the filtered list posts that row, and the choice survives the re-read.
  await queue.locator('[data-office-wo-allowance]').fill('450');
  await queue.locator('[data-office-wo-fill-save]').click();
  await expect.poll(() => page.evaluate(() => window.__posts.length)).toBe(1);
  const fill = await page.evaluate(() => window.__posts[0]);
  expect(fill.action).toBe('fill_job_work_order_allowance');
  expect(fill.body.work_order_id).toBe('wo-r1');
  expect(fill.body.agreed_labour_ex).toBe(450);
  await expect(queue.locator('[data-office-wo-type="repair"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-office-wo-fill]')).toHaveCount(1);
  expect(await page.evaluate(() => localStorage.getItem('sw_owf_type'))).toBe('repair');
});

test('a chosen type with no drafts left falls back to every type', async ({ page }) => {
  await boot(page, 'return {};');
  await page.evaluate((rows) => {
    window.__rows = rows;
    window.opsFetch = async function () { return { enabled: true, work_orders: window.__rows }; };
    try { localStorage.setItem('sw_owf_type', 'repair'); } catch (e) {}
    return OfficeWoFill.paint();
  }, MIXED);
  await showWorkOrders(page);
  await page.locator('[data-office-wo-type="repair"]').click();
  await expect(page.locator('[data-office-wo-fill]')).toHaveCount(1);

  // The last repair draft is approved elsewhere; the next read has none.
  await page.evaluate(() => {
    window.__rows = window.__rows.filter((r) => r.job_type !== 'repair');
    return OfficeWoFill.paint();
  });
  await expect(page.locator('[data-office-wo-type]')).toHaveText(['All (4)', 'Fencing (1)', 'Make-safe (2)', 'Other (1)']);
  await expect(page.locator('[data-office-wo-type="all"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-office-wo-fill]')).toHaveCount(4);
});
