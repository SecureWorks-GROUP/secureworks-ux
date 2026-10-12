// Guard for the Ops tab set (Captain 2026-10-06, `<ops-tab-set>` in ops.html):
//  - the nav is Jobs, Calendar, Financials, Dispatch, Sales, and a fresh open of
//    the plain address lands on Jobs (an address that names a tab opens that tab);
//  - Today, Inbox and Approvals are off the front end, and any old deep link or
//    saved tab pointing at them (or at Materials) lands on Jobs;
//  - Financials keeps Purchase Orders, Work Orders and Bill Reconciliation, with
//    Finance Health and Job P&L hidden, and Purchase Orders carries the Supplier
//    Price Updates queue that used to sit on Materials;
//  - Dispatch is the real Dispatch view of any job (slice 1: job list with search
//    and work type buttons, job header, Scope and notes with Save note), read
//    from ops-api and writing only add_note, with the live Purchase orders board
//    (the old Materials view) below it. See the `Dispatch:` tests.
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { installOpsSessionStub } = require('../helpers/ops-auth');

const OPS_FILE = 'file://' + path.resolve(__dirname, '..', '..', 'ops.html');

async function bootOps(page, { hash = '', savedTab = null, responses = {}, delays = {}, failures = {}, digest = {} } = {}) {
  const apiCalls = [];
  const requests = [];
  const bodies = Object.assign({ pipeline: { columns: {} } }, responses);
  await installOpsSessionStub(page);
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith('file://')) return route.continue();
    requests.push(url);
    if (/\/functions\/v1\/daily-digest/.test(url)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(digest) });
    }
    const match = url.match(/\/functions\/v1\/ops-api\?action=([a-z_]+)/);
    if (match) apiCalls.push(match[1]);
    const body = match && bodies[match[1]] ? bodies[match[1]] : {};
    if (match && delays[match[1]]) await new Promise((resolve) => setTimeout(resolve, delays[match[1]]));
    if (match && failures[match[1]]) {
      return route.fulfill({ status: failures[match[1]], contentType: 'application/json', body: JSON.stringify({ error: 'e2e failure' }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  if (savedTab) {
    // Seed once per tab session, so a later reload in the same test keeps
    // whatever the page itself saved.
    await page.addInitScript((tab) => {
      if (sessionStorage.getItem('e2e_seeded')) return;
      sessionStorage.setItem('e2e_seeded', '1');
      localStorage.setItem('sw_ops_tab', tab);
    }, savedTab);
  }
  await page.goto(OPS_FILE + (hash ? '#' + hash : ''));
  await expect(page.locator('#viewJobs')).toHaveClass(/active/);
  return { apiCalls, requests };
}

test('the nav is Jobs, Calendar, Financials, Dispatch, Sales and Ops opens on Jobs', async ({ page }) => {
  await bootOps(page);
  await expect(page.locator('.header-nav button')).toHaveText(['Jobs', 'Calendar', 'Financials', 'Dispatch', 'Sales']);
  const mobileOrder = await page.locator('.mobile-nav button').evaluateAll((els) => els.map((el) => el.dataset.view));
  expect(mobileOrder).toEqual(['jobs', 'calendar', 'financials', 'dispatch', 'sales']);
  await expect(page.locator('#viewJobs')).toHaveClass(/active/);
  for (const hidden of ['today', 'inbox', 'approvals', 'materials']) {
    await expect(page.locator(`[data-view="${hidden}"]`)).toHaveCount(0);
  }
  expect(await page.evaluate(() => localStorage.getItem('sw_ops_tab'))).toBe('jobs');
});

test('Ops opens on Jobs after Financials was the last tab used, and a hash link still opens its tab', async ({ page }) => {
  await bootOps(page);
  await page.locator('.header-nav button[data-view="financials"]').click();
  await expect(page.locator('#viewFinancials')).toHaveClass(/active/);
  expect(await page.evaluate(() => localStorage.getItem('sw_ops_tab'))).toBe('financials');

  // Leave the page first so the next open is a full load, as a new visit is.
  await page.goto('about:blank');
  await page.goto(OPS_FILE);
  await expect(page.locator('#viewJobs')).toHaveClass(/active/);
  expect(await page.locator('.view.active').evaluateAll((els) => els.map((el) => el.id))).toEqual(['viewJobs']);
  await expect(page.locator('.header-nav button.active')).toHaveText(['Jobs']);

  await page.locator('.header-nav button[data-view="financials"]').click();
  await expect(page.locator('#viewFinancials')).toHaveClass(/active/);
  await page.goto('about:blank');
  await page.goto(OPS_FILE + '#calendar');
  await expect(page.locator('#viewCalendar')).toHaveClass(/active/);
  expect(await page.locator('.view.active').evaluateAll((els) => els.map((el) => el.id))).toEqual(['viewCalendar']);
});

for (const hidden of ['today', 'inbox', 'approvals', 'materials']) {
  test(`an old #${hidden} link and a saved ${hidden} tab both land on Jobs`, async ({ page }) => {
    await bootOps(page, { hash: hidden, savedTab: 'calendar' });
    await expect(page.locator('#viewJobs')).toHaveClass(/active/);
    expect(await page.locator('.view.active').evaluateAll((els) => els.map((el) => el.id))).toEqual(['viewJobs']);
    expect(new URL(page.url()).hash).toBe('#jobs');

    await page.evaluate((tab) => { localStorage.setItem('sw_ops_tab', tab); }, hidden);
    await page.goto(OPS_FILE);
    await expect(page.locator('#viewJobs')).toHaveClass(/active/);
    expect(await page.evaluate(() => localStorage.getItem('sw_ops_tab'))).toBe('jobs');
  });
}

test('Financials keeps POs, Work Orders and Bill Reconciliation and hides Finance Health and Job P&L', async ({ page }) => {
  const { apiCalls } = await bootOps(page, {
    responses: {
      pending_prices: {
        pending_prices: [{ id: 'price-demo-1', supplier_name: 'Demo Supplier', item_description: 'Post 65x65', unit: 'ea', unit_price: 12.5 }],
      },
    },
  });
  await page.locator('.header-nav button[data-view="financials"]').click();
  const subTabs = page.locator('#viewFinancials .sub-tab');
  await expect(subTabs).toHaveText(['Invoices', 'Quotes', 'Purchase Orders', 'Work Orders', 'Bill Reconciliation', 'Trade Bills', 'Clear Debt']);
  await page.locator('#viewFinancials .sub-tab[data-sub="pos"]').click();
  await expect(page.locator('#subPos')).toHaveClass(/active/);
  // Supplier Price Updates lost its Materials home; it now lives here with its actions.
  const priceCard = page.locator('#subPos #pendingPricesPanel #price-price-demo-1');
  await expect(priceCard).toBeVisible();
  await expect(priceCard).toContainText('Demo Supplier');
  await expect(priceCard.getByRole('button', { name: 'Dismiss' })).toBeVisible();
  await priceCard.getByRole('button', { name: 'Confirm' }).click();
  await expect.poll(() => apiCalls.includes('confirm_price')).toBe(true);
  await expect(priceCard).toBeHidden();
  // Bill Reconciliation lost its Materials home; it now lives here and loads its queue.
  await page.locator('#viewFinancials .sub-tab[data-sub="billrecon"]').click();
  await expect(page.locator('#subBillrecon #matReconPanel')).toBeVisible();
  await expect.poll(() => apiCalls.includes('materials_recon_queue')).toBe(true);
});

// ── Dispatch, slice 1 (modules/ops-dispatch.js) ──────────────────────────────
// Stubbed jobs only: invented numbers, no real client. Dates are built from the
// current Perth year so the install wording never date-rots.
const PERTH_YEAR = new Date(Date.now() + 8 * 3600 * 1000).getUTCFullYear();
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dowOf = (y, m, d) => DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];

const D_ROW = (over) => Object.assign({
  client_name: 'Test Client', site_address: '1 Test Street', status: 'accepted', value: 0, value_inc_gst: false,
  description: null, next_scheduled_date: null, last_scheduled_date: null,
  council_status: null, council_step: null, council_required: false, po_count: 0,
}, over);

const D_JOBS = {
  f1: D_ROW({ id: 'job-f1', job_number: 'SWF-900101', type: 'fencing', site_suburb: 'Gwelup', value: 3047, value_inc_gst: true,
    description: '43.4m Monument Trimclad fence, 2 runs', next_scheduled_date: `${PERTH_YEAR}-10-20`, updated_at: '2026-10-12T05:00:00+00:00' }),
  p1: D_ROW({ id: 'job-p1', job_number: 'SWP-900201', type: 'patio', site_suburb: 'Yokine', status: 'order_materials', value: 16329.58, value_inc_gst: true,
    description: '7.7m × 4.2m skillion patio, solarspan75', last_scheduled_date: `${PERTH_YEAR - 1}-09-14`,
    council_status: 'in_progress', council_step: '1/7', council_required: true, updated_at: '2026-10-12T04:00:00+00:00' }),
  p2: D_ROW({ id: 'job-p2', job_number: 'SWP-900202', type: 'patio', site_suburb: 'High Wycombe', status: 'order_materials', value: 3850, value_inc_gst: false,
    updated_at: '2026-10-12T03:00:00+00:00' }),
  r1: D_ROW({ id: 'job-r1', job_number: 'SWF-900301', type: 'repair', site_suburb: null, status: 'complete', updated_at: '2026-10-12T02:00:00+00:00' }),
  // Same digits as f1 behind a different prefix: the collapsed strip must keep both whole.
  i1: D_ROW({ id: 'job-i1', job_number: 'SWI-900101', type: 'insurance', site_suburb: 'Morley', status: 'archived', value: 14580.5, value_inc_gst: true,
    updated_at: '2026-10-12T01:00:00+00:00' }),
  m1: D_ROW({ id: 'job-m1', job_number: 'SWMS-900901', type: 'makesafe', site_suburb: 'Dalyellup', updated_at: '2026-10-11T01:00:00+00:00' }),
};

// Columns arrive out of order on purpose: the screen sorts on updated_at.
const D_LIST = () => ({
  columns: { draft: [], quoted: [], accepted: [D_JOBS.f1], processing: [D_JOBS.p2, D_JOBS.p1], complete: [D_JOBS.i1, D_JOBS.r1] },
  total: 5,
});
const D_FOUND = (rows) => ({ columns: { accepted: rows }, total: rows.length });

const photo = (n, over) => Object.assign({ id: 'm' + n, phase: 'scope', type: 'photo', storage_url: `https://media.example.test/full-${n}.jpg`, thumbnail_url: `https://media.example.test/thumb-${n}.jpg`, label: n === 1 ? 'Front boundary' : '' }, over);
const FENCE_SCOPE = {
  job: {
    runs: [{ length: '21.7', sheetHeight: 1800, panels: [{}, {}, {}] }, { length: 21.7, retaining: true, panels: [{}] }],
    gates: [{ type: 'pedestrian', width: 900 }], sheetColour: 'Monument', profile: 'Trimclad',
    siteNotes: 'Narrow side access, small truck only', supplierNotes: 'Deliver to the rear lane', removal: { totalMetres: 12, notes: 'Old fence to the skip' },
  },
};
const PATIO_SCOPE = { config: { length: 7.7, projection: 4.2, roofStyle: 'skillion', roofing: 'solarspan75', sheetColor: 'Surfmist', post_count: 4 }, notes: { noteInternal: 'Check the fascia height', noteQuote: '' } };
const D_DETAIL = {
  'job-f1': {
    job: { id: 'job-f1', job_number: 'SWF-900101', type: 'fencing', scope_json: FENCE_SCOPE },
    media: [photo(1), photo(2), photo(3), photo(4), photo(5), photo(6), photo(7, { phase: 'receipt' }), photo(8, { type: 'video' }), photo(9, { phase: 'completion' })],
    documents: [
      { id: 'd1', type: 'quote', quote_number: 'Q-900101', version: 1, sent_to_client: true, sent_at: `${PERTH_YEAR}-09-01T02:00:00+00:00`, created_at: '2026-09-01T01:00:00+00:00', storage_url: 'https://docs.example.test/q-v1.pdf' },
      { id: 'd2', type: 'quote', quote_number: 'Q-900101', version: 2, sent_to_client: true, accepted_at: `${PERTH_YEAR}-10-03T02:00:00+00:00`, created_at: '2026-10-01T01:00:00+00:00', storage_url: 'https://docs.example.test/q-v2.pdf' },
      { id: 'd3', type: 'work_order', created_at: '2026-10-05T01:00:00+00:00', storage_url: 'https://docs.example.test/wo.pdf' },
    ],
  },
  'job-p1': { job: { id: 'job-p1', type: 'patio', scope_json: PATIO_SCOPE }, media: [photo(1, { phase: 'receipt' })], documents: [] },
  'job-p2': { job: { id: 'job-p2', type: 'patio', scope_json: null }, media: [], documents: [{ id: 'd9', type: 'quote', quote_number: 'Q-900202', version: 1, sent_to_client: true, sent_at: null, created_at: '2026-10-01T01:00:00+00:00', share_token: 'tok-e2e' }] },
  'job-r1': { job: { id: 'job-r1', type: 'repair', scope_json: { patios: [{ name: 'A' }] } }, media: [], documents: [] },
  'job-i1': { job: { id: 'job-i1', type: 'insurance', scope_json: {} }, media: [], documents: [] },
  'job-m1': { job: { id: 'job-m1', type: 'makesafe', scope_json: null }, media: [], documents: [] },
};
const D_NOTES = {
  'job-f1': { job_id: 'job-f1', total: 2, notes: [
    { id: 'n2', text: 'Gate goes on the left', author: 'Sam Office', user_id: 'u1', created_at: `${PERTH_YEAR}-10-10T05:16:00+00:00`, visibility: 'internal_only', from_ops: true },
    { id: 'n1', text: 'Neighbour shares the back run', author: null, user_id: null, created_at: `${PERTH_YEAR}-10-09T01:05:00+00:00`, visibility: null, from_ops: true },
  ] },
};

const D_MANY = () => Array.from({ length: 420 }, (_, i) => D_ROW({
  id: 'job-n' + i, job_number: 'SWF-' + (910000 + i), type: i % 3 ? 'fencing' : 'patio', site_suburb: 'Suburb ' + i,
  description: i % 2 ? 'A deliberately long one line description to wrap on a narrow phone screen ' + i : null,
  value: 1000 + i, value_inc_gst: true, updated_at: new Date(Date.UTC(2026, 9, 12) - i * 60000).toISOString(),
}));

// Boots Ops on the Dispatch tab against a stubbed ops-api. `api[action]` is a
// function (url, postBody) returning the JSON body, or { status, body }.
async function bootDispatch(page, api = {}, { viewport = null, open = true } = {}) {
  const calls = [];
  const handlers = Object.assign({
    pipeline: (url) => (url.searchParams.get('search') ? D_FOUND([]) : D_LIST()),
    job_detail: (url) => D_DETAIL[url.searchParams.get('jobId')] || { status: 404, body: { error: 'Job not found' } },
    job_notes: (url) => D_NOTES[url.searchParams.get('jobId')] || { job_id: url.searchParams.get('jobId'), total: 0, notes: [] },
    list_pos: () => ({ purchase_orders: [] }),
  }, api);
  if (viewport) await page.setViewportSize(viewport);
  await installOpsSessionStub(page);
  await page.route('**/*', async (route) => {
    const request = route.request();
    const raw = request.url();
    if (raw.startsWith('file://')) return route.continue();
    const url = new URL(raw);
    const action = /\/functions\/v1\/ops-api$/.test(url.pathname) ? url.searchParams.get('action') : null;
    if (!action) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    const postBody = request.method() === 'POST' ? JSON.parse(request.postData() || '{}') : null;
    calls.push({ action, method: request.method(), url, search: url.searchParams.get('search'), jobId: url.searchParams.get('jobId'), body: postBody });
    const out = handlers[action] ? await handlers[action](url, postBody) : {};
    const wrapped = out && typeof out === 'object' && typeof out.status === 'number' && 'body' in out;
    return route.fulfill({ status: wrapped ? out.status : 200, contentType: 'application/json', body: JSON.stringify(wrapped ? out.body : out) });
  });
  await page.goto(OPS_FILE + (open ? '#dispatch' : ''));
  if (open) await expect(page.locator('#viewDispatch')).toHaveClass(/active/);
  const of = (action) => calls.filter((c) => c.action === action);
  return { calls, of, root: page.locator('#dispatchRoot') };
}

test('Dispatch: the job list is real, complete, newest first and free of sample or concept wording', async ({ page }) => {
  const { root, of } = await bootDispatch(page);
  const cards = root.locator('.dpc-job');
  await expect(cards).toHaveCount(5);
  await expect(cards.locator('strong')).toHaveText(['SWF-900101 · Gwelup', 'SWP-900201 · Yokine', 'SWP-900202 · High Wycombe', 'SWF-900301', 'SWI-900101 · Morley']);
  // The count is the read's own total, and every list read asks for the paged Dispatch set.
  await expect(root.locator('[data-dpc-reset]')).toHaveText('All jobs 5');
  expect(of('pipeline').every((c) => c.url.searchParams.get('dispatch') === '1')).toBe(true);
  expect(of('pipeline').some((c) => c.url.searchParams.has('type'))).toBe(false);
  await expect(root.locator('[data-dpc-type]')).toHaveText(['All', 'Fencing', 'Patio', 'Decking', 'Repair']);

  const first = cards.nth(0);
  await expect(first.locator('.dpc-type')).toHaveText('Fencing');
  await expect(first).toContainText('43.4m Monument Trimclad fence, 2 runs');
  await expect(first).toContainText(`Install ${dowOf(PERTH_YEAR, 10, 20)} 20/10`);
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  // A null description prints no line and no placeholder: tag, title, install day only.
  await expect(cards.nth(2).locator(':scope > span')).toHaveCount(2);
  await expect(cards.nth(2)).toContainText('Not booked');
  await expect(cards.nth(1)).toContainText(`Last booked 14/9/${PERTH_YEAR - 1}`);
  await expect(cards.nth(4).locator('.dpc-type')).toHaveText('Insurance');
  await expect(root.locator('.dpc-foot')).toHaveText('All jobs: any job through the Dispatch lens, to check what was ordered and sent.');

  // Nothing says sample or concept, and nothing from the later slices is drawn.
  const tabText = await page.locator('#viewDispatch').innerText();
  expect(tabText).not.toMatch(/concept|sample|DEMO-|coming soon/i);
  expect(tabText).not.toMatch(/—/);
  for (const later of ['.dpc-banner', '.dpc-tape', '.dpc-next', '.dpc-stage', '.dpc-supcard', '.dpc-mail', '.dpc-deliv', '.dpc-context', '.dpc-float', '[data-dpc-mode]', '[data-dpc-send]', '[data-dpc-tab]']) {
    await expect(root.locator(later)).toHaveCount(0);
  }
  await expect(root.locator('.dpc-sec')).toHaveCount(1);
  await expect(root).not.toContainText(/items ready|To do|crew/i);
});

test('Dispatch: work type buttons filter in the browser and All jobs resets', async ({ page }) => {
  const { root, of } = await bootDispatch(page);
  const cards = root.locator('.dpc-job');
  await expect(cards).toHaveCount(5);
  const reads = of('pipeline').length;
  await root.locator('[data-dpc-type="fencing"]').click();
  await expect(cards.locator('strong')).toHaveText(['SWF-900101 · Gwelup']);
  await expect(root.locator('[data-dpc-reset]')).toHaveAttribute('aria-pressed', 'false');
  await root.locator('[data-dpc-type="patio"]').click();
  await expect(cards).toHaveCount(2);
  await root.locator('[data-dpc-type="repair"]').click();
  await expect(cards.locator('strong')).toHaveText(['SWF-900301']);
  await root.locator('[data-dpc-type="decking"]').click();
  await expect(cards).toHaveCount(0);
  await expect(root.locator('.dpc-job-list')).toHaveText('No decking jobs.');
  await expect(root.locator('.dpc-job-list [role="alert"]')).toHaveCount(0);
  // The count stays the All jobs count, and the open job stays open.
  await expect(root.locator('[data-dpc-reset]')).toHaveText('All jobs 5');
  await expect(root.locator('.dpc-jobhead h2')).toHaveText('SWF-900101 · Gwelup');
  await root.locator('[data-dpc-reset]').click();
  await expect(cards).toHaveCount(5);
  await expect(root.locator('[data-dpc-reset]')).toHaveAttribute('aria-pressed', 'true');
  // Filtering never went back to the server, and never as type=repair.
  expect(of('pipeline').length).toBe(reads);
  expect(of('pipeline').some((c) => c.url.searchParams.has('type'))).toBe(false);
});

test('Dispatch: make-safe is off the list until searched, and search states are honest', async ({ page }) => {
  let failSearch = false;
  const { root, of } = await bootDispatch(page, {
    pipeline: (url) => {
      const q = url.searchParams.get('search');
      if (!q) return D_LIST();
      if (failSearch) return { status: 500, body: { error: 'e2e failure' } };
      if (/^swms/i.test(q)) return D_FOUND([D_JOBS.m1]);
      if (/^gwel/i.test(q)) return D_FOUND([D_JOBS.f1]);
      return D_FOUND([]);
    },
  });
  const cards = root.locator('.dpc-job');
  await expect(cards).toHaveCount(5);
  await expect(root.locator('.dpc-job', { hasText: 'SWMS-900901' })).toHaveCount(0);
  await expect(root.locator('.dpc-type', { hasText: 'Make-safe' })).toHaveCount(0);

  const box = root.locator('[data-dpc-search]');
  await box.fill('SWMS-900901');
  await expect(cards.locator('strong')).toHaveText(['SWMS-900901 · Dalyellup']);
  await expect(box).toBeFocused();
  expect(of('pipeline').filter((c) => c.search === 'SWMS-900901').length).toBe(1);
  expect(of('pipeline').every((c) => c.url.searchParams.get('dispatch') === '1')).toBe(true);
  // The count on the button is still the All jobs count, not the search's.
  await expect(root.locator('[data-dpc-reset]')).toHaveText('All jobs 5');
  // A make-safe job opens through the same view.
  await cards.first().click();
  await expect(root.locator('.dpc-jobhead h2')).toHaveText('SWMS-900901 · Dalyellup');
  await expect(root.locator('.dpc-jobhead')).toContainText('No price on record');

  await box.fill('zzz no such job');
  await expect(root.locator('.dpc-job-list')).toHaveText('No jobs match.');
  // The type button narrows a search result too.
  await box.fill('Gwelup');
  await expect(cards).toHaveCount(1);
  await root.locator('[data-dpc-type="patio"]').click();
  await expect(root.locator('.dpc-job-list')).toHaveText('No jobs match.');
  await root.locator('[data-dpc-type="all"]').click();

  failSearch = true;
  await box.fill('a search that fails');
  await expect(root.locator('.dpc-job-list [role="alert"]')).toContainText('Search failed.');
  await expect(cards).toHaveCount(0);
  failSearch = false;
  await root.locator('.dpc-job-list [data-dpc-retry="search"]').click();
  await expect(root.locator('.dpc-job-list')).toHaveText('No jobs match.');

  await box.fill('');
  await expect(cards).toHaveCount(5);
  await expect(root.locator('.dpc-job', { hasText: 'SWMS-900901' })).toHaveCount(0);
  // The job reached by search stays open after the search is cleared.
  await expect(root.locator('.dpc-jobhead h2')).toHaveText('SWMS-900901 · Dalyellup');
});

test('Dispatch: the header prints the price, GST label, install day and work type by rule', async ({ page }) => {
  const { root } = await bootDispatch(page);
  const head = root.locator('.dpc-jobhead');
  const openJob = (number) => root.locator('.dpc-job', { hasText: number }).click();
  await expect(head.locator('h2')).toHaveText('SWF-900101 · Gwelup');
  await expect(head.locator('.dpc-price')).toHaveText('$3,047 inc GST');
  await expect(head.locator(':scope > p')).toHaveText('43.4m Monument Trimclad fence, 2 runs');
  await expect(head.locator('.dpc-pills > *')).toHaveText(['Fencing', `Install ${dowOf(PERTH_YEAR, 10, 20)} 20/10`]);

  await openJob('SWP-900201');
  await expect(head.locator('.dpc-price')).toHaveText('$16,330 inc GST'); // 16329.58, half up
  await expect(head.locator('.dpc-pills > *')).toHaveText(['Patio', `Last booked 14/9/${PERTH_YEAR - 1}`]);

  await openJob('SWP-900202'); // unlabelled fallback total: figure, no GST label, no description line
  await expect(head.locator('.dpc-price')).toHaveText('$3,850');
  await expect(head).not.toContainText('inc GST');
  await expect(head.locator(':scope > p')).toHaveCount(0);
  await expect(head.locator('.dpc-pills > *')).toHaveText(['Patio', 'Not booked']);

  await openJob('SWF-900301'); // no price, no suburb
  await expect(head.locator('h2')).toHaveText('SWF-900301');
  await expect(head.locator('.dpc-price')).toHaveCount(0);
  await expect(head).toContainText('No price on record');
  await expect(head).not.toContainText('$');

  await openJob('SWI-900101');
  await expect(head.locator('.dpc-price')).toHaveText('$14,581 inc GST'); // 14580.5, half up
  // No crew chip, no items ready, no stage rail.
  await expect(head.locator('.dpc-pills > *')).toHaveCount(2);
  await expect(head.locator('.dpc-tape')).toHaveCount(0);
});

test('Dispatch: Scope and notes shows the scope facts, scope photos, quote, scoper and council lines', async ({ page }) => {
  const { root } = await bootDispatch(page);
  const sec = root.locator('.dpc-sec');
  await expect(sec.locator('.dpc-eyebrow')).toHaveText('Before ordering');
  await expect(sec.locator('h3')).toHaveText('Scope and notes');
  await expect(sec.locator('.dpc-sec-head p')).toHaveText('From the scope tool, plus notes saved on the job');

  const facts = sec.locator('.dpc-facts > div');
  await expect(facts).toHaveText([
    'Total43.4m fence across 2 runs', 'Panels4', 'ColourMonument', 'ProfileTrimclad',
    'Run 121.7m, 1800mm high', 'Run 221.7m, 1800mm high, retaining', 'Gates (1)pedestrian (900mm)', 'Removal12m old fence',
  ]);
  // Every fact is one the Jobs tab's own scope summary prints for the same scope.
  const jobsSummary = await page.evaluate((scope) => {
    const holder = document.createElement('div');
    holder.innerHTML = renderScopeSummary(scope, 'fencing', 'job-f1');
    return holder.textContent;
  }, FENCE_SCOPE);
  for (const value of ['43.4m fence across 2 runs', '4 panels', 'Monument', 'Trimclad', '21.7m, 1800mm high', 'pedestrian (900mm)', '12m old fence']) {
    expect(jobsSummary).toContain(value);
  }

  // Six scope photos; the receipt, completion photo and scope video are not shown.
  const photos = sec.locator('.dpc-photo');
  await expect(photos).toHaveCount(6);
  await expect(photos.first().locator('span')).toHaveText('Front boundary');
  await expect(photos.nth(1).locator('span')).toHaveCount(0);
  await photos.nth(1).click();
  await expect(page.locator('.ops-lightbox img')).toHaveAttribute('src', 'https://media.example.test/full-2.jpg');
  await page.locator('.ops-lightbox').click();

  const lines = sec.locator('.dpc-scope-line');
  await expect(lines).toHaveText([
    'Signed quote: Q-900101 v2, accepted 3/10',
    'Scoper notes (site): Narrow side access, small truck only',
    'Scoper notes (removal): Old fence to the skip',
    'Scoper notes (supplier): Deliver to the rear lane',
  ]);
  await expect(lines.first().locator('a')).toHaveAttribute('href', 'https://docs.example.test/q-v2.pdf');
  await expect(lines.first().locator('a')).toHaveAttribute('target', '_blank');

  // Patio: patio picks, the patio tool's note, the council line, and the photo empty state.
  await root.locator('.dpc-job', { hasText: 'SWP-900201' }).click();
  await expect(facts).toHaveText(['Size7.7m × 4.2m (32.3m²)', 'Roof styleskillion', 'Roofingsolarspan75', 'Sheet colourSurfmist', 'Posts4 × 100x100 SHS']);
  await expect(sec).toContainText('No scope photos on this job.');
  await expect(photos).toHaveCount(0);
  await expect(lines).toHaveText(['Scoper notes (internal): Check the fascia height', 'Council: in progress, step 1/7']);

  // No scope, and a quote that was sent but never accepted is not called signed.
  await root.locator('.dpc-job', { hasText: 'SWP-900202' }).click();
  await expect(sec).toContainText('No scope saved on this job.');
  await expect(sec.locator('.dpc-facts')).toHaveCount(0);
  await expect(lines).toHaveText(['Quote sent: Q-900202 v1, sent']);
  await expect(lines.first().locator('a')).toHaveAttribute('href', /\/functions\/v1\/send-quote\/view\?token=tok-e2e$/);

  // A scope saved in a layout these picks do not read is not called "no scope".
  await root.locator('.dpc-job', { hasText: 'SWF-900301' }).click();
  await expect(sec).toContainText('A scope is saved on this job, but it holds none of the facts this view reads.');
  await expect(lines).toHaveCount(0);
});

test('Dispatch: one scope photo is drawn at its own size, and two photos share a row', async ({ page }) => {
  const { root } = await bootDispatch(page, {
    job_detail: (url) => {
      const id = url.searchParams.get('jobId');
      if (id === 'job-f1') return Object.assign({}, D_DETAIL[id], { media: [photo(1)] });
      if (id === 'job-p1') return Object.assign({}, D_DETAIL[id], { media: [photo(1), photo(2)] });
      return D_DETAIL[id];
    },
  });
  const photos = root.locator('.dpc-photo');
  await expect(photos).toHaveCount(1);
  const one = await photos.first().boundingBox();
  expect(one.width).toBeGreaterThan(100);
  expect(Math.abs(one.height - one.width * 0.75)).toBeLessThan(1);

  await root.locator('.dpc-job', { hasText: 'SWP-900201' }).click();
  await expect(photos).toHaveCount(2);
  const first = await photos.nth(0).boundingBox();
  const second = await photos.nth(1).boundingBox();
  expect(second.height).toBeGreaterThan(50);
  expect(Math.abs(first.height - second.height)).toBeLessThan(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await root.locator('.dpc-job', { hasText: 'SWF-900101' }).click();
  await expect(photos).toHaveCount(1);
  const phone = await photos.first().boundingBox();
  expect(phone.width).toBeGreaterThan(50);
  expect(Math.abs(phone.height - phone.width * 0.75)).toBeLessThan(1);
});

test('Dispatch: the fence tool note fields are one list, read by the Jobs tab and by Dispatch', async ({ page }) => {
  const scope = { job: {
    runs: [{ length: 10 }], siteNotes: 'Narrow side access\nSmall truck only', checklist: { finalNotes: 'Confirm the colour' },
    removal: { notes: 'Old fence to the skip' }, supplierNotes: 'Deliver to the rear lane',
  } };
  const { root } = await bootDispatch(page, {
    job_detail: (url) => Object.assign({}, D_DETAIL[url.searchParams.get('jobId')], { job: { id: 'job-f1', type: 'fencing', scope_json: scope } }),
  });
  const lines = root.locator('.dpc-scope-line', { hasText: 'Scoper notes' });
  await expect(lines).toHaveText([
    'Scoper notes (site): Narrow side access Small truck only',
    'Scoper notes (final): Confirm the colour',
    'Scoper notes (removal): Old fence to the skip',
    'Scoper notes (supplier): Deliver to the rear lane',
  ]);

  // The Jobs tab's notes block, exactly as it printed before the list was shared.
  const block = (label, text) => '<div style="margin-bottom:8px;"><div style="font-weight:600;color:var(--sw-dark);">' + label + '</div><div style="color:var(--sw-text);">' + text + '</div></div>';
  expect(await page.evaluate((s) => renderFenceScopingNotes(s), scope)).toBe(
    '<div class="fence-scoping-notes" style="font-size:12px;padding:6px 0;line-height:1.6;">' +
    block('Site notes', 'Narrow side access<br>Small truck only') + block('Final notes', 'Confirm the colour') +
    block('Removal notes', 'Old fence to the skip') + block('Supplier notes', 'Deliver to the rear lane') +
    '<div style="font-size:11px;color:var(--sw-text-sec);">from the scoping tool</div></div>');
  expect(await page.evaluate((s) => renderFenceScopingNotes(JSON.stringify(s)), scope)).toBe(await page.evaluate((s) => renderFenceScopingNotes(s), scope));
  expect(await page.evaluate(() => [renderFenceScopingNotes(null), renderFenceScopingNotes({}), renderFenceScopingNotes({ job: { siteNotes: '   ' } })])).toEqual(['', '', '']);

  // A field added to the one list shows on both screens.
  await page.evaluate(() => {
    const listed = window.fenceScopingNoteFields;
    window.fenceScopingNoteFields = (s) => listed(s).concat([{ key: 'access', label: 'Access notes', text: 'Gate code is at the office' }]);
  });
  expect(await page.evaluate((s) => renderFenceScopingNotes(s), scope)).toContain(block('Access notes', 'Gate code is at the office'));
  await root.locator('[data-dpc-toggle]').click();
  await root.locator('[data-dpc-toggle]').click();
  await expect(lines).toHaveCount(5);
  await expect(lines.last()).toHaveText('Scoper notes (access): Gate code is at the office');
});

test('Dispatch: saved notes show every note, an author only when there is one, and each state', async ({ page }) => {
  let notesDown = true;
  const { root, of } = await bootDispatch(page, {
    job_notes: (url) => {
      const id = url.searchParams.get('jobId');
      // What the deployed ops-api answers before the back end is updated.
      if (id === 'job-p2' && notesDown) return { status: 400, body: { error: 'Unknown action: job_notes' } };
      return D_NOTES[id] || { job_id: id, total: 0, notes: [] };
    },
  });
  const notes = root.locator('.dpc-note-saved');
  await expect(notes).toHaveCount(2);
  await expect(notes.nth(0)).toContainText('Gate goes on the left');
  await expect(notes.nth(0).locator('small')).toHaveText(`Sam Office, ${dowOf(PERTH_YEAR, 10, 10)} 10/10 1:16pm`);
  await expect(notes.nth(1)).toContainText('Neighbour shares the back run');
  // No author on record: the time only, and no placeholder name.
  await expect(notes.nth(1).locator('small')).toHaveText(`${dowOf(PERTH_YEAR, 10, 9)} 9/10 9:05am`);

  await root.locator('.dpc-job', { hasText: 'SWP-900201' }).click();
  await expect(root.locator('[data-dpc-region="notes"]')).toHaveText('No notes saved on this job yet.');

  await root.locator('.dpc-job', { hasText: 'SWP-900202' }).click();
  const failed = root.locator('[data-dpc-region="notes"] [role="alert"]');
  await expect(failed).toContainText('Could not load notes.');
  await expect(root.locator('[data-dpc-region="notes"]')).not.toContainText('No notes saved');
  // The scope and the note box still work when only the notes read failed.
  await expect(root.locator('.dpc-sec')).toContainText('No scope saved on this job.');
  await expect(root.locator('[data-dpc-note]')).toBeEnabled();
  notesDown = false;
  const before = of('job_detail').length;
  await failed.locator('[data-dpc-retry="notes"]').click();
  await expect(root.locator('[data-dpc-region="notes"]')).toHaveText('No notes saved on this job yet.');
  // Retrying the notes never re-reads job_detail, which writes on read.
  expect(of('job_detail').length).toBe(before);
});

test('Dispatch: Save note calls add_note once, internal only, then re-reads the notes', async ({ page }) => {
  const saved = [];
  let failSave = false;
  const { root, of } = await bootDispatch(page, {
    add_note: (url, body) => {
      if (failSave) return { status: 500, body: { error: 'e2e failure' } };
      saved.unshift({ id: 'n-new', text: body.text, author: 'Ops Tester', user_id: 'u9', created_at: `${PERTH_YEAR}-10-12T05:16:00+00:00`, visibility: body.visibility, from_ops: true });
      return { note: { id: 'n-new', created_at: `${PERTH_YEAR}-10-12T05:16:00+00:00`, detail_json: { text: body.text } }, visibility: 'internal_only', ghl_synced: false };
    },
    job_notes: (url) => {
      const id = url.searchParams.get('jobId');
      const base = (D_NOTES[id] && D_NOTES[id].notes) || [];
      const notes = id === 'job-f1' ? saved.concat(base) : base;
      return { job_id: id, total: notes.length, notes };
    },
  });
  const box = root.locator('[data-dpc-note]');
  const save = root.locator('[data-dpc-save]');
  await expect(root.locator('.dpc-note-saved')).toHaveCount(2);
  await expect(save).toHaveText('Save note');
  await expect(save).toBeDisabled();
  await box.fill('   ');
  await expect(save).toBeDisabled();

  // A failed save keeps the text and makes no second call of any kind.
  failSave = true;
  await box.fill('Call before delivery');
  await expect(save).toBeEnabled();
  const notesReads = of('job_notes').length;
  await save.click();
  await expect(root.locator('.dpc-note-msg')).toHaveText('Note not saved. Your text is still here.');
  await expect(box).toHaveValue('Call before delivery');
  await expect(save).toBeEnabled();
  expect(of('add_note').length).toBe(1);
  expect(of('job_notes').length).toBe(notesReads);
  await expect(root.locator('.dpc-note-saved')).toHaveCount(2);

  failSave = false;
  await save.click();
  await expect(root.locator('.dpc-note-saved')).toHaveCount(3);
  await expect(root.locator('.dpc-note-saved').first()).toContainText('Call before delivery');
  await expect(root.locator('.dpc-note-saved').first().locator('small')).toHaveText(`Ops Tester, ${dowOf(PERTH_YEAR, 10, 12)} 12/10 1:16pm`);
  await expect(box).toHaveValue('');
  await expect(save).toBeDisabled();
  await expect(root.locator('.dpc-note-msg')).toHaveText('Note saved.');
  // One press, one add_note, then one re-read of job_notes.
  expect(of('add_note').length).toBe(2);
  expect(of('job_notes').length).toBe(notesReads + 1);
  // Every add_note carries exactly the four fields, plus the operator stamp opsPost
  // puts on every Ops write. Never without visibility 'internal_only': a note sent
  // without it is copied to the customer's contact notes.
  for (const call of of('add_note')) {
    expect(call.method).toBe('POST');
    expect(call.body).toMatchObject({ job_id: 'job-f1', text: 'Call before delivery', visibility: 'internal_only', from_ops: true });
    expect(Object.keys(call.body).sort()).toEqual(['from_ops', 'job_id', 'operator_email', 'text', 'visibility']);
  }
});

test('Dispatch: a failed list read is an error, never an empty list, and Retry recovers', async ({ page }) => {
  let mode = 'down';
  const { root } = await bootDispatch(page, {
    pipeline: () => {
      if (mode === 'down') return { status: 500, body: { error: 'e2e failure' } };
      // An ops-api that does not know dispatch=1 yet: rows without the two new fields.
      if (mode === 'old') {
        const { description, value_inc_gst, ...oldRow } = D_JOBS.f1;
        return { columns: { accepted: [oldRow] }, total: 1 };
      }
      return D_LIST();
    },
  });
  const list = root.locator('.dpc-job-list');
  const expectFailed = async () => {
    await expect(list.locator('[role="alert"]')).toContainText('Could not load jobs.');
    await expect(root.locator('.dpc-job')).toHaveCount(0);
    await expect(root.locator('[data-dpc-reset]')).toHaveText('All jobs');
    await expect(root.locator('.dpc-jobhead')).toContainText('Could not load this job.');
    await expect(root.locator('.dpc-sec')).toHaveCount(0);
    await expect(list).not.toContainText(/No jobs|No .* jobs/);
  };
  await expectFailed();
  mode = 'old';
  await list.locator('[data-dpc-retry="list"]').click();
  await expectFailed();
  mode = 'up';
  await root.locator('.dpc-jobhead [data-dpc-retry="list"]').click();
  await expect(root.locator('.dpc-job')).toHaveCount(5);
  await expect(root.locator('[data-dpc-reset]')).toHaveText('All jobs 5');
  await expect(root.locator('.dpc-jobhead h2')).toHaveText('SWF-900101 · Gwelup');
});

test('Dispatch: an empty list, a degraded read and a failed job read each say so', async ({ page }) => {
  let list = () => ({ columns: { draft: [], quoted: [], accepted: [] }, total: 0 });
  let detailDown = true;
  const { root, of } = await bootDispatch(page, {
    pipeline: () => list(),
    job_detail: (url) => (detailDown ? { status: 500, body: { error: 'e2e failure' } } : D_DETAIL[url.searchParams.get('jobId')]),
  });
  await expect(root.locator('[data-dpc-reset]')).toHaveText('All jobs 0');
  await expect(root.locator('.dpc-job-list')).toHaveText('No jobs to show.');
  await expect(root.locator('.dpc-jobhead')).toHaveText('No job to show.');
  expect(of('job_detail').length).toBe(0);

  // Leaving and coming back re-reads the list.
  list = () => Object.assign(D_LIST(), { degraded: true, enrichment_errors: ['council'] });
  await page.locator('.header-nav button[data-view="jobs"]').click();
  await page.locator('.header-nav button[data-view="dispatch"]').click();
  await expect(root.locator('.dpc-job')).toHaveCount(5);
  await expect(root.locator('.dpc-job-list [role="alert"]')).toContainText('Some job details did not load.');

  // The job read failed: scope and photos each say so, the header (from the list) stays.
  const scope = root.locator('[data-dpc-region="scope"]');
  await expect(scope.locator('[role="alert"]')).toHaveText(['Could not load the scope. Retry', 'Could not load photos. Retry']);
  await expect(scope).not.toContainText(/No scope saved|No scope photos/);
  await expect(root.locator('.dpc-jobhead h2')).toHaveText('SWF-900101 · Gwelup');
  await expect(root.locator('.dpc-note-saved')).toHaveCount(2);
  detailDown = false;
  await scope.locator('[data-dpc-retry="detail"]').first().click();
  await expect(root.locator('.dpc-facts > div')).toHaveCount(8);
  await expect(root.locator('.dpc-photo')).toHaveCount(6);
});

test('Dispatch: reads only pipeline, job_detail and job_notes, and job_detail once per job open', async ({ page }) => {
  let notesDown = false;
  const { root, calls, of } = await bootDispatch(page, {
    job_notes: (url) => {
      const id = url.searchParams.get('jobId');
      if (notesDown) return { status: 500, body: { error: 'e2e failure' } };
      return D_NOTES[id] || { job_id: id, total: 0, notes: [] };
    },
    add_note: (url, body) => ({ note: { id: 'n-new', created_at: `${PERTH_YEAR}-10-12T05:16:00+00:00`, detail_json: { text: body.text } }, visibility: 'internal_only', ghl_synced: false }),
  });
  await expect(root.locator('.dpc-photo')).toHaveCount(6);
  await page.waitForLoadState('networkidle');
  const dispatchCalls = () => calls.filter((c) => ['pipeline', 'job_detail', 'job_notes', 'add_note'].includes(c.action));
  expect(of('job_detail').map((c) => c.jobId)).toEqual(['job-f1']);
  expect(of('job_notes').map((c) => c.jobId)).toEqual(['job-f1']);

  // Pressing the open job again, filtering, collapsing and toggling read nothing.
  const before = dispatchCalls().length;
  await root.locator('.dpc-job', { hasText: 'SWF-900101' }).click();
  await root.locator('[data-dpc-type="fencing"]').click();
  await root.locator('[data-dpc-type="all"]').click();
  await root.locator('[data-dpc-toggle]').click();
  await root.locator('[data-dpc-toggle]').click();
  await root.locator('[data-dpc-side]').click();
  await root.locator('[data-dpc-side]').click();
  await expect(root.locator('.dpc-job')).toHaveCount(5);
  expect(dispatchCalls().length).toBe(before);

  await root.locator('.dpc-job', { hasText: 'SWP-900201' }).click();
  await expect(root.locator('.dpc-jobhead h2')).toHaveText('SWP-900201 · Yokine');
  await expect(root.locator('.dpc-facts > div')).toHaveCount(5);
  expect(of('job_detail').map((c) => c.jobId)).toEqual(['job-f1', 'job-p1']);
  // Nothing was written.
  expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);

  // Search, a retry and Save note: every ops-api call they make is one of the four.
  await page.waitForLoadState('networkidle');
  const mark = calls.length;
  await root.locator('[data-dpc-search]').fill('Gwelup');
  await expect(root.locator('.dpc-job-list')).toHaveText('No jobs match.');
  await root.locator('[data-dpc-search]').fill('');
  await expect(root.locator('.dpc-job')).toHaveCount(5);
  notesDown = true;
  await root.locator('.dpc-job', { hasText: 'SWP-900202' }).click();
  await expect(root.locator('[data-dpc-region="notes"] [role="alert"]')).toContainText('Could not load notes.');
  notesDown = false;
  await root.locator('[data-dpc-retry="notes"]').click();
  await expect(root.locator('[data-dpc-region="notes"]')).toHaveText('No notes saved on this job yet.');
  await root.locator('[data-dpc-note]').fill('Call before delivery');
  await root.locator('[data-dpc-save]').click();
  await expect(root.locator('.dpc-note-msg')).toHaveText('Note saved.');
  // The failed read, its retry, and the re-read after the save.
  await expect.poll(() => calls.slice(mark).filter((c) => c.action === 'job_notes').length).toBe(3);
  const since = calls.slice(mark);
  expect([...new Set(since.map((c) => c.action))].sort()).toEqual(['add_note', 'job_detail', 'job_notes', 'pipeline']);
  expect(since.filter((c) => c.method !== 'GET').map((c) => c.action)).toEqual(['add_note']);
  expect(of('job_detail').map((c) => c.jobId)).toEqual(['job-f1', 'job-p1', 'job-p2']);
});

test('Dispatch: typing in the search box is not interrupted when the first list read lands', async ({ page }) => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const { root, of } = await bootDispatch(page, {
    pipeline: async (url) => {
      const q = url.searchParams.get('search');
      if (q) return D_FOUND(/^gwelup$/i.test(q) ? [D_JOBS.f1] : []);
      await held;
      return D_LIST();
    },
  });
  const box = root.locator('[data-dpc-search]');
  await box.click();
  await page.keyboard.type('Gwel');
  await box.evaluate((el) => { el.dataset.e2eKept = '1'; });
  release();
  await expect(root.locator('[data-dpc-reset]')).toHaveText('All jobs 5');
  await expect(root.locator('.dpc-jobhead h2')).toHaveText('SWF-900101 · Gwelup');
  // Still the same box, still holding the keyboard: the rest of the word lands in it.
  await expect(box).toBeFocused();
  await expect(box).toHaveAttribute('data-e2e-kept', '1');
  await page.keyboard.type('up');
  await expect(box).toHaveValue('Gwelup');
  await expect(root.locator('.dpc-job strong')).toHaveText(['SWF-900101 · Gwelup']);
  expect(of('pipeline').some((c) => c.search === 'Gwelup')).toBe(true);
});

test('Dispatch: coming back to the tab keeps the note being typed, the list place and the photos', async ({ page }) => {
  const many = D_MANY();
  let held = null;
  let price = 1000;
  const { root, of } = await bootDispatch(page, {
    pipeline: async () => {
      if (held) await held;
      return { columns: { accepted: many.map((row, i) => (i === 0 ? Object.assign({}, row, { value: price }) : row)) }, total: many.length };
    },
    job_detail: () => D_DETAIL['job-f1'],
  });
  await expect(root.locator('.dpc-job')).toHaveCount(420);
  await expect(root.locator('.dpc-price')).toHaveText('$1,000 inc GST');
  await expect(root.locator('.dpc-photo')).toHaveCount(6);

  // Leave and come back while the re-read is still in flight.
  let release;
  held = new Promise((resolve) => { release = resolve; });
  price = 1250;
  await page.locator('.header-nav button[data-view="jobs"]').click();
  await page.locator('.header-nav button[data-view="dispatch"]').click();
  const list = root.locator('.dpc-job-list');
  await list.evaluate((el) => { el.scrollTop = 4000; });
  const place = await list.evaluate((el) => el.scrollTop);
  expect(place).toBeGreaterThan(1000);
  const note = root.locator('[data-dpc-note]');
  await note.click();
  await page.keyboard.type('Call before');
  await note.evaluate((el) => { el.dataset.e2eKept = '1'; });
  await root.locator('.dpc-photo').first().evaluate((el) => { el.dataset.e2eKept = '1'; });
  release();
  // The header took the new read; the note box, the photos and the list place did not move.
  await expect(root.locator('.dpc-price')).toHaveText('$1,250 inc GST');
  await expect(note).toBeFocused();
  await expect(note).toHaveAttribute('data-e2e-kept', '1');
  await page.keyboard.type(' delivery');
  await expect(note).toHaveValue('Call before delivery');
  await expect(root.locator('[data-dpc-save]')).toBeEnabled();
  await expect(root.locator('.dpc-photo').first()).toHaveAttribute('data-e2e-kept', '1');
  await expect(root.locator('.dpc-job')).toHaveCount(420);
  expect(await list.evaluate((el) => el.scrollTop)).toBe(place);
  expect(of('job_detail').length).toBe(1);
});

test('Dispatch: the sidebar collapses to a strip and the section folds, and both are remembered', async ({ page }) => {
  const { root } = await bootDispatch(page);
  await expect(root.locator('.dpc-job')).toHaveCount(5);
  await root.locator('.dpc-job', { hasText: 'SWP-900201' }).click();
  await expect(root.locator('.dpc-facts > div')).toHaveCount(5);

  await root.getByRole('button', { name: 'Collapse accepted work' }).click();
  await expect(root.locator('.dpc-layout')).toHaveClass(/dpc-left-closed/);
  const sidebarWidth = async () => Math.round((await root.locator('.dpc-queue').boundingBox()).width);
  await expect.poll(sidebarWidth).toBe(64);
  await expect(root.locator('.dpc-rail-count')).toHaveText('5');
  const strip = root.locator('.dpc-rail-job');
  // Prefix letters dropped, except where two listed jobs would read the same.
  await expect(strip).toHaveText(['SWF-900101', '900201', '900202', '900301', 'SWI-900101']);
  await expect(strip.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await strip.nth(2).click();
  await expect(root.locator('.dpc-jobhead h2')).toHaveText('SWP-900202 · High Wycombe');

  await root.locator('[data-dpc-toggle]').click();
  await expect(root.locator('.dpc-sec')).toHaveClass(/dpc-collapsed/);
  await expect(root.locator('.dpc-sec-body')).toHaveCount(0);
  await expect(root.locator('.dpc-sec-head p')).toHaveCount(0);
  await expect(root.locator('.dpc-sec h3')).toHaveText('Scope and notes');
  await expect(root.locator('[data-dpc-toggle]')).toHaveAttribute('aria-expanded', 'false');

  // A reload keeps the strip, the folded section and the open job.
  await page.reload();
  await expect(page.locator('#viewDispatch')).toHaveClass(/active/);
  await expect(root.locator('.dpc-layout')).toHaveClass(/dpc-left-closed/);
  await expect(root.locator('.dpc-rail-job[aria-pressed="true"]')).toHaveText('900202');
  await expect(root.locator('.dpc-jobhead h2')).toHaveText('SWP-900202 · High Wycombe');
  await expect(root.locator('.dpc-sec')).toHaveClass(/dpc-collapsed/);

  await root.getByRole('button', { name: 'Open accepted work' }).click();
  await expect.poll(sidebarWidth).toBe(264);
  await expect(root.locator('.dpc-job[aria-pressed="true"] strong')).toHaveText('SWP-900202 · High Wycombe');
  await root.locator('[data-dpc-toggle]').click();
  await expect(root.locator('.dpc-sec-body')).toHaveCount(1);
});

test('Dispatch: a long list is drawn whole, and the phone layout has no sideways scroll', async ({ page }) => {
  const many = D_MANY();
  const { root } = await bootDispatch(page, {
    pipeline: () => ({ columns: { accepted: many }, total: many.length }),
    job_detail: () => D_DETAIL['job-f1'],
  }, { viewport: { width: 390, height: 844 } });
  await expect(root.locator('[data-dpc-reset]')).toHaveText('All jobs 420');
  await expect(root.locator('.dpc-job')).toHaveCount(420);
  await expect(root.locator('.dpc-job').last().locator('strong')).toHaveText('SWF-910419 · Suburb 419');
  await expect(root.locator('.dpc-photo')).toHaveCount(6);
  // One column, sidebar first, and nothing in the Dispatch view runs past the screen edge.
  const measure = () => page.evaluate(() => {
    const view = document.querySelector('#dispatchRoot');
    const width = document.documentElement.clientWidth;
    const past = [view].concat(Array.from(view.querySelectorAll('*'))).filter((el) => {
      const box = el.getBoundingClientRect();
      return box.width > 0 && (box.right > width + 0.5 || box.left < -0.5);
    }).map((el) => el.className || el.tagName);
    const queue = view.querySelector('.dpc-queue').getBoundingClientRect();
    const work = view.querySelector('.dpc-workspace').getBoundingClientRect();
    const facts = view.querySelector('.dpc-facts');
    return { past, queueBottom: queue.bottom, workTop: work.top, facts: facts ? getComputedStyle(facts).gridTemplateColumns.split(' ').length : 0 };
  });
  const open = await measure();
  expect(open.past).toEqual([]);
  expect(open.workTop).toBeGreaterThanOrEqual(open.queueBottom);
  expect(open.facts).toBe(2);
  await root.locator('[data-dpc-side]').click();
  await expect(root.locator('.dpc-rail-job')).toHaveCount(420);
  const closed = await measure();
  expect(closed.past).toEqual([]);
});

test('Dispatch carries the live Purchase orders board below the Dispatch view', async ({ page }) => {
  const { apiCalls } = await bootOps(page, {
    responses: {
      list_pos: {
        purchase_orders: [
          { id: 'po-e2e-1', po_number: 'PO-E2E-0001', supplier_name: 'Demo Supplier', status: 'draft', total: 120, job_number: 'SWF-E2E-1', client_name: 'Test Client', job_type: 'fencing' },
        ],
      },
    },
  });
  await page.locator('.header-nav button[data-view="dispatch"]').click();
  const section = page.locator('#viewDispatch #dispatchPurchaseOrders');
  await expect(section.locator('.section-heading')).toContainText('Purchase orders');
  await expect(section).toContainText('Live purchase orders');
  await expect(section.getByRole('button', { name: '+ New PO' })).toBeVisible();
  const card = section.locator('#materialsKanban .kanban-card', { hasText: 'Demo Supplier' });
  await expect(card).toBeVisible();
  await expect(card.locator('button[title="Delete PO"]')).toBeVisible();
  expect(apiCalls).toContain('list_pos');
  const below = await page.evaluate(() => {
    const view = document.getElementById('dispatchRoot');
    const board = document.getElementById('dispatchPurchaseOrders');
    return Boolean(view.compareDocumentPosition(board) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(below).toBe(true);
});

test('the Jarvis bar counts purchase orders as soon as a slow list arrives on Dispatch', async ({ page }) => {
  await bootOps(page, {
    responses: {
      list_pos: {
        purchase_orders: [
          { id: 'po-e2e-1', po_number: 'PO-E2E-0001', supplier_name: 'Demo Supplier', status: 'draft', total: 120, job_number: 'SWF-E2E-1', client_name: 'Test Client', job_type: 'fencing' },
        ],
      },
    },
    // Longer than the 500ms repaint showView schedules, so only the list's
    // own arrival can correct the bar before the 30 second tick.
    delays: { list_pos: 3000 },
  });
  await page.locator('.header-nav button[data-view="dispatch"]').click();
  // While the list is still in flight the bar must not claim there are none.
  await expect(page.locator('#jarvisSummary')).toHaveText('Purchase orders loading...');
  await expect(page.locator('#viewDispatch #materialsKanban .kanban-card', { hasText: 'Demo Supplier' })).toBeVisible();
  await expect(page.locator('#jarvisSummary')).toHaveText('1 purchase orders tracked');
});

test('the Jarvis bar never says "No purchase orders" on Dispatch when the list failed to load', async ({ page }) => {
  await bootOps(page, { failures: { list_pos: 500 } });
  await page.locator('.header-nav button[data-view="dispatch"]').click();
  await expect(page.locator('#toastContainer .toast', { hasText: 'Failed to load purchase orders' })).toBeVisible();
  await expect(page.locator('#jarvisSummary')).toHaveText('Purchase orders loading...');
  // Past the repaint showView schedules, the failed read still is not an empty one.
  await page.waitForTimeout(700);
  await expect(page.locator('#jarvisSummary')).toHaveText('Purchase orders loading...');
});

test('the Jarvis bar alert badges fill in when Ops opens on Jobs', async ({ page }) => {
  await bootOps(page, {
    digest: {
      alerts: [
        { severity: 'red', title: 'Deposit overdue', description: 'Sample alert' },
        { severity: 'amber', title: 'Materials not ordered', description: 'Sample alert' },
        { severity: 'amber', title: 'Crew not confirmed', description: 'Sample alert' },
      ],
    },
  });
  await expect(page.locator('#viewJobs')).toHaveClass(/active/);
  const badges = page.locator('#jarvisBadges .jarvis-badge');
  await expect(badges).toHaveText(['1 urgent', '2 warnings']);
  await page.locator('.header-nav button[data-view="calendar"]').click();
  await expect(page.locator('#viewCalendar')).toHaveClass(/active/);
  await expect(badges).toHaveText(['1 urgent', '2 warnings']);
});

test('the Jarvis bar alert badges pick up a new alert without a reload', async ({ page }) => {
  const digest = { alerts: [] };
  await page.clock.install();
  await bootOps(page, { digest });
  const badges = page.locator('#jarvisBadges .jarvis-badge');
  await expect(badges).toHaveText(['All clear']);

  digest.alerts = [{ severity: 'red', title: 'Deposit overdue', description: 'Sample alert' }];
  // Past the digest's 30 minute cache, so the next 5 minute refresh tick refetches.
  await page.clock.fastForward('35:00');
  await expect(badges).toHaveText(['1 urgent']);
});
