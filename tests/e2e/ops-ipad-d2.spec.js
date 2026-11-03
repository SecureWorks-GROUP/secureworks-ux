// Finish-line row D2 (3 Nov 2026): the Ops screen works on an iPad and on a poor line.
// The live check of 3 Nov 05:05Z (context-system verify/evidence/20261103-ipad-slow-line)
// found these, and each test below proves one fix on Playwright's own WebKit with the
// "iPad (gen 7)" profile (810 x 1080 portrait, touch, real touch taps):
//  1. Portrait: no page is wider than the iPad (Jobs board, Financials, Job Profit, with
//     the Debt and Matching tabs shown), at 810 and 768 wide, and taps land on what they show.
//  2. Quick view: receipt and job photos are small thumbnails (Supabase image transform,
//     width 160, loading lazy); the full photo loads only on a tap.
//  3. Quick view margin: the same margin as Job Profit for the job, read from Job Profit's
//     own read (ops-api job_profit), or Withheld with Job Profit's reason; never a figure
//     from partial cost.
//  4. No system words on screen (codes, field names, table names).
//  5. Touch targets at least 44 px: work order Approve, Query and Reject (spaced apart),
//     Open Record, Open job, Close, Load next 100, Show N lines, the job card tabs and the
//     board card icons; the card icons also name themselves without a mouse.
//  6. A server failure reads in plain words ("The server took too long. Try again.") and
//     keeps the Try again button.
// Offline: every ops-api read is answered in the page or by a route here. No live read, no
// write. D2_SHOTS=<dir> saves screenshots (D2_SHOTS_TAG names them, e.g. before or after).
const fs = require('node:fs');
const path = require('node:path');
const { test, expect, devices } = require('@playwright/test');
const { webkit } = require('playwright');
const { revealOpsStaticFixture } = require('../helpers/ops-auth');

test.use({ ...devices['iPad (gen 7)'], locale: 'en-AU', timezoneId: 'Australia/Perth' });
test.skip(!fs.existsSync(webkit.executablePath()), 'WebKit is not installed here: npx playwright install webkit');

const SHOTS = process.env.D2_SHOTS || '';
const TAG = process.env.D2_SHOTS_TAG || 'run';
async function shot(page, name, locator) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  const file = path.join(SHOTS, TAG + '-' + name + '.png');
  if (locator) await locator.screenshot({ path: file });
  else await page.screenshot({ path: file });
}

const STORAGE = 'https://kevgrhcjxspbxgovpmfl.supabase.co/storage/v1';
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

// Every request that leaves this page's own server is answered here: images record their
// address, everything else is empty. Nothing reaches a live system.
async function offline(page) {
  const images = [];
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => {
    const url = route.request().url();
    if (url.startsWith(STORAGE)) images.push(url);
    if (/\/broken-/.test(url)) return route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"no transform"}' });
    if (url.startsWith(STORAGE) || /\.(jpe?g|png)(\?|$)/.test(url)) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX });
    }
    return route.fulfill({ status: 200, body: '' });
  });
  return images;
}

// The page with its own code, answers in place of ops-api, and an office-staff login that
// may see Job Profit. Debt and Matching show, so the header carries all seven tabs.
async function boot(page, answers, opts) {
  const images = await offline(page);
  await page.goto((opts && opts.url) || '/ops.html');
  await revealOpsStaticFixture(page);
  await page.evaluate(({ answers, jobProfit, realFetch }) => {
    const main = document.getElementById('mainApp');
    if (main) main.style.display = '';
    window.__d2 = { calls: [], answers };
    window.opsAuthHeaders = async (extra) => Object.assign({ Authorization: 'Bearer e2e-ops-token' }, extra || {});
    if (!realFetch) window.opsFetch = async (action, params) => {
      window.__d2.calls.push({ action, params: params || {} });
      const a = window.__d2.answers[action];
      if (a && a.reject) throw Object.assign(new Error(a.reject.message), { status: a.reject.status });
      if (a && a.wait) await new Promise((r) => setTimeout(r, a.wait));
      return JSON.parse(JSON.stringify(a && a.body !== undefined ? a.body : (a || {})));
    };
    window.opsPost = async (action, body) => { window.__d2.calls.push({ action, body, post: true }); return {}; };
    _opsUserEmail = 'office-e2e@example.test';
    _crewList = [{ id: 'u-office', name: 'Office Tester', email: 'office-e2e@example.test', role: jobProfit === false ? 'trade' : 'ops_manager' }];
    document.querySelectorAll('[data-debt-nav], [data-recon-nav]').forEach((b) => { b.style.display = ''; });
    if (typeof syncJobProfitTabVisibility === 'function') syncJobProfitTabVisibility();
  }, { answers, jobProfit: opts && opts.jobProfit, realFetch: !!(opts && opts.realFetch) });
  return images;
}

