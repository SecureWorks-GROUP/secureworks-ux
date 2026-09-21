const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

const OPS_API = 'https://kevgrhcjxspbxgovpmfl.supabase.co/functions/v1/ops-api';

const REPAIR_DETAILS = {
  'e2e-plain-repair-job': {
    job: {
      id: 'e2e-plain-repair-job',
      job_number: 'REP-51002',
      type: 'repair',
      status: 'scheduled',
      client_name: 'Repair Client',
      site_address: '2 Repair Avenue, Wanneroo',
      site_suburb: 'Wanneroo',
      scope_json: { notes: { noteWorkOrder: 'Replace the damaged rear fence section.' } }
    },
    documents: [
      { type: 'work_order', file_name: 'REP-51002-work-order.pdf', visible_to_trades: true, url: 'https://example.test/REP-51002-work-order.pdf' },
      { type: 'general', file_name: 'REP-51002-builder-photos.pdf', visible_to_trades: true, url: 'https://example.test/REP-51002-builder-photos.pdf' }
    ]
  },
  'e2e-repair-family-job': {
    // The list/card feed knows this is Repair, but the detail's jobs row still
    // carries its historical type. The family signal is in the detail overlay,
    // which is the production shape that exposed the routing regression.
    job: {
      id: 'e2e-repair-family-job',
      job_number: 'SWMS-261319',
      type: 'makesafe',
      status: 'scheduled',
      client_name: 'Simon Davey',
      site_address: '1 Repair Street, Duncraig',
      site_suburb: 'Duncraig',
      scope_json: { notes: { noteWorkOrder: 'Repair the storm-damaged eaves.' } }
    },
    makesafe_details: { ses_family: 'repair' },
    documents: [
      { type: 'work_order', file_name: 'SWMS-261319-work-order.pdf', visible_to_trades: true, url: 'https://example.test/SWMS-261319-work-order.pdf' },
      { type: 'general', file_name: 'SWMS-261319-builder-brief.pdf', visible_to_trades: true, url: 'https://example.test/SWMS-261319-builder-brief.pdf' }
    ]
  }
};

async function installRepairDetails(page) {
  await page.route(`${OPS_API}**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('action') !== 'trade_job_detail') return route.fallback();
    const detail = REPAIR_DETAILS[url.searchParams.get('jobId')];
    if (!detail) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        crew: [],
        purchaseOrders: [],
        media: [],
        notes: [],
        workOrder: { wo_number: `WO-${detail.job.job_number}`, special_instructions: detail.job.scope_json.notes.noteWorkOrder },
        ...detail
      })
    });
  });
}

async function openFromMyJobs(page, jobNumber) {
  await page.locator('[data-view="myJobs"]').click();
  const card = page.locator('#myJobsList .jc.rp').filter({ hasText: jobNumber });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Repair');
  await card.click();
}

async function expectStandardRepairScreen(page, jobNumber, documentNames) {
  await expect(page.locator('#viewJob')).toHaveClass(/active/);
  await expect(page.locator('#viewReport')).not.toHaveClass(/active/);
  await expect(page.locator('#jobDetailContent')).toContainText(jobNumber);

  const tabs = page.locator('#jobDetailContent .jd-tab');
  await expect(tabs).toHaveText(['Work', 'Scope', 'Files', 'Photos', 'Comms', 'Log']);
  await expect(page.locator('.jd-tab[data-tab="ms_report"]')).toHaveCount(0);

  await page.locator('.jd-tab[data-tab="files"]').click();
  const files = page.locator('#jdTab_files');
  await expect(files).toContainText('Approvals & Documents');
  for (const name of documentNames) await expect(files).toContainText(name);
  await expect(page.locator('#reportContent')).not.toContainText('Load MakeSafe report');
  await expect(page.locator('#reportContent')).not.toContainText('Loading MakeSafe report');
}

test.describe('Trade repair job screen', () => {
  test.use({ persona: 'allocator', feedScenario: 'trade-repair-vertical' });

  test.beforeEach(async ({ appPage: page }) => {
    await installRepairDetails(page);
    await signIn(page, PERSONAS.allocator);
  });

  test('type=repair opens the standard job screen with every attached file', async ({ appPage: page }) => {
    await openFromMyJobs(page, 'REP-51002');
    await expectStandardRepairScreen(page, 'REP-51002', [
      'REP-51002-work-order.pdf',
      'REP-51002-builder-photos.pdf'
    ]);
  });

  test('repair-family type=makesafe opens the standard job screen with every attached file', async ({ appPage: page }) => {
    await openFromMyJobs(page, 'SWMS-261319');
    await expectStandardRepairScreen(page, 'SWMS-261319', [
      'SWMS-261319-work-order.pdf',
      'SWMS-261319-builder-brief.pdf'
    ]);
  });
});
