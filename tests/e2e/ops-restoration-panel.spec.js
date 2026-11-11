const { test, expect } = require('@playwright/test');
const { revealOpsStaticFixture } = require('../helpers/ops-auth');

// Restoration panel on a make-safe job page (modules/ops-restoration.js).
// Read only: one restoration_plan read per job open, never a write.

function jobDetail(family) {
  return {
    job: {
      id: 'job-restoration',
      job_number: 'SWMS-E2E-R1',
      type: 'makesafe',
      status: 'accepted',
      client_name: 'Fixture Client',
      site_address: '1 Fixture Way',
      site_suburb: 'Lynwood',
      created_at: '2026-11-09T00:00:00Z',
      metadata: { makesafe_job_family: family }
    },
    makesafe_details: { substatus: 'company_contact_required', cycle_number: 1, external_ref: 'MLR-E2E' },
    service_reports: [], media: [], documents: [], work_orders: [], invoices: [], assignments: [], events: []
  };
}

const PLAN = {
  success: true,
  restoration: {
    mode: 'assess_and_quote',
    phase: 'awaiting_approval',
    phase_label: 'Quote with builder',
    next_step: 'Quote SWMS-E2E-R1-Q1 is with the builder. Do not start the quoted works until their approval is recorded.',
    quote: {
      quote_number: 'SWMS-E2E-R1-Q1', revision: 1, subtotal_ex_gst: 1680, status: 'sent',
      sent: { at: '2026-11-12T03:00:00Z', to: 'coordinator@builder.example' },
      pdf_url: 'https://storage.example.invalid/quote.pdf'
    },
    approved_quote_number: null
  },
  authority_limit: { status: 'within_limit', note: "The invoice proposal is $270 ex GST, inside the builder's $1000 authority limit." },
  invoice_handoff: null
};

async function openJob(page, detail, opsFetchBody) {
  await page.goto('/ops.html');
  await revealOpsStaticFixture(page);
  await page.evaluate(({ fixture, fetchBody }) => {
    window.__restorationCalls = [];
    window.opsPost = function (action) { window.__restorationCalls.push('POST ' + action); return Promise.resolve({}); };
    // eslint-disable-next-line no-new-func
    window.opsFetch = new Function('action', 'params', 'window.__restorationCalls.push(action + " " + JSON.stringify(params || {}));' + fetchBody);
    window._currentJobData = fixture;
    window._currentJobId = fixture.job.id;
    document.body.innerHTML = '<main><div id="jdOverview">' + renderMakesafeOpsDetail(fixture) + '</div></main>';
    RestorationOps.paint(fixture);
  }, { fixture: detail, fetchBody: opsFetchBody });
}

test('a restoration job shows its mode, where the quote stands and the quote PDF, from one read', async ({ page }) => {
  await openJob(page, jobDetail('restoration'), 'return Promise.resolve(' + JSON.stringify(PLAN) + ');');
  const card = page.locator('#jdOverview [data-restoration-card]');
  await expect(card).toHaveCount(1);
  await expect(card.locator('[data-restoration-mode]')).toHaveText('Assess and quote');
  await expect(card.locator('[data-restoration-phase]')).toHaveText('Quote with builder');
  await expect(card).toContainText('Do not start the quoted works');
  await expect(card.locator('[data-restoration-quote]')).toHaveText('SWMS-E2E-R1-Q1 · $1,680.00 ex GST · With the builder (coordinator@builder.example), sent 12 Nov 2026');
  await expect(card.locator('[data-restoration-limit]')).toContainText('$1000 authority limit');
  await expect(card.locator('[data-restoration-pdf]')).toHaveAttribute('href', 'https://storage.example.invalid/quote.pdf');
  // One read for this job, and the panel writes nothing.
  expect(await page.evaluate(() => window.__restorationCalls)).toEqual(['restoration_plan {"job_id":"job-restoration"}']);
});

test('an ordinary make-safe gets no panel and no read', async ({ page }) => {
  await openJob(page, jobDetail('general_makesafe'), 'return Promise.resolve({});');
  await expect(page.locator('#jdOverview [data-restoration-plan]')).toHaveCount(1);
  await expect(page.locator('#jdOverview [data-restoration-card]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__restorationCalls)).toEqual([]);
});

test('a back end that does not know the action yet paints nothing; any other failed read says so', async ({ page }) => {
  await openJob(page, jobDetail('restoration'), 'return Promise.reject(new Error("Unknown action: restoration_plan"));');
  await expect(page.locator('#jdOverview [data-restoration-card]')).toHaveCount(0);

  await openJob(page, jobDetail('restoration'), 'return Promise.reject(new Error("Quote SWMS-E2E-R1-Q1 on SWMS-E2E-R1 does not match its filed document, so nothing was changed. It needs a person to look at it."));');
  const failed = page.locator('#jdOverview [data-restoration-failed]');
  await expect(failed).toContainText('Restoration plan not shown.');
  await expect(failed).toContainText('does not match its filed document');
});

test('an answer for a job the page has left is dropped', async ({ page }) => {
  await openJob(page, jobDetail('restoration'), 'return new Promise(function (resolve) { window.__resolvePlan = resolve; });');
  await page.evaluate((plan) => {
    window._currentJobId = 'some-other-job';
    window.__resolvePlan(plan);
  }, PLAN);
  await page.waitForTimeout(50);
  await expect(page.locator('#jdOverview [data-restoration-card]')).toHaveCount(0);
});