// ── Fixtures (made-up people) ──
const JOB_F = '00000000-0000-4000-8000-00000000f099';
const JOB_P = '00000000-0000-4000-8000-00000000f247';
function card(id, n, status, over) {
  return Object.assign({ id, job_number: n, client_name: 'Fixture Client ' + n.slice(-3), site_suburb: 'Bayswater', type: 'fencing', status,
    ghl_contact_id: 'ghl-' + n, ghl_opportunity_id: 'opp-' + n, days_in_stage: 3, ops_notes_count: 1, comms_notes_count: 2, assignment_count: 1, po_count: 1 }, over || {});
}
const PIPELINE = { columns: {
  accepted: [card('j1', 'SWF-261099', 'accepted'), card('j2', 'SWF-261100', 'accepted')],
  order_materials: [card('j3', 'SWF-261101', 'order_materials')],
  schedule_install: [card('j4', 'SWF-261102', 'schedule_install')],
  scheduled: [card('j5', 'SWF-261103', 'scheduled', { next_scheduled_date: '2026-11-05' })],
  in_progress: [card('j6', 'SWF-261104', 'in_progress')],
} };
function profitRow(over) {
  return Object.assign({ job_id: JOB_F, job_number: 'SWF-261099', client_name: 'Fixture Client 099', work_type: 'fencing', status: 'complete',
    created_at: '2026-09-01T00:00:00Z', quoted_ex: 12500, quoted_source: 'sent_quote:accepted:quote_revision', expected_source: 'accepted_quote_revision',
    expected_cost_ex: 8000, expected_labour_ex: 3000, expected_materials_ex: 5000, expected_commission_ex: 0,
    actual_cost_ex: 8458.97, actual_labour_ex: 307.40, actual_materials_ex: 8151.57, actual_commission_ex: 0, actual_other_ex: 0,
    invoiced_ex: 12680, collected_ex: 12680, invoice_count: 3, revenue_verified_paid: true,
    profit_ex: 4221.03, margin_pct: 33.29, committed_open_ex: 0, completeness: [], revenue_flag: 'ok', cost_flag: 'ok' }, over || {});
}
const PROFIT_P = profitRow({ job_id: JOB_P, job_number: 'SWP-261247', work_type: 'patio', status: 'in_progress',
  profit_ex: 33671.89, margin_pct: 48.2, cost_flag: 'xero_project_exceeds_line_costs', completeness: ['xero_project_exceeds_line_costs'],
  xero_project_expenses_ex: 15778.28 });
const MAKESAFE_ROWS = [
  profitRow({ job_id: 'ms1', job_number: 'SWMS-261647', work_type: 'makesafe', work_subtype: 'general_makesafe', status: 'archived' }),
  profitRow({ job_id: 'ms2', job_number: 'SWMS-261648', work_type: 'makesafe', work_subtype: 'temp_fence_makesafe', status: 'archived' }),
  profitRow({ job_id: 'ms3', job_number: 'SWMS-261649', work_type: 'makesafe', work_subtype: 'roof_report', status: 'archived' }),
];
function profitList(rows, more) {
  return { jobs: rows, has_more: !!more, limit: 100, offset: 0, labels: {} };
}
function profitDetail(job, over) {
  return Object.assign({ job, trades: [], cost_events: [], revenue_events: [], timeline: [], labels: {} }, over || {});
}
const RECEIPTS = Array.from({ length: 32 }, (_, i) => ({
  id: 'm' + i, phase: 'receipt', po_id: null, label: null, thumbnail_url: null,
  storage_url: STORAGE + '/object/public/job-photos/' + JOB_P + '/receipt/r-' + String(i + 1).padStart(2, '0') + (i % 3 ? '.jpg' : '.png'),
}));
function jobDetail(id, n, over) {
  return Object.assign({
    job: { id, job_number: n, client_name: 'Fixture Client ' + n.slice(-3), site_suburb: 'Bayswater', type: n.startsWith('SWP') ? 'patio' : 'fencing',
      status: 'in_progress', site_address: '1 Fixture St', pricing_json: { totalIncGST: 13750 }, ghl_opportunity_id: 'opp-1' },
    assignments: [], purchase_orders: [{ id: 'po1', po_number: 'PO-1', supplier_name: 'Fixture Supplies', status: 'draft', total: 0 }],
    work_orders: [], invoices: [{ invoice_type: 'ACCREC', status: 'PAID', total: 13948, amount_paid: 13948 }], media: [], events: [
      { event_type: 'status_changed', detail_json: { new_status: 'schedule_install' }, created_at: '2026-10-01T02:00:00Z' },
      { event_type: 'status_changed', detail_json: { new_status: 'in_progress' }, created_at: '2026-10-08T02:00:00Z' },
    ],
  }, over || {});
}

