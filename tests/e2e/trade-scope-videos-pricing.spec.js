const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

const SUPABASE_ORIGIN = 'https://kevgrhcjxspbxgovpmfl.supabase.co';
const OPS_API = `${SUPABASE_ORIGIN}/functions/v1/ops-api`;
const VIDEO_WALK = 'data:video/mp4,walkthrough';
const VIDEO_OTHER = 'data:video/mp4,other-job-video';
const WO_PDF = `${SUPABASE_ORIGIN}/storage/v1/object/sign/docs/e2e-wo.pdf?token=e2e`;

function patioDetail(overrides) {
  return Object.assign({
    job: {
      id: 'e2e-job-1',
      job_number: 'E2E-JOB-001',
      type: 'patio',
      status: 'scheduled',
      client_name: 'Fixture Homeowner',
      client_phone: '0400333444',
      site_address: '30 Fixture Road',
      site_suburb: 'Joondalup',
      scope_summary: 'Install fixture patio',
      scope_json: {
        length: 6,
        projection: 4,
        walkthrough: true,
        client: { notes: 'Match existing fascia colour. Quote total $8,800.' },
      },
    },
    crew: [],
    purchaseOrders: [],
    documents: [
      {
        type: 'work_order',
        file_name: 'Builder-WO.pdf',
        pdf_url: WO_PDF,
        storage_url: WO_PDF,
        visible_to_trades: true,
        version: 1,
      },
      {
        type: 'builder_pack',
        file_name: 'Site-WO.pdf',
        pdf_url: WO_PDF,
        storage_url: WO_PDF,
        visible_to_trades: true,
        version: 1,
      },
    ],
    notes: [],
    media: [
      {
        id: 'e2e-walkthrough',
        type: 'video',
        label: 'Site walkthrough quote total $8,800',
        phase: 'scope',
        playable_url: VIDEO_WALK,
      },
      {
        id: 'e2e-other-video',
        type: 'video',
        label: 'Install recap',
        phase: 'in_progress',
        signed_url: VIDEO_OTHER,
      },
      {
        id: 'e2e-scope-photo',
        type: 'photo',
        phase: 'scope',
        storage_url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
      },
      {
        id: 'e2e-office-video',
        type: 'video',
        label: 'Office only recap',
        playable_url: 'data:video/mp4,office-only',
        visible_to_trades: false,
      },
      {
        id: 'e2e-wo-as-video',
        type: 'work_order',
        is_video: true,
        file_name: 'Builder-WO.pdf',
        playable_url: WO_PDF,
        visible_to_trades: true,
      },
    ],
    quote_packs: [
      {
        quote_number: 'Q-4412',
        status: 'accepted',
        sent_at: '2026-09-01',
        summary: 'Build the patio as drawn',
        items: [
          { description: 'Install insulated patio', quantity: 1, unit: 'job', unit_price: 8800 },
        ],
      },
    ],
    workOrder: {
      wo_number: 'WO-99',
      special_instructions: 'Match existing fascia. Quote total $8,800.',
      scope_items: [
        { description: 'Posts and beams', quantity: 8, unit: 'ea', unit_price: 120, total: 960 },
      ],
    },
  }, overrides || {});
}

function makesafeDetail() {
  return {
    job: {
      id: 'e2e-makesafe-allocated',
      job_number: 'E2E-MS-002',
      type: 'makesafe',
      status: 'scheduled',
      client_name: 'Allocated Client',
      site_address: '20 Fixture Avenue',
      site_suburb: 'Fremantle',
      scope_json: { walkthrough_recorded: true },
    },
    crew: [],
    purchaseOrders: [],
    documents: [
      {
        type: 'work_order',
        file_name: 'Builder-WO.pdf',
        pdf_url: WO_PDF,
        storage_url: WO_PDF,
        visible_to_trades: true,
        version: 1,
      },
    ],
    notes: [],
    media: [
      {
        id: 'ms-walk',
        type: 'video',
        label: 'Site walkthrough',
        playable_url: VIDEO_WALK,
      },
      {
        id: 'ms-other',
        type: 'video',
        label: 'Roof recap',
        signed_url: VIDEO_OTHER,
      },
    ],
    workOrder: {
      wo_number: 'MS-WO-1',
      scope_items: [
        { description: 'Tarp roof sheets', quantity: 1, unit_price: 340, total: 340 },
      ],
    },
    makesafe_details: {
      makesafe_type: 'Roof / tarp',
      substatus: 'waiting_on_trade_report',
    },
    serviceReport: {
      status: 'draft',
      checklist_json: {
        arrival_time: '2026-09-06 09:00',
        damage_description: 'Roof sheets lifted',
        work_done: 'Installed tarp',
      },
    },
  };
}

async function stubJobDetail(page, payload) {
  await page.route(WO_PDF, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/pdf',
      body: '%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF',
    });
  });
  await page.route(`${OPS_API}**`, async (route) => {
    const action = new URL(route.request().url()).searchParams.get('action');
    if (action === 'trade_job_detail') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(payload),
      });
      return;
    }
    await route.fallback();
  });
}

