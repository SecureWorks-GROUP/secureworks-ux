// Trade job view — scope of works clarity (Captain review 2026-09-08).
// A tier-1 installer opening a job must see, in order: office instructions,
// the sent quote's writing (price-free) with an "Open quote" that fetches the
// backend extract, build spec, work order lines, materials with a PO PDF.
// The client number is callable for allocated crew. Nothing here shows money.
const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

const SUPABASE_ORIGIN = 'https://kevgrhcjxspbxgovpmfl.supabase.co';
const OPS_API = `${SUPABASE_ORIGIN}/functions/v1/ops-api`;
const PLANS_PDF = `${SUPABASE_ORIGIN}/storage/v1/object/sign/docs/e2e-plans.pdf?token=e2e`;
const QUOTE_PDF = `${SUPABASE_ORIGIN}/storage/v1/object/sign/docs/e2e-quote.pdf?token=e2e`;
const PX = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

function detail(overrides) {
  return Object.assign({
    access_tier: 'allocated',
    quote_visible: false,
    job: {
      id: 'e2e-job-1', job_number: 'E2E-JOB-001', type: 'patio', status: 'scheduled',
      client_name: 'Fixture Homeowner', client_phone: '0400333444',
      site_address: '30 Fixture Road', site_suburb: 'Joondalup',
      scope_json: {
        config: { length: 7, projection: 4.5, roofStyle: 'flat', roofing: 'insulated', posts: 3 },
        notes: { noteWorkOrder: 'Installer note fallback. Quote total $8,800.' },
      },
    },
    crew: [],
    purchaseOrders: [
      { id: 'po-ok', po_number: 'PO-2041', supplier_name: 'Stratco Malaga', status: 'authorised', delivery_date: '2026-09-08', line_items: [{ description: 'Insulated roof panel', quantity: 6 }] },
      { id: 'po-draft', po_number: 'PO-2042', supplier_name: 'Bunnings Trade', status: 'draft', line_items: [{ description: 'Rapid set', quantity: 12 }] },
    ],
    documents: [
      { id: 'd-plans', type: 'council_plans', file_name: 'BA-approval.pdf', pdf_url: PLANS_PDF, visible_to_trades: true },
      { id: 'd-quote', type: 'quote', file_name: 'quote.pdf', pdf_url: QUOTE_PDF, visible_to_trades: false },
    ],
    notes: [],
    media: [{ id: 'p1', type: 'photo', phase: 'scope', storage_url: PX }],
    quote_packs: [
      {
        quote_number: 'Q-7731', job_document_id: 'doc-q-7731', status: 'accepted', accepted: true,
        sent_at: '2026-08-28T02:00:00Z', source: 'frozen', summary: 'Flat insulated patio as drawn',
        notes: 'Client to clear the area. Deposit of $4,400 paid.',
        items: [
          { kind: 'patio_tube', description: 'Supply and install 7.0m x 4.5m flat insulated patio', quantity: 31.5, unit: 'm2', unit_price: 280, line_total: 8820 },
          { kind: 'note', description: 'Downpipe to existing stormwater.' },
        ],
      },
      { quote_number: 'Q-7702', status: 'superseded', sent_at: '2026-08-20T02:00:00Z', source: 'frozen', summary: 'Original 6m option', items: [{ kind: 'patio_tube', description: '6.0m option', quantity: 27, unit: 'm2' }] },
    ],
    quote_extracts: [{
      type: 'trade_quote_extract', label: 'Quote extract', action: 'trade_quote_extract',
      job_document_id: 'doc-q-7731', quote_number: 'Q-7731', status: 'accepted',
      sent_at: '2026-08-28T02:00:00Z', filename: 'E2E-JOB-001-Q-7731-trade-extract.html',
    }],
    workOrder: {
      id: 'wo-1', wo_number: 'WO-1188', estimated_hours: 16,
      special_instructions: 'Start 7am. Remove shade sail first. Labour budget $1,200.',
      scope_items: [{ description: 'Set out and dig 3 footings', quantity: 3, unit: 'ea', unit_price: 120, total: 360 }],
    },
  }, overrides || {});
}