// The page as the live check measured it: the document and the body, against the screen.
async function overflow(page) {
  return page.evaluate(() => ({
    inner: window.innerWidth,
    doc: document.scrollingElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
}

test.describe('1. Portrait: no page is wider than the iPad', () => {
  const answers = {
    pipeline: PIPELINE,
    list_invoices: { invoices: [] },
    job_profit_list: profitList([profitRow(), PROFIT_P].concat(MAKESAFE_ROWS), true),
  };
  for (const width of [810, 768]) {
    test(`${width} wide: Jobs board, Financials and Job Profit fit, with all seven tabs`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1080 });
      await boot(page, answers);
      await page.evaluate(() => showView('jobs'));
      await expect(page.locator('#jobsBody .kanban-card').first()).toBeVisible();
      let o = await overflow(page);
      await shot(page, `1-${width}-jobs-board`);
      expect(o.doc, 'Jobs board').toBeLessThanOrEqual(o.inner);
      expect(o.body, 'Jobs board body').toBeLessThanOrEqual(o.inner);

      await page.evaluate(() => showView('financials'));
      await expect(page.locator('#viewFinancials')).toHaveClass(/active/);
      o = await overflow(page);
      await shot(page, `1-${width}-financials`);
      expect(o.doc, 'Financials').toBeLessThanOrEqual(o.inner);
      expect(o.body, 'Financials body').toBeLessThanOrEqual(o.inner);

      await page.evaluate(() => showSubTab('jobprofit'));
      await expect(page.locator('#jpListBody .jp-row').first()).toBeVisible();
      o = await overflow(page);
      await shot(page, `1-${width}-job-profit`);
      expect(o.doc, 'Job Profit').toBeLessThanOrEqual(o.inner);
      expect(o.body, 'Job Profit body').toBeLessThanOrEqual(o.inner);

      // Every header control is on the screen, not off its right edge.
      const offscreen = await page.evaluate(() => Array.from(document.querySelectorAll('.header button, .header a, .header input'))
        .filter((el) => el.offsetParent !== null)
        .map((el) => ({ t: (el.textContent || el.placeholder || '').trim(), r: el.getBoundingClientRect() }))
        .filter((x) => x.r.right > window.innerWidth + 0.5 || x.r.left < -0.5).map((x) => x.t));
      expect(offscreen).toEqual([]);
    });
  }

  test('810 wide: a tap on the search box types there and the page does not slide', async ({ page }) => {
    await boot(page, Object.assign({}, answers, { search_jobs: { jobs: [] } }));
    await page.evaluate(() => { showView('financials'); showSubTab('jobprofit'); });
    await expect(page.locator('#jpListBody .jp-row').first()).toBeVisible();
    await page.locator('#globalSearch').tap();
    await expect(page.locator('#globalSearch')).toBeFocused();
    await page.keyboard.type('SWP-261247');
    await expect(page.locator('#globalSearch')).toHaveValue('SWP-261247');
    expect(await page.evaluate(() => [window.scrollX, document.scrollingElement.scrollLeft, document.body.scrollLeft])).toEqual([0, 0, 0]);
    await shot(page, '1-810-search-typed');
    // The search box is fully on the screen.
    const box = await page.locator('#globalSearch').boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(810);
  });

  test('810 wide: each header tab tap lands on that tab', async ({ page }) => {
    await boot(page, answers);
    await page.evaluate(() => showView('jobs'));
    for (const view of ['financials', 'jobs', 'financials']) {
      const btn = page.locator(`.header-nav button[data-view="${view}"]`);
      const hit = await btn.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!at && (at === el || el.contains(at));
      });
      expect(hit, `${view} tab is what a finger at its centre touches`).toBe(true);
      await btn.tap();
      await expect(page.locator('#view' + view.charAt(0).toUpperCase() + view.slice(1))).toHaveClass(/active/);
    }
  });
});

async function openPeek(page, jobId) {
  await page.evaluate((id) => {
    window.__opened = [];
    window.open = (u) => { window.__opened.push(u); return null; };
    openJobPeek(id);
  }, jobId);
  await expect(page.locator('#slidePanelBody')).toContainText('Open Record');
}