test.describe('TRD-5 trade videos and SOW pricing', () => {
  test.use({ persona: 'installer' });

  test('Scope tab shows all videos, quote writing, WO items, and no prices', async ({ appPage: page }) => {
    await stubJobDetail(page, patioDetail());
    await signIn(page, PERSONAS.installer);
    await page.locator('[data-view="myJobs"]').click();
    await page.locator('#myJobsList .jc').filter({ hasText: 'E2E-JOB-001' }).click();
    await expect(page.locator('#viewJob')).toHaveClass(/active/);
    await expect(page.locator('.jd-tab[data-tab="scope"]')).toHaveClass(/active/);

    const scope = page.locator('#jdTab_scope');
    await expect(scope.locator('[data-job-videos]')).toBeVisible();
    await expect(scope.locator('video[src="' + VIDEO_WALK + '"]')).toHaveCount(1);
    await expect(scope.locator('video[src="' + VIDEO_OTHER + '"]')).toHaveCount(1);
    await expect(scope.locator('video[src="data:video/mp4,office-only"]')).toHaveCount(0);
    await expect(scope).toContainText('Match existing fascia');
    await expect(scope).toContainText('Site walkthrough quote total');
    await expect(scope).toContainText('Q-4412');
    await expect(scope).toContainText('Install insulated patio');
    await expect(scope).toContainText('Posts and beams');
    await expect(scope).not.toContainText('$');
    await expect(scope).not.toContainText('8800');
    await expect(scope).not.toContainText('960');
    await expect(scope.locator('video[src="' + WO_PDF + '"]')).toHaveCount(0);

    await page.locator('.jd-tab[data-tab="files"]').click();
    const files = page.locator('#jdTab_files');
    await expect(files.locator('video[src="' + VIDEO_WALK + '"]')).toHaveCount(1);
    await expect(files.locator('video[src="' + VIDEO_OTHER + '"]')).toHaveCount(1);
    await expect(files).toContainText('Q-4412');
    await expect(files).not.toContainText('$');
    await expect(files.locator('a[href="' + WO_PDF + '"]')).toHaveCount(0);
    await expect(files).not.toContainText('Builder-WO.pdf');
    await expect(files).not.toContainText('Site-WO.pdf');
    await expect(scope.locator('video[src="' + WO_PDF + '"]')).toHaveCount(0);
    await expect(files.locator('video[src="' + WO_PDF + '"]')).toHaveCount(0);

    await page.locator('.jd-tab[data-tab="photos"]').click();
    const photos = page.locator('#jdTab_photos');
    await expect(photos.locator('video[src="' + VIDEO_WALK + '"]')).toHaveCount(1);
    await expect(photos.locator('video[src="' + VIDEO_OTHER + '"]')).toHaveCount(1);
  });

  test('walkthrough flagged with no file is an honest empty, not omitted', async ({ appPage: page }) => {
    await stubJobDetail(page, patioDetail({
      media: [{
        id: 'e2e-scope-photo',
        type: 'photo',
        phase: 'scope',
        storage_url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
      }],
    }));
    await signIn(page, PERSONAS.installer);
    await page.locator('[data-view="myJobs"]').click();
    await page.locator('#myJobsList .jc').filter({ hasText: 'E2E-JOB-001' }).click();
    const scope = page.locator('#jdTab_scope');
    await expect(scope.locator('[data-walkthrough-missing]')).toContainText('Walkthrough recorded. File not available.');
    await expect(scope.locator('video')).toHaveCount(0);
  });

  test('make-safe report header plays job videos and hides priced WO PDF from trades', async ({ appPage: page }) => {
    await stubJobDetail(page, makesafeDetail());
    await signIn(page, PERSONAS.installer);
    await page.evaluate(() => window.openJobReport('e2e-makesafe-allocated', 'e2e-ms-assignment'));
    const header = page.locator('#makesafeWorkOrderDirect');
    await expect(header.locator('video[src="' + VIDEO_WALK + '"]')).toHaveCount(1);
    await expect(header.locator('video[src="' + VIDEO_OTHER + '"]')).toHaveCount(1);
    await expect(header.locator('iframe[title="Builder work order PDF"]')).toHaveCount(0);
    await expect(header.getByRole('link', { name: /Open full WO/i })).toHaveCount(0);
    await expect(header.getByRole('link', { name: /Full screen/i })).toHaveCount(0);
    await expect(header).not.toContainText(WO_PDF);
    await expect(header).toContainText('Tarp roof sheets');
    await expect(header).not.toContainText('$');
    await expect(header).not.toContainText('340');
  });
});

test.describe('TRD-5 office may see SOW rates', () => {
  test.use({ persona: 'allocator' });

  test('office quote pack still shows rates when canSeeFullPricing', async ({ appPage: page }) => {
    await stubJobDetail(page, patioDetail());
    await signIn(page, PERSONAS.allocator);
    await page.locator('[data-view="myJobs"]').click();
    await page.locator('#myJobsList .jc').filter({ hasText: 'E2E-JOB-001' }).click();
    await page.locator('.jd-tab[data-tab="scope"]').click();
    const scope = page.locator('#jdTab_scope');
    await expect(scope).toContainText('Q-4412');
    await expect(scope).toContainText('$');
  });

  test('office make-safe header still shows the full WO PDF', async ({ appPage: page }) => {
    await stubJobDetail(page, makesafeDetail());
    await signIn(page, PERSONAS.allocator);
    await page.evaluate(() => window.openJobReport('e2e-makesafe-allocated', 'e2e-ms-assignment'));
    const header = page.locator('#makesafeWorkOrderDirect');
    await expect(header.locator('iframe[title="Builder work order PDF"]')).toHaveAttribute('src', WO_PDF);
    await expect(header.getByRole('link', { name: /Open full WO/i })).toBeVisible();
  });
});