const EXTRACT_HTML = '<!DOCTYPE html><html><body><h1>E2E-JOB-001 · Quote Q-7731</h1><p data-extract>Scope of works, no prices</p></body></html>';

async function stub(page, payload, seen) {
  await page.route(`${OPS_API}**`, async (route) => {
    const url = new URL(route.request().url());
    const action = url.searchParams.get('action');
    if (action === 'trade_job_detail') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
    }
    if (action === 'trade_quote_extract') {
      seen.push({ format: url.searchParams.get('format'), jobId: url.searchParams.get('jobId'), documentId: url.searchParams.get('document_id'), auth: route.request().headers().authorization || '' });
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: EXTRACT_HTML });
    }
    return route.fallback();
  });
}

async function openJob(page) {
  await signIn(page, PERSONAS.installer);
  await page.locator('[data-view="myJobs"]').click();
  await page.locator('#myJobsList .jc').filter({ hasText: 'E2E-JOB-001' }).click();
  await expect(page.locator('#viewJob')).toHaveClass(/active/);
}

test.describe('Trade job view — scope of works clarity', () => {
  test.use({ persona: 'installer' });

  test('Scope tab reads instructions → quote → spec → WO → materials, with no money', async ({ appPage: page }) => {
    const seen = [];
    await stub(page, detail(), seen);
    await openJob(page);
    await expect(page.locator('.jd-tab[data-tab="scope"]')).toHaveClass(/active/);
    const scope = page.locator('#jdTab_scope');

    // Order of the cards a trade reads top-down.
    const order = await scope.evaluate((el) => Array.from(el.querySelectorAll('[data-trade-instructions],[data-quote-packs],[data-build-spec],[data-scope-wo-items],[data-materials]')).map((n) => n.getAttribute('data-trade-instructions') != null ? 'instructions' : n.getAttribute('data-quote-packs') != null ? 'quote' : n.getAttribute('data-build-spec') != null ? 'spec' : n.getAttribute('data-scope-wo-items') != null ? 'wo' : 'materials'));
    expect(order).toEqual(['instructions', 'quote', 'spec', 'wo', 'materials']);

    // Instructions come from the work order (tier 1 has no Work tab).
    const instr = scope.locator('[data-trade-instructions]');
    await expect(instr).toContainText('Start 7am. Remove shade sail first.');
    await expect(instr).toContainText('16h');
    await expect(instr).not.toContainText('1,200');
    await expect(instr).not.toContainText('Installer note fallback');

    // Quote writing: accepted quote open, older one listed, quantities kept, money gone.
    const quote = scope.locator('[data-quote-packs]');
    await expect(quote).toContainText('Q-7731');
    await expect(quote).toContainText('Accepted');
    await expect(quote).toContainText('Supply and install 7.0m x 4.5m flat insulated patio');
    await expect(quote).toContainText('31.5 m2');
    await expect(quote).toContainText('Downpipe to existing stormwater');
    await expect(quote).toContainText('Client to clear the area');
    await expect(quote).toContainText('Q-7702');
    await expect(quote.locator('[data-quote-extract="Q-7731"]')).toBeVisible();
    await expect(quote.locator('[data-quote-extract="Q-7702"]')).toHaveCount(0);
    await expect(scope).not.toContainText('$');
    await expect(scope).not.toContainText('8820');
    await expect(scope).not.toContainText('4,400');
    await expect(scope).not.toContainText('360');
    await expect(scope.locator('h3', { hasText: /^Scope of Work$/ })).toHaveCount(0);
    await expect(scope.locator('[data-build-spec] h3')).toHaveText('Build spec');

    // Materials: PO PDF for the approved PO only, draft stays locked.
    await expect(scope.locator('[data-materials] [data-po-pdf="po-ok"]')).toBeVisible();
    await expect(scope.locator('[data-materials] [data-po-pdf="po-draft"]')).toHaveCount(0);
    await expect(scope.locator('[data-materials]')).toContainText('do not purchase');
    expect(await page.evaluate(() => typeof window.generatePOPdf)).toBe('function');
  });

  test('Open quote fetches the price-free extract with the trade token and shows it in-app', async ({ appPage: page }) => {
    const seen = [];
    await stub(page, detail(), seen);
    await openJob(page);
    await page.locator('#jdTab_scope [data-quote-extract="Q-7731"]').click();
    const overlay = page.locator('#quoteExtractOverlay');
    await expect(overlay).toBeVisible();
    await expect(overlay.locator('#quoteExtractTitle')).toHaveText('Quote Q-7731');
    const frame = page.frameLocator('#quoteExtractFrame');
    await expect(frame.locator('[data-extract]')).toHaveText('Scope of works, no prices');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ format: 'html', jobId: 'e2e-job-1', documentId: 'doc-q-7731' });
    expect(seen[0].auth).toMatch(/^Bearer /);
    await overlay.locator('button', { hasText: 'Back' }).click();
    await expect(overlay).toBeHidden();
    await expect(page.locator('#viewJob')).toHaveClass(/active/);
  });

  test('Files tab lists quotes and orders once, never the priced quote PDF', async ({ appPage: page }) => {
    const seen = [];
    await stub(page, detail(), seen);
    await openJob(page);
    await page.locator('.jd-tab[data-tab="files"]').click();
    const files = page.locator('#jdTab_files');
    const docs = files.locator('[data-quote-order-docs]');
    await expect(docs).toBeVisible();
    await expect(docs.locator('[data-quote-doc="Q-7731"] [data-quote-extract]')).toBeVisible();
    await expect(docs.locator('[data-quote-doc="Q-7702"]')).toContainText('No file yet');
    await expect(docs.locator('[data-po-doc="po-ok"] [data-po-pdf]')).toBeVisible();
    await expect(docs.locator('[data-po-doc="po-draft"]')).toContainText('Draft');
    await expect(files.locator('a[href="' + PLANS_PDF + '"]')).toHaveCount(1);
    await expect(files.locator('a[href="' + QUOTE_PDF + '"]')).toHaveCount(0);
    await expect(files).not.toContainText('quote.pdf');
    await expect(files).not.toContainText('$');
    await expect(files.locator('[data-quote-packs]')).toHaveCount(0);
    // No empty "Documents" heading when nothing has an openable URL.
    await expect(files.locator('h3', { hasText: /^Documents$/ })).toHaveCount(0);
  });

  test('Allocated installer can call the client; another crew’s job stays view-only', async ({ appPage: page }) => {
    const seen = [];
    await stub(page, detail(), seen);
    await openJob(page);
    await expect(page.locator('.jd-action-bar a.act-call[href="tel:0400333444"]')).toBeVisible();
    await expect(page.locator('#jobDetailContent [data-client-phone]')).toContainText('0400333444');
  });

  test('View-only job (other crew) hides the client number', async ({ appPage: page }) => {
    const seen = [];
    await stub(page, detail({
      crew: [{ id: 'a-other', user_id: 'someone-else', name: 'Other Crew', users: { id: 'someone-else', name: 'Other Crew' }, scheduled_date: '2026-09-09', status: 'scheduled' }],
    }), seen);
    await openJob(page);
    await expect(page.locator('#jobViewOnlyBanner')).toBeVisible();
    await expect(page.locator('.jd-action-bar a.act-call')).toHaveCount(0);
    await expect(page.locator('#jobDetailContent [data-client-phone]')).toHaveCount(0);
    // The scope still reads fully — view-only hides the number, not the work.
    await expect(page.locator('#jdTab_scope [data-quote-packs]')).toContainText('Q-7731');
  });
});