test.describe('2. Quick view photos are small thumbnails', () => {
  test('SWP-261247: 32 receipts load as 160 px thumbnails, lazily; the full photo only on a tap', async ({ page }) => {
    const images = await boot(page, { job_detail: jobDetail(JOB_P, 'SWP-261247', { media: RECEIPTS }), job_profit: profitDetail(PROFIT_P) });
    await openPeek(page, JOB_P);
    await expect(page.locator('#slidePanelBody')).toContainText('Receipts (32)');
    const imgs = page.locator('#slidePanelBody img[alt="Receipt"]');
    await expect(imgs).toHaveCount(32);
    const attrs = await imgs.evaluateAll((els) => els.map((e) => ({ src: e.getAttribute('src'), loading: e.getAttribute('loading'), full: e.getAttribute('data-full-photo') })));
    attrs.forEach((a, i) => {
      expect(a.src).toBe(RECEIPTS[i].storage_url.replace('/object/public/', '/render/image/public/') + '?width=160');
      expect(a.loading).toBe('lazy');
      expect(a.full).toBe(RECEIPTS[i].storage_url);
    });
    await imgs.last().scrollIntoViewIfNeeded();
    await expect.poll(() => images.filter((u) => u.includes('/render/image/public/')).length).toBeGreaterThan(0);
    await shot(page, '2-swp-261247-quickview-receipts');
    // No full-size photo was fetched to draw the panel.
    expect(images.filter((u) => u.includes('/object/public/'))).toEqual([]);
    await imgs.nth(3).tap();
    expect(await page.evaluate(() => window.__opened)).toEqual([RECEIPTS[3].storage_url]);
  });

  test('a stored thumbnail wins, and an address outside Supabase storage is used as it is', async ({ page }) => {
    const media = [
      { id: 'a', phase: 'receipt', storage_url: STORAGE + '/object/public/job-photos/x/full.jpg', thumbnail_url: STORAGE + '/object/public/job-photos/x/thumb.jpg' },
      { id: 'b', phase: 'during', storage_url: 'https://example.test/photo.jpg', thumbnail_url: null },
      { id: 'c', phase: 'receipt', storage_url: STORAGE + '/object/public/job-photos/x/broken-1.heic', thumbnail_url: null },
    ];
    const images = await boot(page, { job_detail: jobDetail(JOB_F, 'SWF-261099', { media }), job_profit: profitDetail(profitRow()) });
    await openPeek(page, JOB_F);
    await expect(page.locator('#slidePanelBody img[alt="Receipt"]').first()).toHaveAttribute('src', media[0].thumbnail_url);
    await expect(page.locator('#slidePanelBody img[alt="during"]')).toHaveAttribute('src', media[1].storage_url);
    await expect(page.locator('#slidePanelBody')).toContainText('During');
    // A thumbnail the storage cannot make says so, and the full photo is still not fetched.
    const broken = page.locator('#slidePanelBody img[data-full-photo$="broken-1.heic"]');
    await expect(broken).toHaveAttribute('alt', 'Photo not shown. Tap to open it.');
    expect(images.filter((u) => u.includes('/object/public/job-photos/x/broken-1.heic'))).toEqual([]);
    await broken.tap();
    expect(await page.evaluate(() => window.__opened)).toEqual([media[2].storage_url]);
  });
});

test.describe('3. Quick view margin is Job Profit\'s', () => {
  // The margin Job Profit's own Margin card shows for the same engine row.
  async function jobProfitMargin(page, row) {
    return page.evaluate((r) => {
      const host = document.createElement('div');
      host.innerHTML = _jpRenderDetail({ job: r, trades: [], cost_events: [], revenue_events: [], timeline: [], labels: {} });
      const card = Array.from(host.querySelectorAll('.jp-card')).find((c) => c.querySelector('.k').textContent === 'Margin');
      return card.querySelector('.v').textContent;
    }, row);
  }

  test('SWF-261099: 33.3% as in Job Profit, not 100% from PO costs of $0.00', async ({ page }) => {
    await boot(page, { job_detail: jobDetail(JOB_F, 'SWF-261099', { xero_project: { project_name: 'SWF-261099', total_invoiced: 12680, total_expenses: 2000 } }), job_profit: profitDetail(profitRow()) });
    await openPeek(page, JOB_F);
    const margin = page.locator('#slidePanelBody [data-peek-margin]');
    await expect(margin).toHaveText('Margin (Job Profit): 33.3%');
    expect(await jobProfitMargin(page, profitRow())).toBe('33.3%');
    const text = await page.locator('#slidePanelBody').innerText();
    expect(text).not.toContain('100%');
    expect(text).not.toMatch(/Margin: \d/); // nothing worked out from PO costs or the Xero Project
    const read = await page.evaluate(() => window.__d2.calls.filter((c) => c.action === 'job_profit'));
    expect(read).toEqual([{ action: 'job_profit', params: { job_id: '00000000-0000-4000-8000-00000000f099' } }]);
    await shot(page, '3-swf-261099-quickview-margin', page.locator('#slidePanel'));
  });

  test('SWP-261247: Withheld with Job Profit\'s reason', async ({ page }) => {
    await boot(page, { job_detail: jobDetail(JOB_P, 'SWP-261247'), job_profit: profitDetail(PROFIT_P) });
    await openPeek(page, JOB_P);
    const margin = page.locator('#slidePanelBody [data-peek-margin]');
    await expect(margin).toContainText('Margin (Job Profit): Withheld: costs incomplete');
    await expect(margin.locator('[data-peek-margin-why]')).toHaveText('Job not finished: profit not due yet. Open items: Xero Project has more expenses on record than the costs linked, so the full cost is unknown.');
    expect(await jobProfitMargin(page, PROFIT_P)).toBe('Withheld: costs incomplete');
    await expect(page.locator('#slidePanelBody')).not.toContainText('100%');
    await shot(page, '3-swp-261247-quickview-margin', page.locator('#slidePanel'));
  });

  test('a failed Job Profit read says the margin is not known, with Try again; no figure', async ({ page }) => {
    await boot(page, { job_detail: jobDetail(JOB_F, 'SWF-261099'), job_profit: { reject: { status: 504, message: 'The server took too long. Try again.' } } });
    await openPeek(page, JOB_F);
    const margin = page.locator('#slidePanelBody [data-peek-margin]');
    await expect(margin).toContainText('Margin: Not known');
    await expect(margin).toContainText('Job Profit could not be read: The server took too long. Try again.');
    await page.evaluate(() => { window.__d2.answers.job_profit = { job: { job_id: 'x', margin_pct: 33.29, status: 'complete', completeness: [], cost_flag: 'ok' } }; });
    await margin.getByRole('button', { name: 'Try again' }).tap();
    await expect(margin).toHaveText('Margin (Job Profit): 33.3%');
  });

  test('a login that cannot see Job Profit gets no margin figure at all', async ({ page }) => {
    await boot(page, { job_detail: jobDetail(JOB_F, 'SWF-261099'), job_profit: profitDetail(profitRow()) }, { jobProfit: false });
    await openPeek(page, JOB_F);
    await expect(page.locator('#slidePanelBody [data-peek-margin]')).toHaveCount(0);
    await expect(page.locator('#slidePanelBody')).not.toContainText('Margin');
    expect(await page.evaluate(() => window.__d2.calls.filter((c) => c.action === 'job_profit').length)).toBe(0);
  });
});

