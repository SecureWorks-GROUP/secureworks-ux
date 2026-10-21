// Trade App: the job's work order (docs/job-work-order-screens.md), live for
// every allocated trade with no switch (a stale ?wo= or sw_wo_preview value,
// the Ops panel's own preview, never hides it).
//  - On an allocated fencing or patio job the Scope tab shows the work order
//    from my_job_work_order, as that read sends it today (scope keys only from
//    the backend trade allowlist): hours on a line priced in hours, per-metre
//    lines as quoted, and no dollar figure.
//  - On the invoice, a job with an approved work order is billed by the hours
//    worked: the blank typed "WO allocated $" box is not offered on that job.
//    A per-metre trade's server-issued crew work order keeps its Work Order mode.
//  - A stale ?wo=live or sw_wo_preview = '0' still shows it.
const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');
const { fillCardTime } = require('../helpers/invoice-time');

const SUPABASE_ORIGIN = 'https://kevgrhcjxspbxgovpmfl.supabase.co';
const OPS_API = `${SUPABASE_ORIGIN}/functions/v1/ops-api`;

function approvedWorkOrder(jobId, over) {
  return Object.assign({
    id: 'wo-1', wo_number: 'WO-0042', status: 'approved', approved_at: '2026-10-13T05:00:00Z',
    job_id: jobId, job_number: 'E2E-JOB-001', job_type: 'fencing', site_address: '30 Fixture Road, Joondalup',
    scheduled_date: null, special_instructions: 'Dog on site.',
    // Only keys the backend TRADE_WO_SCOPE_ITEM_ALLOWLIST passes today.
    scope_items: [
      { description: 'Install Colorbond fencing', qty: 37.6, unit: 'm', kind: 'labour' },
      { description: 'Root removal / hard digging', qty: 2, unit: 'hrs', kind: 'labour', notes: 'Between the two sheds' },
      { description: 'Plinth install', qty: 21, unit: 'each', kind: 'labour' },
    ],
  }, over || {});
}

function fencingDetail() {
  return {
    access_tier: 'allocated',
    quote_visible: false,
    job: {
      id: 'e2e-job-1', job_number: 'E2E-JOB-001', type: 'fencing', status: 'scheduled',
      client_name: 'Fixture Homeowner', client_phone: '0400333444',
      site_address: '30 Fixture Road', site_suburb: 'Joondalup',
      scope_json: { job: { runs: [{ length: 37.6 }] } },
    },
    crew: [], purchaseOrders: [], documents: [], notes: [], media: [],
  };
}

