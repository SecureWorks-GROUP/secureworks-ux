// Fencing scoping-tool notes on the trade app job detail (fence-scoping-notes-surface).
// The fence-designer tool saves siteNotes / checklist.finalNotes / removal.notes /
// supplierNotes into scope_json.job. trade_job_detail already delivers the full
// (money-redacted for allocated crews) scope_json; renderEnhancedScope simply had
// no line for it, and the one note line that existed read the patio-only
// scope_json.client.notes key, which fencing never writes.
//
// supplierNotes is withheld from trades (commercial/supplier instruction, may
// carry pricing language — firstmate ruling). The other three render under
// "Scoper's notes", money-redacted for allocated crews but with bare dimension
// numbers left intact (this block never routes through the quote-pack stripper).
const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

const SUPABASE_ORIGIN = 'https://kevgrhcjxspbxgovpmfl.supabase.co';
const OPS_API = `${SUPABASE_ORIGIN}/functions/v1/ops-api`;

function fencingDetail(overrides) {
  return Object.assign({
    access_tier: 'allocated',
    quote_visible: false,
    job: {
      id: 'e2e-job-1', job_number: 'E2E-JOB-001', type: 'fencing', status: 'scheduled',
      client_name: 'Fixture Homeowner', client_phone: '0400333444',
      site_address: '30 Fixture Road', site_suburb: 'Joondalup',
      scope_json: {
        job: {
          siteNotes: 'Order 1 sheet as 2100 surfmist',
          checklist: { finalNotes: 'CHECK PROFILE CHECK PROFILE NOT HARMONY' },
          removal: { notes: 'Removal is $450 extra' },
          supplierNotes: 'Less sheets needed do not approve till calculating 1 sheet at 2.1 then rest at 1.8',
          runs: [{ length: 12 }],
        },
      },
    },
    crew: [],
    purchaseOrders: [],
    documents: [],
    notes: [],
    media: [],
  }, overrides || {});
}

function patioDetail() {
  return {
    access_tier: 'allocated',
    quote_visible: false,
    job: {
      id: 'e2e-job-1', job_number: 'E2E-JOB-001', type: 'patio', status: 'scheduled',
      client_name: 'Fixture Homeowner', client_phone: '0400333444',
      site_address: '30 Fixture Road', site_suburb: 'Joondalup',
      scope_json: {
        config: { length: 7, projection: 4.5 },
        client: { notes: 'Patio client note still works' },
      },
    },
    crew: [], purchaseOrders: [], documents: [], notes: [], media: [],
  };
}

async function stub(page, payload) {
  await page.route(`${OPS_API}**`, async (route) => {
    const url = new URL(route.request().url());
    const action = url.searchParams.get('action');
    if (action === 'trade_job_detail') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
    }
    return route.fallback();
  });
}

async function openJob(page, jobNumber) {
  await signIn(page, PERSONAS.installer);
  await page.locator('[data-view="myJobs"]').click();
  await page.locator('#myJobsList .jc').filter({ hasText: jobNumber }).click();
  await expect(page.locator('#viewJob')).toHaveClass(/active/);
}

test.describe('Fencing scoping-tool notes on the trade app job detail', () => {
  test.use({ persona: 'installer' });

  test('shows site/final/removal notes under "Scoper\'s notes", withholds supplier notes, redacts money but keeps dimensions', async ({ appPage: page }) => {
    await stub(page, fencingDetail());
    await openJob(page, 'E2E-JOB-001');
    const scope = page.locator('#jdTab_scope');
    await expect(scope.locator('[data-build-spec]')).toContainText("Scoper's notes");

    // The three trade-visible fields render.
    await expect(scope).toContainText('Order 1 sheet as 2100 surfmist');
    await expect(scope).toContainText('CHECK PROFILE CHECK PROFILE NOT HARMONY');
    // Bare dimension numbers survive money redaction for an allocated (tier-1) crew.
    await expect(scope).toContainText('2100');

    // The explicit currency amount is stripped for the allocated viewer...
    await expect(scope).not.toContainText('$450');
    // ...but the surrounding instruction text still renders.
    await expect(scope).toContainText('Removal is');
    await expect(scope).toContainText('extra');

    // supplierNotes never reaches the trade app.
    await expect(scope).not.toContainText('Less sheets needed');
    await expect(scope).not.toContainText('calculating 1 sheet at 2.1');
  });

  test('a patio job still renders its client.notes and no Scoper\'s notes label', async ({ appPage: page }) => {
    await stub(page, patioDetail());
    await openJob(page, 'E2E-JOB-001');
    const scope = page.locator('#jdTab_scope');
    await expect(scope).toContainText('Patio client note still works');
    await expect(scope).not.toContainText("Scoper's notes");
  });

  test('a fencing job with no scoping notes renders no empty Scoper\'s notes block', async ({ appPage: page }) => {
    const detail = fencingDetail();
    detail.job.scope_json.job = { runs: [{ length: 12 }] };
    await stub(page, detail);
    await openJob(page, 'E2E-JOB-001');
    const scope = page.locator('#jdTab_scope');
    await expect(scope).not.toContainText("Scoper's notes");
  });
});