// The live check's own test for a machine word on screen (run.js, rawText).
const CODE_RE = /\b[a-z]+(?:_[a-z0-9]+){1,}\b/;
async function codesShown(locator) {
  return locator.evaluate((root, src) => {
    const re = new RegExp(src);
    const out = [];
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = tw.nextNode())) {
      const el = n.parentElement;
      if (!el || !el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') continue;
      const m = re.exec(n.nodeValue);
      if (m) out.push(m[0]);
    }
    return out;
  }, CODE_RE.source);
}

test.describe('4. No system words on screen', () => {
  test('quick view timeline: statuses in words', async ({ page }) => {
    await boot(page, { job_detail: jobDetail(JOB_F, 'SWF-261099'), job_profit: profitDetail(profitRow()) });
    await openPeek(page, JOB_F);
    const body = page.locator('#slidePanelBody');
    await expect(body).toContainText('Status → Schedule install');
    await expect(body).toContainText('Status → In progress');
    expect(await codesShown(body)).toEqual([]);
  });

  test('Job Profit list: make-safe families in words', async ({ page }) => {
    await boot(page, { list_invoices: { invoices: [] }, job_profit_list: profitList([profitRow(), PROFIT_P].concat(MAKESAFE_ROWS)) });
    await page.evaluate(() => { showView('financials'); showSubTab('jobprofit'); });
    const list = page.locator('#jpListBody');
    await expect(list.locator('.jp-row')).toHaveCount(5);
    await expect(list.locator('.jp-row').nth(2)).toContainText('Make-safe (general)');
    await expect(list.locator('.jp-row').nth(3)).toContainText('Temporary fence make-safe');
    await expect(list.locator('.jp-row').nth(4)).toContainText('Roof report');
    expect(await codesShown(list)).toEqual([]);
  });

  test('Job Profit job: the withheld reason, an agent placement and a document status in words', async ({ page }) => {
    const detail = profitDetail(PROFIT_P, {
      cost_events: [{ source: 'materials_fact', party: 'Fixture Supplies', description: 'agent_ai: The email attached to this invoice identifies SWP-261247.', document_id: 'd1', document_number: 'INV-1', document_status: 'pushed_to_xero', lane: 'materials', amount_ex: 120, match_method: 'agent_prematch' }],
      line_evidence: { status: 'provisional', invoice_lines: 3, invoice_lines_evidenced: 3, cost_items: 18, cost_items_evidenced: 12, evidenced_ex: 33671.89, not_evidenced_ex: 2720, lines: [],
        why_not_verified: ['6 cost item(s) without evidence for this job', 'Job Profit withholds this job\'s profit (xero_project_exceeds_line_costs)'] },
    });
    await boot(page, { list_invoices: { invoices: [] }, job_profit_list: profitList([PROFIT_P]), job_profit: detail });
    await page.evaluate(() => { showView('financials'); showSubTab('jobprofit'); openJobProfitDetail(null, 'SWP-261247'); });
    const area = page.locator('#jpDetail');
    await expect(area).toContainText('Job Profit withholds this job\'s profit (Xero project spend above line costs)');
    await expect(area).toContainText('Placed by the AI agent (its reason: The email attached to this invoice identifies SWP-261247.)');
    await expect(area).toContainText('Sent to Xero');
    expect(await codesShown(area)).toEqual([]);
    await shot(page, '4-swp-261247-jobprofit-words', area);
  });
});

