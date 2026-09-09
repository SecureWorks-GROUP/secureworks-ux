// 2026-09-09 — job view layout truth on a phone: the tab bar sticks just under
// the app header instead of sliding beneath it, the completion wizard footer
// stays glued to the bottom edge (no position:fixed float), the Log tab does
// not repeat the bottom Notes block and groups photos into one strip, and
// document rows read cleanly (no "PO PO-", human quote dates).
const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

const SUPABASE_ORIGIN = 'https://kevgrhcjxspbxgovpmfl.supabase.co';
const OPS_API = `${SUPABASE_ORIGIN}/functions/v1/ops-api`;
const PX = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
const PDF = `${SUPABASE_ORIGIN}/storage/v1/object/sign/docs/e2e-plans.pdf?token=e2e`;

function detail(uid) {
  return {
    access_tier: 'allocated', quote_visible: false,
    job: { id: 'e2e-job-1', job_number: 'E2E-JOB-001', type: 'patio', status: 'scheduled', client_name: 'Fixture Homeowner', client_phone: '0400333444',
      site_address: '30 Fixture Road', site_suburb: 'Joondalup', scheduled_date: '2026-09-09',
      scope_json: { config: { length: 7, projection: 4.5, roofStyle: 'flat', roofing: 'insulated', posts: 3 } } },
    crew: [{ id: 'asn-1', user_id: uid, users: { id: uid, name: 'E2E Installer' }, scheduled_date: '2026-09-09', status: 'in_progress', started_at: '2026-09-09T00:00:00Z', clocked_on_at: '2026-09-09T00:00:00Z' }],
    purchaseOrders: [{ id: 'po-ok', po_number: 'PO-2041', supplier_name: 'Stratco Malaga', status: 'authorised', delivery_date: '2026-09-08', line_items: [{ description: 'Insulated roof panel', quantity: 6 }] }],
    documents: [{ id: 'd-plans', type: 'council_plans', file_name: 'BA-approval.pdf', pdf_url: PDF, storage_url: PDF, visible_to_trades: true }],
    notes: [{ id: 'n1', event_type: 'note', created_at: '2026-09-06T01:00:00.000Z', users: { name: 'Office' }, detail_json: { text: 'Knock on side door.', from_ops: true } }],
    media: [
      { id: 'v1', type: 'video', label: 'Site walkthrough', phase: 'scope', playable_url: 'data:video/mp4,walk', created_at: '2026-09-05T01:00:00Z' },
      { id: 'p1', type: 'photo', phase: 'scope', storage_url: PX, created_at: '2026-09-05T01:01:00Z' },
      { id: 'p2', type: 'photo', phase: 'scope', storage_url: PX, created_at: '2026-09-05T01:02:00Z' },
      { id: 'p3', type: 'photo', phase: 'in_progress', storage_url: PX, created_at: '2026-09-05T01:03:00Z' },
    ],
    quote_packs: [{ quote_number: 'Q-7731', job_document_id: 'doc-q-7731', status: 'accepted', accepted: true, sent_at: '2026-08-28T02:00:00Z', source: 'frozen', summary: 'Flat insulated patio', items: [{ kind: 'patio_tube', description: 'Supply and install patio', quantity: 31.5, unit: 'm2' }] }],
    quote_extracts: [{ type: 'trade_quote_extract', label: 'Quote extract', action: 'trade_quote_extract', job_document_id: 'doc-q-7731', quote_number: 'Q-7731', status: 'accepted', sent_at: '2026-08-28T02:00:00Z', filename: 'x.html' }],
    workOrder: { id: 'wo-1', wo_number: 'WO-1188', estimated_hours: 16, special_instructions: 'Start 7am.', scope_items: [{ description: 'Dig footings', quantity: 3, unit: 'ea' }] },
    completion_evidence: { job_id: 'e2e-job-1', applies: true, satisfied: false, photos: 0, photos_required: 3, signoffs: 0, signoffs_required: 1, missing: ['completion_photos'] },
  };
}

