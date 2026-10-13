// Trade App: the job's work order (docs/job-work-order-screens.md), behind the
// preview switch (localStorage sw_wo_preview = '1', set by ?wo=preview).
//  - On an allocated fencing or patio job the Scope tab shows the work order
//    from my_job_work_order, as that read sends it today (scope keys only from
//    the backend trade allowlist): hours on a line priced in hours, per-metre
//    lines as quoted, and no dollar figure.
//  - On the invoice, a job with an approved work order is billed by the hours
//    worked: the blank typed "WO allocated $" box is not offered on that job.
//    A per-metre trade's server-issued crew work order keeps its Work Order mode.
//  - With the preview off nothing changes and my_job_work_order is never read.
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

async function setPreview(page, on) {
  await page.evaluate((on) => {
    if (on) localStorage.setItem('sw_wo_preview', '1');
    else localStorage.removeItem('sw_wo_preview');
  }, on);
}

async function openJob(page, jobNumber) {
  await page.locator('[data-view="myJobs"]').click();
  await page.locator('#myJobsList .jc').filter({ hasText: jobNumber }).click();
  await expect(page.locator('#viewJob')).toHaveClass(/active/);
}

test.describe('Job work order on the Trade App job (preview)', () => {
  test.use({ persona: 'installer' });

  test('preview on: hours on a line priced in hours, per metre as quoted, and no dollar figure', async ({ appPage: page }) => {
    const reads = await stub(page, {
      detail: fencingDetail(),
      workOrderRead: { schema: 'trade-job-work-order.v1', job_id: 'e2e-job-1', work_order: approvedWorkOrder('e2e-job-1'), reason: null, can_report_variation: true, my_variations: [] },
    });
    await signIn(page, PERSONAS.installer);
    await setPreview(page, true);
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

  test('preview on: a job with no approved work order says so', async ({ appPage: page }) => {
    await stub(page, {
      detail: fencingDetail(),
      workOrderRead: { schema: 'trade-job-work-order.v1', job_id: 'e2e-job-1', work_order: null, reason: 'no_approved_work_order', can_report_variation: true, my_variations: [] },
    });
    await signIn(page, PERSONAS.installer);
    await setPreview(page, true);
    await openJob(page, 'E2E-JOB-001');
    await expect(page.locator('#jdTab_scope [data-trade-job-wo-none]')).toBeVisible();
  });

  test('preview off: no work order section and no work order read', async ({ appPage: page }) => {
    const reads = await stub(page, { detail: fencingDetail(), workOrderRead: { work_order: approvedWorkOrder('e2e-job-1') } });
    await signIn(page, PERSONAS.installer);
    await setPreview(page, false);
    await openJob(page, 'E2E-JOB-001');
    await expect(page.locator('#jdTab_scope')).toContainText('Build spec');
    await expect(page.locator('[data-trade-job-wo]')).toHaveCount(0);
    expect(reads).toEqual([]);
  });
});

test.describe('Job work order on the trade invoice (preview)', () => {
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
    await setPreview(page, true);
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
    await setPreview(page, true);
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
    await setPreview(page, true);
    const card = await openInvoice(page);
    await card.getByRole('button', { name: 'Work Order' }).click();
    await expect(card.locator('[data-cardwoalloc]')).toBeVisible();
    await expect(card.locator('[data-job-wo-invoice-note]')).toHaveCount(0);
  });
});

test.describe('Job work order and a server-issued crew work order (preview)', () => {
  // Fixtures date work orders from perthWeekMonday(); a UTC browser after Perth
  // Monday midnight would filter that week out.
  test.use({ persona: 'fencing_manager', timezoneId: 'Australia/Perth' });

  test('a per-metre trade with a hydrated crew work order keeps its Work Order mode and prefilled amount', async ({ appPage: page }) => {
    await stub(page, {
      workOrderRead: (jobId) => ({ schema: 'trade-job-work-order.v1', job_id: jobId, work_order: approvedWorkOrder(jobId, { job_number: 'FENCE-HENRY-001' }), reason: null, can_report_variation: true, my_variations: [] }),
    });
    await signIn(page, PERSONAS.fencing_manager);
    await setPreview(page, true);
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