test.describe('4. No system words on the new job card', () => {
  const { JOB_ID, buildJobDetail, buildJobOverview } = require('../fixtures/job-overview-v2');
  test('the job value check and the disputed AI notes read in words', async ({ page }) => {
    const ov = buildJobOverview();
    ov.story.money.job_value = { amount: 13750, basis: 'pricing_json.totalIncGST' };
    ov.story.checks = [{ rule: 'C2_value_mismatch', what: 'Issued invoices $14,000.00 exceed the job value $13,750.00 (pricing_json.totalIncGST)', cites: [{ t: 'jobs', id: JOB_ID }] }];
    ov.story.disputed = [{ key: 'd1', status: 'disputed', disputed_at: '2026-10-30T02:00:00Z', what: 'Customer says the gate was not part of the job.',
      cites: [{ t: 'business_events', id: 'e0ecaf7e-c762-48a8-a89a-76eda576ae6b' }, { t: 'xero_invoices', id: '7d5fb75d-b4fa-4f69-aa7f-081c6ffb55fb' }, { t: 'job_assignments', id: '3cd323be-ab5e-4c1e-9d2f-0e22ba2ec001' }, { t: 'some_new_table', id: 'n1' }] }];
    ov.story.settled = [];
    await boot(page, { job_detail: buildJobDetail(), job_overview: ov, annotations: { annotations: [] }, list_job_actions: [] }, { url: '/ops.html?overview=v2' });
    await page.evaluate((id) => openJobDetail(id), JOB_ID);
    const check = page.locator('#ov2ValueCheck');
    await expect(check).toContainText('exceed the job value $13,750.00 (saved scope price, inc GST)');
    const history = page.locator('#ov2LedgerHistory');
    await history.locator('details summary').first().tap();
    await expect(history.locator('li')).toHaveText([
      'Message, reference e0ecaf7e-c762-48a8-a89a-76eda576ae6b',
      'Xero invoice, reference 7d5fb75d-b4fa-4f69-aa7f-081c6ffb55fb',
      'Crew booking, reference 3cd323be-ab5e-4c1e-9d2f-0e22ba2ec001',
      'Record, reference n1',
    ]);
    expect(await codesShown(check)).toEqual([]);
    expect(await codesShown(history)).toEqual([]);
    await shot(page, '4-job-card-ai-notes', history);
  });
});

// The live check's own tap-target rule (run.js): both sides at least 44 px.
async function sizes(locator) {
  return locator.evaluateAll((els) => els.filter((e) => e.getClientRects().length).map((e) => {
    const r = e.getBoundingClientRect();
    return { t: (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' '), w: Math.round(r.width), h: Math.round(r.height), left: r.left, right: r.right };
  }));
}
function expectTappable(list, what) {
  expect(list.length, what + ' shown').toBeGreaterThan(0);
  for (const s of list) {
    expect(s.h, `${what} "${s.t}" height`).toBeGreaterThanOrEqual(44);
    expect(s.w, `${what} "${s.t}" width`).toBeGreaterThanOrEqual(44);
  }
}

