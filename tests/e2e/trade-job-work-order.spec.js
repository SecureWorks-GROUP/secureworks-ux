// Trade App: the job's work order (docs/job-work-order-screens.md), behind the
// preview switch (localStorage sw_wo_preview = '1', set by ?wo=preview).
//  - On an allocated fencing or patio job the Scope tab shows the work order
//    from my_job_work_order: each task with its hours, per-metre lines as
//    quoted, variations as marked addenda, and no dollar figure.
//  - On the invoice, a job with an approved work order is billed by the hours
//    worked: the typed "WO allocated $" box is not offered on that job.
//  - With the preview off nothing changes and my_job_work_order is never read.
const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

const SUPABASE_ORIGIN = 'https://kevgrhcjxspbxgovpmfl.supabase.co';
const OPS_API = `${SUPABASE_ORIGIN}/functions/v1/ops-api`;

function approvedWorkOrder(jobId, over) {
  return Object.assign({
    id: 'wo-1', wo_number: 'WO-0042', status: 'approved', approved_at: '2026-10-13T05:00:00Z',
    job_id: jobId, job_number: 'E2E-JOB-001', job_type: 'fencing', site_address: '30 Fixture Road, Joondalup',
    scheduled_date: null, special_instructions: 'Dog on site.',
    scope_items: [
      { description: 'Install Colorbond fencing', qty: 37.6, unit: 'm', kind: 'labour' },
      { description: 'Root removal / hard digging', qty: 2, unit: 'hrs', kind: 'labour' },
      // A money key that should never be there: the page must still not print it.
      { description: 'Plinth install', qty: 21, unit: 'each', hours: 3.5, allocation_ex: 210 },
      { description: 'Remove tree roots between 378/1 and 378/2', hours: 4, variation_number: 1, variation_approved_at: '2026-10-14T02:00:00Z' },
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

  test('preview on: tasks with hours, per metre as quoted, the variation marked, and no dollar figure', async ({ appPage: page }) => {
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
    await expect(wo).toContainText('Root removal / hard digging');
    await expect(wo).toContainText('2 h');
    await expect(wo).toContainText('3.5 h');
    await expect(wo.locator('[data-trade-job-wo-addendum]')).toContainText('Variation 1');
    await expect(wo).toContainText('Hours on hourly tasks');
    await expect(wo).toContainText('Dog on site.');
    const text = await wo.textContent();
    expect(text).not.toContain('$');
    expect(text).not.toContain('210');
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
  test.use({ persona: 'installer', feedScenario: 'wo-labour-explainer' });

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