// Answers trade_job_detail and my_job_work_order; counts the work order reads.
async function stub(page, { detail, workOrderRead }) {
  const reads = [];
  await page.route(`${OPS_API}**`, async (route) => {
    const url = new URL(route.request().url());
    const action = url.searchParams.get('action');
    if (action === 'trade_job_detail' && detail) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail) });
    }
    if (action === 'my_job_work_order') {
      reads.push(url.searchParams.get('job_id'));
      const body = typeof workOrderRead === 'function' ? workOrderRead(url.searchParams.get('job_id')) : workOrderRead;
      if (body && body.__failStatus) {
        return route.fulfill({ status: body.__failStatus, contentType: 'application/json', body: JSON.stringify({ error: 'down' }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    }
    return route.fallback();
  });
  return reads;
}

// A stale Ops preview value left in the browser: ?wo=live in the address and
// sw_wo_preview = '0' stored. Neither may hide the trade's work order.
async function setStaleSwitch(page) {
  await page.evaluate(() => {
    localStorage.setItem('sw_wo_preview', '0');
    history.replaceState(null, '', location.pathname + '?wo=live' + location.hash);
  });
}

async function openJob(page, jobNumber) {
  await page.locator('[data-view="myJobs"]').click();
  await page.locator('#myJobsList .jc').filter({ hasText: jobNumber }).click();
  await expect(page.locator('#viewJob')).toHaveClass(/active/);
}

test.describe('Job work order on the Trade App job', () => {
  test.use({ persona: 'installer' });

  test('hours on a line priced in hours, per metre as quoted, and no dollar figure', async ({ appPage: page }) => {
    const reads = await stub(page, {
      detail: fencingDetail(),
      workOrderRead: { schema: 'trade-job-work-order.v1', job_id: 'e2e-job-1', work_order: approvedWorkOrder('e2e-job-1'), reason: null, can_report_variation: true, my_variations: [] },
    });
    await signIn(page, PERSONAS.installer);
    await openJob(page, 'E2E-JOB-001');
    const wo = page.locator('#jdTab_scope [data-trade-job-wo]');
    await expect(wo).toContainText('WO-0042');
    await expect(wo).toContainText('Approved 13 Oct 2026');
    await expect(wo).toContainText('Install Colorbond fencing');
    await expect(wo).toContainText('37.6 m');
    await expect(wo.locator('.two-line').filter({ hasText: 'Root removal / hard digging' }).locator('.two-hours')).toHaveText('2 h');
    await expect(wo).toContainText('21 each');
    await expect(wo.locator('[data-trade-job-wo-addendum]')).toHaveCount(0);
    await expect(wo).toContainText('Hours on hourly tasks');
    await expect(wo).toContainText('Dog on site.');
    const text = await wo.textContent();
    expect(text).not.toContain('$');
    expect(reads).toContain('e2e-job-1');
  });

  test('an approved customer variation is a marked addendum with its hours, and no dollar figure', async ({ appPage: page }) => {
    // The my_job_work_order shape since backend #1031: work_order.addenda[],
    // each {variation_number, label, approved_at, description, scope_items[]}.
    // Money keys are added here to prove the page never shows one.
    const wo = approvedWorkOrder('e2e-job-1', {
      addenda: [{
        variation_number: 1, label: 'Variation 1 - approved 13 Oct 2026', approved_at: '2026-10-13T07:00:00Z',
        description: 'Remove the tree roots the quote left',
        trade_allocation_ex: 320, customer_price_ex: 921.6,
        scope_items: [
          { description: 'Remove tree roots between 378/1 and 378/2', qty: 4, unit: 'hrs', hours: 4, is_variation: true, variation_number: 1, total: 320, rate: 80, rate_unit: 'hr' },
          { description: 'Extend the fence along the side', qty: 6, unit: 'm', hours: 3, is_variation: true, variation_number: 1 },
        ],
      }],
    });
    await stub(page, {
      detail: fencingDetail(),
      workOrderRead: { schema: 'trade-job-work-order.v1', job_id: 'e2e-job-1', work_order: wo, reason: null, can_report_variation: true, my_variations: [] },
    });
    await signIn(page, PERSONAS.installer);
    await openJob(page, 'E2E-JOB-001');
    const view = page.locator('#jdTab_scope [data-trade-job-wo]');
    const add = view.locator('[data-trade-job-wo-addendum][data-variation-number="1"]');
    await expect(add).toContainText('Variation 1 - approved 13 Oct 2026');
    await expect(add).toContainText('Remove the tree roots the quote left');
    await expect(add.locator('[data-trade-job-wo-variation-line]')).toHaveCount(2);
    await expect(add.locator('[data-trade-job-wo-variation-line]').filter({ hasText: 'Remove tree roots' }).locator('.two-hours')).toHaveText('4 h');
    await expect(add.locator('[data-trade-job-wo-variation-line]').filter({ hasText: 'Extend the fence' })).toContainText('6 m');
    await expect(add.locator('[data-trade-job-wo-variation-line]').filter({ hasText: 'Extend the fence' }).locator('.two-hours')).toHaveText('3 h');
    // The original lines carry no variation mark.
    await expect(view.locator('.two-line').filter({ hasText: 'Install Colorbond fencing' }).locator('.two-var-tag')).toHaveCount(0);
    const text = await view.textContent();
    expect(text).not.toContain('$');
    for (const money of ['320', '921']) expect(text).not.toContain(money);
  });

  test('a job with no approved work order says so', async ({ appPage: page }) => {
    await stub(page, {
      detail: fencingDetail(),
      workOrderRead: { schema: 'trade-job-work-order.v1', job_id: 'e2e-job-1', work_order: null, reason: 'no_approved_work_order', can_report_variation: true, my_variations: [] },
    });
    await signIn(page, PERSONAS.installer);
    await openJob(page, 'E2E-JOB-001');
    await expect(page.locator('#jdTab_scope [data-trade-job-wo-none]')).toBeVisible();
  });

  test('a stale ?wo=live or stored switch does not hide the work order', async ({ appPage: page }) => {
    const reads = await stub(page, {
      detail: fencingDetail(),
      workOrderRead: { schema: 'trade-job-work-order.v1', job_id: 'e2e-job-1', work_order: approvedWorkOrder('e2e-job-1'), reason: null, can_report_variation: true, my_variations: [] },
    });
    await signIn(page, PERSONAS.installer);
    await setStaleSwitch(page);
    await openJob(page, 'E2E-JOB-001');
    await expect(page.locator('#jdTab_scope [data-trade-job-wo]')).toContainText('WO-0042');
    expect(reads).toContain('e2e-job-1');
  });
});

test.describe('Job work order on the trade invoice', () => {
  test.use({ persona: 'installer', feedScenario: 'wo-labour-explainer', appWeekDay: 6 });

  async function openInvoice(page) {
    await page.locator('[data-view="hours"]').click();
    await page.getByRole('button', { name: /Weekly Invoice/ }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    const card = page.locator('.jc-card').filter({ hasText: 'SWF-26767' });
    await expect(card).toBeVisible();
    return card;
  }

  test('a job with an approved work order bills hours: no typed WO allocated box, a note instead', async ({ appPage: page, feedRequests }) => {
    const reads = await stub(page, {
      workOrderRead: (jobId) => ({ schema: 'trade-job-work-order.v1', job_id: jobId, work_order: approvedWorkOrder(jobId, { job_number: 'SWF-26767' }), reason: null, can_report_variation: true, my_variations: [] }),
    });
    await signIn(page, PERSONAS.installer);
    const card = await openInvoice(page);
    const note = card.locator('[data-job-wo-invoice-note]');
    await expect(note).toContainText('Work order WO-0042 is on this job');
    await expect(note).toContainText('Bill the hours you worked');
    await expect(note).not.toContainText('$');
    await expect(card.getByRole('button', { name: 'Work Order' })).toBeDisabled();
    await expect(card.locator('[data-cardwoalloc]')).toHaveCount(0);
    expect(reads).toContain('e2e-wo-holder-job');

    // An hours card says when it was worked before it can be sent.
    await fillCardTime(card, 8);
    await page.locator('#invSubmitBtn').click();
    await page.locator('#confirmAck').check();
    await page.locator('#confirmOk').click();
    await expect(page.getByText('Invoice Submitted')).toBeVisible();
    const submit = feedRequests.find((entry) => entry.method === 'POST' && entry.action === 'generate_trade_invoice');
    expect(submit).toBeTruthy();
    const rows = (submit.body.extra_items || []).concat(submit.body.items || []);
    expect(rows.some((r) => r && r.row_type === 'work_order')).toBe(false);
    expect(JSON.stringify(submit.body)).not.toContain('wo_allocated":5');
  });

  test('a failed refresh keeps the approved work order, so the typed box stays retired', async ({ appPage: page }) => {
    let failing = false;
    const reads = await stub(page, {
      workOrderRead: (jobId) => (failing
        ? { __failStatus: 500 }
        : { schema: 'trade-job-work-order.v1', job_id: jobId, work_order: approvedWorkOrder(jobId, { job_number: 'SWF-26767' }), reason: null, can_report_variation: true, my_variations: [] }),
    });
    await signIn(page, PERSONAS.installer);
    const card = await openInvoice(page);
    await expect(card.locator('[data-job-wo-invoice-note]')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Work Order' })).toBeDisabled();
    const firstReads = reads.length;

    failing = true;
    // Move the page's clock past the two-minute cache, then repaint the builder.
    await page.evaluate(() => { const real = Date.now; Date.now = () => real() + 3 * 60 * 1000; });
    const failed = page.waitForResponse((r) => r.url().includes('action=my_job_work_order') && r.status() === 500);
    await card.getByRole('button', { name: 'Hours' }).click();
    await failed;
    await page.waitForTimeout(300);
    expect(reads.length).toBeGreaterThan(firstReads);
    await expect(card.locator('[data-job-wo-invoice-note]')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Work Order' })).toBeDisabled();
    await expect(card.locator('[data-cardwoalloc]')).toHaveCount(0);
  });

  test('a job with no approved work order keeps the typed Work Order mode', async ({ appPage: page }) => {
    await stub(page, { workOrderRead: (jobId) => ({ job_id: jobId, work_order: null, reason: 'no_approved_work_order' }) });
    await signIn(page, PERSONAS.installer);
    const card = await openInvoice(page);
    await card.getByRole('button', { name: 'Work Order' }).click();
    await expect(card.locator('[data-cardwoalloc]')).toBeVisible();
    await expect(card.locator('[data-job-wo-invoice-note]')).toHaveCount(0);
  });

  test('a read that finds no work order leaves the field the trade is typing in alone', async ({ appPage: page }) => {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    await page.route(`${OPS_API}**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('action') !== 'my_job_work_order') return route.fallback();
      await held;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ job_id: url.searchParams.get('job_id'), work_order: null, reason: 'no_approved_work_order' }) });
    });
    await signIn(page, PERSONAS.installer);
    const card = await openInvoice(page);
    const date = card.locator('[data-carddate]');
    await date.focus();
    await date.evaluate((el) => { el.__typing = true; });

    const landed = page.waitForResponse((r) => r.url().includes('action=my_job_work_order'));
    release();
    await landed;
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => !!(document.activeElement && document.activeElement.__typing))).toBe(true);
  });

  test('My Work Orders keeps a kind=crew row, because my_work_orders does not send kind', async ({ appPage: page }) => {
    await page.route(`${OPS_API}**`, async (route) => {
      const action = new URL(route.request().url()).searchParams.get('action');
      if (action !== 'my_work_orders') return route.fallback();
      const row = (over) => Object.assign({
        job_number: 'E2E-JOB-001', job_type: 'fencing', status: 'authorised',
        site_address: '1 Fixture St', client_name: 'Fixture Homeowner',
        org_id: '00000000-0000-0000-0000-000000000001',
      }, over);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          work_orders: [
            row({ id: 'wo-old', wo_number: 'WO-OLD', kind: 'crew' }),
            row({ id: 'wo-job', wo_number: 'WO-KEEP', kind: 'job' }),
            row({ id: 'wo-plain', wo_number: 'WO-PLAIN' }),
          ],
        }),
      });
    });
    await signIn(page, PERSONAS.installer);
    await page.locator('[data-view="hours"]').click();
    await page.getByRole('button', { name: 'My Work Orders' }).click();
    await expect(page.getByRole('heading', { name: 'My Work Orders' })).toBeVisible();
    await expect(page.locator('[data-work-order-card]')).toHaveCount(3);
    await expect(page.locator('[data-work-order-card]').filter({ hasText: 'WO-OLD' })).toHaveCount(1);
    await expect(page.locator('[data-work-order-card]').filter({ hasText: 'WO-KEEP' })).toHaveCount(1);
    await expect(page.locator('[data-work-order-card]').filter({ hasText: 'WO-PLAIN' })).toHaveCount(1);
  });
});

test.describe('Job work order and a server-issued crew work order', () => {
  // Fixtures date work orders from perthWeekMonday(); a UTC browser after Perth
  // Monday midnight would filter that week out.
  test.use({ persona: 'fencing_manager', timezoneId: 'Australia/Perth' });

  test('a per-metre trade with a hydrated crew work order keeps its Work Order mode and prefilled amount', async ({ appPage: page }) => {
    await stub(page, {
      workOrderRead: (jobId) => ({ schema: 'trade-job-work-order.v1', job_id: jobId, work_order: approvedWorkOrder(jobId, { job_number: 'FENCE-HENRY-001' }), reason: null, can_report_variation: true, my_variations: [] }),
    });
    await signIn(page, PERSONAS.fencing_manager);
    await page.locator('[data-view="hours"]').click();
    await page.getByRole('button', { name: 'Weekly Invoice' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    const card = page.locator('.jc-card').filter({ hasText: 'FENCE-HENRY-001' });
    await expect(card).toBeVisible();
    await expect(card.locator('[data-cardwoalloc]')).toHaveValue('100');
    await expect(card.getByRole('button', { name: 'Work Order', exact: true })).toBeEnabled();
    await expect(card.locator('[data-job-wo-invoice-note]')).toHaveCount(0);
    await expect(card.locator('[data-cardamt]')).toHaveText('$60.00');
  });
});