test.describe('5. Touch targets are at least 44 px', () => {
  test('board card icons: 44 px, and each names itself on touch', async ({ page }) => {
    await boot(page, { pipeline: PIPELINE });
    await page.evaluate(() => showView('jobs'));
    const first = page.locator('#jobsBody .kanban-card').first();
    await expect(first).toBeVisible();
    const icons = first.locator('.kanban-icon-btn');
    expectTappable(await sizes(icons), 'card icon');
    expectTappable(await sizes(first.locator('.kanban-ghl-link')), 'card arrow link');
    expect(await icons.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).toEqual(['Open comms', 'Open scope tool', 'Search in Xero', 'Ops notes', 'Trade comms']);
    await expect(first.locator('.kanban-icon-label')).toHaveText(['Comms', 'Scope', 'Xero', 'Notes', 'Trade']);
    for (const label of await first.locator('.kanban-icon-label').all()) await expect(label).toBeVisible();
    // Nothing on the card spills out of its column.
    const card = await first.boundingBox();
    for (const s of await sizes(icons)) expect(s.right).toBeLessThanOrEqual(card.x + card.width + 0.5);
    await shot(page, '5-board-card-icons', first);
  });

  test('quick view Open Record, Job Profit Open job, Close, Load next 100 and Show N lines', async ({ page }) => {
    const detail = profitDetail(profitRow(), {
      trades: [{ party_id: 'p1', party: 'Fixture Crew', amount_ex: 307.4, lines: 2, first: '2026-10-01', last: '2026-10-02' }],
      cost_events: [
        { source: 'trade_line', party_id: 'p1', party: 'Fixture Crew', lane: 'labour', description: 'Day 1', amount_ex: 150, event_date: '2026-10-01' },
        { source: 'trade_line', party_id: 'p1', party: 'Fixture Crew', lane: 'labour', description: 'Day 2', amount_ex: 157.4, event_date: '2026-10-02' },
      ],
      line_evidence: { status: 'verified', invoice_lines: 3, invoice_lines_evidenced: 3, cost_items: 7, cost_items_evidenced: 7, evidenced_ex: 21138.97, not_evidenced_ex: 0,
        lines: Array.from({ length: 10 }, (_, i) => ({ kind: 'invoice_line', document: 'INV-' + i, date: '2026-10-01', description: 'Line ' + i, amount_ex: 10, state: 'evidenced' })) },
    });
    await boot(page, { job_detail: jobDetail(JOB_F, 'SWF-261099'), list_invoices: { invoices: [] }, job_profit_list: profitList([profitRow()], true), job_profit: detail });
    await openPeek(page, JOB_F);
    expectTappable(await sizes(page.locator('#slidePanelBody').getByRole('button', { name: 'Open Record' })), 'Open Record');
    expectTappable(await sizes(page.locator('#slidePanelBody a.btn')), 'quick view link');
    await shot(page, '5-quickview-buttons', page.locator('#slidePanel'));
    await page.evaluate(() => { closeSlidePanel(); showView('financials'); showSubTab('jobprofit'); });
    await expect(page.locator('#jpMore')).toContainText('Load next 100');
    expectTappable(await sizes(page.locator('#jpMore button')), 'Load next 100');
    await page.evaluate(() => openJobProfitDetail(null, 'SWF-261099'));
    const head = page.locator('#jpDetail .jp-detail-head');
    await expect(head).toContainText('Open job');
    expectTappable(await sizes(head.locator('button')), 'Job Profit head button');
    expectTappable(await sizes(page.locator('#jpDetail [data-jp-evidence-lines] > summary')), 'Show 10 lines');
    await expect(page.locator('#jpDetail [data-jp-evidence-lines] > summary')).toHaveText('Show 10 lines');
    expectTappable(await sizes(page.locator('#jpDetail [data-jp-trade-toggle]')), 'Show 2 lines');
    await shot(page, '5-jobprofit-buttons', page.locator('#jpDetail'));
  });

  test('job card tabs', async ({ page }) => {
    await boot(page, {});
    await page.evaluate(() => document.getElementById('jobDetailView').classList.add('active'));
    const tabs = page.locator('.jd-tabs .jd-tab');
    await expect(tabs).toHaveCount(7);
    expectTappable(await sizes(tabs), 'job card tab');
  });

  test('work order Approve, Query and Reject: 44 px and well apart', async ({ page }) => {
    const wo = { id: 'wo-1', job_id: 'job-1', wo_number: 'WO-1', kind: 'job', status: 'approved', agreed_labour_ex: 2000, scope_items: [], updated_at: '2026-10-21T00:00:00.000Z' };
    const data = {
      job: { id: 'job-1', type: 'patio', job_number: 'SWP-261247', status: 'in_progress', client_name: 'Fixture Client', site_suburb: 'Dianella' },
      documents: [], work_orders: [], invoices: [], events: [], media: [], assignments: [], purchase_orders: [],
      job_work_order: { work_order: wo, figures: { agreed_ex: 2000, billed_to_date_ex: 400, remaining_ex: 1600, over_agreed: false }, lines: [], variations: [] },
    };
    await boot(page, {
      job_work_order: data.job_work_order,
      list_trade_invoice_lines: { lines: [{ id: 'line-1', trade_name: 'Sam Crew', description: 'Install day', line_type: 'labour', line_total_ex: 400, office_review_status: 'awaiting', trade_invoices: { status: 'pending_acknowledgment' } }] },
    });
    await page.evaluate((d) => {
      _opsUserEmail = 'shaun@secureworkswa.com.au';
      _currentJobId = d.job.id;
      _currentJobData = d;
      document.getElementById('jobDetailView').classList.add('active');
      showJobSubView('overview');
    }, data);
    const block = page.locator('[data-office-line-review="line-1"]');
    await expect(block.locator('button')).toHaveText(['Approve', 'Query', 'Reject']);
    const s = await sizes(block.locator('button'));
    expectTappable(s, 'work order review button');
    const boxes = await block.locator('button').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
    for (let i = 1; i < boxes.length; i++) {
      const sameRow = Math.abs(boxes[i].top - boxes[i - 1].top) < 1;
      const gap = sameRow ? boxes[i].left - boxes[i - 1].right : boxes[i].top - boxes[i - 1].bottom;
      expect(gap, 'space between review buttons').toBeGreaterThanOrEqual(12);
    }
    await shot(page, '5-work-order-review', block);
  });
});