async function openJob(page) {
  const uid = PERSONAS.installer.profile.id;
  await page.route(`${OPS_API}**`, async (route) => {
    const a = new URL(route.request().url()).searchParams.get('action');
    if (a === 'trade_job_detail') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail(uid)) });
    if (a === 'trade_labour_budget') return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    return route.fallback();
  });
  await signIn(page, PERSONAS.installer);
  await page.locator('[data-view="myJobs"]').click();
  await page.locator('#myJobsList .jc').filter({ hasText: 'E2E-JOB-001' }).click();
  await expect(page.locator('#viewJob')).toHaveClass(/active/);
  await expect(page.locator('.jd-tabs')).toBeVisible();
}

test.use({ persona: 'installer', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

test('tab bar sticks under the header while the job scrolls', async ({ appPage: page }) => {
  await openJob(page);
  await page.evaluate(() => window.scrollTo(0, 1200));
  await page.waitForTimeout(150);
  const m = await page.evaluate(() => {
    const header = document.querySelector('.header').getBoundingClientRect();
    const tabs = document.querySelector('.jd-tabs-wrap').getBoundingClientRect();
    return { headerBottom: header.bottom, tabsTop: tabs.top, tabsBottom: tabs.bottom, scrollY: window.scrollY };
  });
  expect(m.scrollY).toBeGreaterThan(800);
  expect(Math.abs(m.tabsTop - m.headerBottom)).toBeLessThan(2);
  await expect(page.locator('.jd-tab[data-tab="files"]')).toBeInViewport();
});

test('completion wizard footer sits on the bottom edge and only the body scrolls', async ({ appPage: page }) => {
  await openJob(page);
  await page.locator('[data-stepper-finish]').click();
  await page.locator('#confirmOk').click();
  await expect(page.locator('#wizOverlay')).toHaveClass(/active/);
  const m = await page.evaluate(() => {
    const f = document.getElementById('wizFooter').getBoundingClientRect();
    const b = document.getElementById('wizBody');
    return { footerBottom: f.bottom, vh: window.innerHeight, footerPos: getComputedStyle(document.getElementById('wizFooter')).position, bodyOverflow: getComputedStyle(b).overflowY };
  });
  expect(Math.abs(m.footerBottom - m.vh)).toBeLessThan(2);
  expect(m.footerPos).not.toBe('fixed');
  expect(m.bodyOverflow).toBe('auto');
});

test('Log tab hides the duplicate Notes block, groups photos, and skips videos', async ({ appPage: page }) => {
  await openJob(page);
  await expect(page.locator('#jobBottomNotes')).toBeVisible();
  await page.locator('.jd-tab[data-tab="log"]').click();
  await expect(page.locator('#jobBottomNotes')).toBeHidden();
  const strip = page.locator('#tabNotesList .log-photos');
  await expect(strip).toHaveCount(1);
  await expect(strip).toContainText('3 photos');
  await expect(strip.locator('img')).toHaveCount(3);
  await expect(page.locator('#tabNotesList')).not.toContainText('Site walkthrough');
  await page.locator('.jd-tab[data-tab="scope"]').click();
  await expect(page.locator('#jobBottomNotes')).toBeVisible();
});

test('Files tab document rows read cleanly', async ({ appPage: page }) => {
  await openJob(page);
  await page.locator('.jd-tab[data-tab="files"]').click();
  const files = page.locator('#jdTab_files');
  await expect(files.locator('[data-po-doc="po-ok"] .doc-name')).toHaveText('PO-2041');
  await expect(files.locator('[data-quote-doc="Q-7731"]')).toContainText('Sent 28 Aug 2026');
  await expect(files).not.toContainText('2026-08-28');
  await expect(page.locator('#jobDetailContent')).not.toContainText('not available from this server');
});

test('action bar offers Issue to the allocated trade, and back lives only in the header', async ({ appPage: page }) => {
  await openJob(page);
  await expect(page.locator('.jd-action-bar [data-report-issue]')).toBeVisible();
  await expect(page.locator('#btnBack')).toBeVisible();
  await expect(page.locator('#jobDetailContent').getByRole('button', { name: /Back to Jobs/ })).toHaveCount(0);
});