test.describe('6. A server failure reads in plain words', () => {
  async function serverAnswers(page, status) {
    await page.route('**/functions/v1/ops-api**', (route) => {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (status() === 'drop') return route.abort('failed');
      if (status() !== 200) return route.fulfill({ status: status(), headers: cors, contentType: 'text/html', body: '<html><body>504 Gateway Time-out</body></html>' });
      const action = new URL(route.request().url()).searchParams.get('action');
      const body = action === 'job_profit' ? profitDetail(profitRow()) : action === 'job_profit_list' ? profitList([profitRow()]) : {};
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    });
  }

  test('Job Profit list and job on a 504: "The server took too long. Try again." with the Try again button', async ({ page }) => {
    let status = 504;
    await boot(page, {}, { realFetch: true });
    await serverAnswers(page, () => status);
    await page.evaluate(() => { showView('financials'); showSubTab('jobprofit'); });
    const list = page.locator('#jpListBody');
    await expect(list).toContainText('Could not load the job list, so no job here is known: The server took too long. Try again. If it keeps failing, narrow the filters.');
    await expect(list.getByRole('button', { name: 'Retry' })).toBeVisible();
    await page.evaluate(() => openJobProfitDetail(null, 'SWF-261099'));
    const area = page.locator('#jpDetail');
    await expect(area).toContainText('Could not read this job\'s profit, so nothing here is known. The server took too long. Try again.');
    await expect(area.getByRole('button', { name: 'Try again' })).toBeVisible();
    await shot(page, '6-jobprofit-server-504');
    for (const raw of ['API error', '504']) {
      await expect(list).not.toContainText(raw);
      await expect(area).not.toContainText(raw);
    }
    // The server answers again: Try again reads the job.
    status = 200;
    await area.getByRole('button', { name: 'Try again' }).tap();
    await expect(area).toContainText('33.3%');
  });

  test('a read that never reaches the server says so in words', async ({ page }) => {
    await boot(page, {}, { realFetch: true });
    await serverAnswers(page, () => 'drop');
    await page.evaluate(() => { showView('financials'); showSubTab('jobprofit'); });
    await expect(page.locator('#jpListBody')).toContainText('Could not reach the server. Check the signal and try again.');
    await expect(page.locator('#jpListBody')).not.toContainText(/Load failed|Failed to fetch|NetworkError/);
  });
});

test.describe('7. The patio average under Margin tries once more by itself', () => {
  // The 05:05Z check's one FAIL: "patio average could not load; close and reopen the job"
  // after the server's 30 s database limit. One quiet retry, then words and Try again.
  const ROLLUP = { view: 'rollup', by_type: [{ work_type: 'patio', margin_pct: 31.8, jobs_with_margin: 6, jobs: 77 }] };
  async function openPatio(page, failures) {
    await boot(page, { list_invoices: { invoices: [] }, job_profit: profitDetail(PROFIT_P) });
    await page.evaluate(({ failures, ROLLUP }) => {
      window.JP_TYPE_AVG_RETRY_MS = 50;
      let left = failures;
      const base = window.opsFetch;
      window.opsFetch = async (action, params) => {
        if (action === 'job_profit_list' && params && params.view === 'rollup') {
          window.__d2.calls.push({ action, params });
          if (left-- > 0) throw Object.assign(new Error('job profit rollup read failed at row 0: canceling statement due to statement timeout'), { status: 500 });
          return JSON.parse(JSON.stringify(ROLLUP));
        }
        if (action === 'job_profit_list') return { jobs: [], has_more: false };
        return base(action, params);
      };
      showView('financials'); showSubTab('jobprofit');
      openJobProfitDetail(null, 'SWP-261247');
    }, { failures, ROLLUP });
  }
  const rollups = (page) => page.evaluate(() => window.__d2.calls.filter((c) => c.action === 'job_profit_list' && c.params.view === 'rollup').length);

  test('one failure: the second try shows the average, with no error', async ({ page }) => {
    await openPatio(page, 1);
    await expect(page.locator('#jpTypeAvg')).toContainText('vs patio 31.8% pooled margin over all finished patio jobs with a publishable margin (6 of 77)');
    expect(await rollups(page)).toBe(2);
  });

  test('two failures: plain words and a Try again button that reads again', async ({ page }) => {
    await openPatio(page, 2);
    const avg = page.locator('#jpTypeAvg');
    await expect(avg).toContainText('patio average could not load (the server took too long, twice).');
    await expect(avg).not.toContainText('close and reopen');
    expect(await rollups(page)).toBe(2);
    const again = avg.getByRole('button', { name: 'Try again' });
    expectTappable(await sizes(again), 'Try again');
    await again.tap();
    await expect(avg).toContainText('31.8% pooled margin');
    expect(await rollups(page)).toBe(3);
  });
});
