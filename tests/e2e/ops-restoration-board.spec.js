// Restoration board (modules/ops-restoration-board.js, // <restoration-board> in ops.html;
// backend secureworks-backend docs/restoration-board-v1.md, ops-api restoration_board /
// restoration_set_stage). Offline: opsFetch and opsPost are replaced in the page. Names are made up.
//
// Contract under guard:
//  - A "Restoration" pipeline tab sits next to "Repairs".
//  - The board is the seven light columns in order, with the server's counts, no dark Sales drawer.
//  - A card shows job number, suburb, builder and reference, mode, next step, quote, invoices, crew.
//  - Move to... lists the moves; a refused move is disabled with the server's words.
//  - Choosing a move POSTs restoration_set_stage {job_id, stage} and repaints from the card returned.
//  - Closing a job with nothing invoiced asks for a no-charge reason and sends it.
//  - A refused move shows the back end's words, never its code.
//  - A failed read says so in words and never draws an empty board.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { revealOpsStaticFixture } = require('../helpers/ops-auth');

test.use({ viewport: { width: 1900, height: 900 } });

const JOB_A = '11111111-0000-4000-8000-00000000000a';
const JOB_B = '22222222-0000-4000-8000-00000000000b';
const JOB_C = '33333333-0000-4000-8000-00000000000c';

const STAGES = [
  ['new', 'New'], ['booked', 'Booked'], ['report_due', 'Report due'],
  ['quote_with_builder', 'Quote with builder'], ['works', 'Works in progress'],
  ['invoiced', 'Invoiced'], ['closed', 'Closed'],
];
const LABEL = Object.fromEntries(STAGES);

function moves(current, needs) {
  return STAGES.filter(([k]) => k !== current).map(([k, label]) => ({
    stage: k, label,
    allowed: k === 'closed' ? true : !(needs && needs[k]),
    needs: (needs && needs[k]) || null,
  }));
}

function card(over) {
  return Object.assign({
    job_status: 'processing', site: '1 Sample St, Exampleby', client_name: 'Pat Example',
    builder: 'Sample Builders', builder_purchase_order: null, mode: 'assess_and_quote', mode_label: 'Assess and quote',
    stage_source: 'derived', stage_set_at: null, stage_set_by: null,
    quote: { number: null, status: null, sent_at: null, approved_number: null },
    invoices: [], crew: [], report_received_at: null, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-10T00:00:00Z',
  }, over);
}

const CLOSE_NEEDS = 'Nothing has been invoiced on this job. Invoice it first, or close it with a no_charge_reason.';
const WORKS_NEEDS = "The builder's approval of the quote is not recorded yet.";

function board() {
  const cards = [
    card({
      id: JOB_A, job_number: 'SWRESTO-261001', site_suburb: 'Exampleby', builder_reference: 'MLR-24001',
      stage: 'quote_with_builder', stage_label: 'Quote with builder', derived_stage: 'quote_with_builder',
      next_step: 'Waiting on the builder. When they approve, record the approval and the card moves to Works in progress.',
      quote: { number: 'SWRESTO-261001-Q1', status: 'sent', sent_at: '2026-11-11T02:00:00Z', approved_number: null },
      invoices: [{ invoice_number: 'INV-2001', status: 'AUTHORISED', total: 165, amount_due: 165 }],
      crew: [{ name: 'Sam Sample', scheduled_date: '2026-11-05', status: 'complete' }],
      moves: moves('quote_with_builder', { works: WORKS_NEEDS, closed: 'Invoice INV-2001 is still a draft. Approve and send it, or void it, before closing.' }),
    }),
    card({
      id: JOB_B, job_number: 'SWMS-261002', site_suburb: 'Sampleton', builder_reference: 'MLR-24002',
      mode: 'do_and_charge', mode_label: 'Do and charge',
      stage: 'new', stage_label: 'New', derived_stage: 'new', next_step: 'Book a crew to attend.',
      moves: moves('new', { quote_with_builder: 'This job is do and charge: it has no quote stage.', invoiced: 'No approved (AUTHORISED) invoice is on this job yet. Approve and send the invoice first.', closed: CLOSE_NEEDS }),
    }),
    card({
      id: JOB_C, job_number: 'SWRESTO-261003', site_suburb: 'Testville', builder_reference: 'MLR-24003',
      stage: 'invoiced', stage_label: 'Invoiced', derived_stage: 'invoiced',
      next_step: 'Invoice sent. The card closes when it is paid, or close it by hand.',
      quote: { number: 'SWRESTO-261003-Q1', status: 'approved', sent_at: '2026-11-02T02:00:00Z', approved_number: 'SWRESTO-261003-Q1' },
      invoices: [{ invoice_number: 'INV-2003', status: 'AUTHORISED', total: 2420, amount_due: 1000 }],
      crew: [{ name: 'Lee Example', scheduled_date: '2026-11-04', status: 'complete' }, { name: 'Sam Sample', scheduled_date: '2026-11-04', status: 'complete' }],
      moves: moves('invoiced'),
    }),
  ];
  return {
    success: true, contract_version: 'restoration-board/v1', generated_at: '2026-11-12T00:00:00Z',
    columns: STAGES.map(([key, label]) => ({ key, label, count: cards.filter((c) => c.stage === key).length })),
    cards,
  };
}

// Open the Jobs view on the Restoration tab with the API stubbed in the page.
// fetchMode: 'ok' | 'reject' | 'unknown'. post: a function body (string) for opsPost.
async function openBoard(page, { fetchMode = 'ok', fetchError = '', post = 'return Promise.resolve({ success: true });' } = {}) {
  await page.goto('/ops.html');
  await revealOpsStaticFixture(page);
  await page.evaluate(({ data, fetchMode, fetchError, post }) => {
    const main = document.getElementById('mainApp');
    if (main) main.style.display = '';
    document.querySelectorAll('.view').forEach((v) => { v.classList.remove('active'); v.style.display = 'none'; });
    const view = document.getElementById('viewJobs');
    view.classList.add('active');
    view.style.cssText = 'display:flex;flex-direction:column;position:static;height:860px;padding:16px 24px 0;background:var(--sw-bg,#F4F1EE);';
    window.__rbFetches = []; window.__rbPosts = [];
    window.opsFetch = (action, params) => {
      window.__rbFetches.push({ action, params });
      if (action !== 'restoration_board') return Promise.reject(new Error('Unknown action: ' + action));
      if (fetchMode === 'unknown') return Promise.reject(Object.assign(new Error('Unknown action: restoration_board'), { status: 400 }));
      if (fetchMode === 'reject') return Promise.reject(Object.assign(new Error(fetchError), { status: 503 }));
      return Promise.resolve(JSON.parse(JSON.stringify(data)));
    };
    // eslint-disable-next-line no-new-func
    const postImpl = new Function('action', 'body', post);
    window.opsPost = (action, body) => { window.__rbPosts.push({ action, body }); return postImpl(action, body); };
    window.openJobDetail = (id) => { window.__rbOpened = id; };
    setPipelineTab('restoration');
  }, { data: board(), fetchMode, fetchError, post });
}

const col = (page, key) => page.locator(`#jobsBody [data-rb-col="${key}"]`);
const cardEl = (page, id) => page.locator(`#jobsBody [data-rb-card="${id}"]`);

test('Restoration tab sits next to Repairs', async ({ page }) => {
  await page.goto('/ops.html');
  const order = await page.$$eval('[data-pipeline]', (els) => els.map((e) => e.getAttribute('data-pipeline')));
  expect(order.indexOf('restoration')).toBe(order.indexOf('repairs') + 1);
});

test('the board shows the seven columns with counts, and a card shows its facts', async ({ page }) => {
  await openBoard(page);
  const headers = page.locator('#jobsBody [data-rb-col] .kanban-col-header');
  await expect(headers).toHaveCount(7);
  const labels = await headers.evaluateAll((els) => els.map((e) => e.childNodes[0].textContent.trim()));
  expect(labels).toEqual(STAGES.map(([, l]) => l));
  await expect(col(page, 'new').locator('[data-rb-count]')).toHaveText('1');
  await expect(col(page, 'booked').locator('[data-rb-count]')).toHaveText('0');
  await expect(col(page, 'booked')).toContainText('No jobs');
  expect(await page.evaluate(() => window.__rbFetches)).toEqual([{ action: 'restoration_board', params: {} }]);

  const a = cardEl(page, JOB_A);
  await expect(col(page, 'quote_with_builder').locator(`[data-rb-card="${JOB_A}"]`)).toHaveCount(1);
  await expect(a.locator('[data-rb-jobnum]')).toHaveText('SWRESTO-261001');
  await expect(a.locator('[data-rb-site]')).toHaveText('Exampleby');
  await expect(a.locator('[data-rb-builder]')).toHaveText('Sample Builders · MLR-24001');
  await expect(a.locator('[data-rb-mode]')).toHaveText('Assess and quote');
  await expect(a.locator('[data-rb-next]')).toContainText('Waiting on the builder');
  await expect(a.locator('[data-rb-quote]')).toHaveText('SWRESTO-261001-Q1 with builder');
  await expect(a.locator('[data-rb-invoice]')).toHaveText('INV-2001 Sent $165.00');
  await expect(a.locator('[data-rb-crew]')).toHaveText('Crew: Sam Sample');

  const c = cardEl(page, JOB_C);
  await expect(c.locator('[data-rb-quote]')).toHaveText('SWRESTO-261003-Q1 approved');
  await expect(c.locator('[data-rb-invoice]')).toHaveText('INV-2003 Sent $2,420.00, $1,000.00 owing');
  await expect(c.locator('[data-rb-crew]')).toHaveText('Crew: Lee Example, Sam Sample');

  // No dark Sales drawer on this board.
  const salesDrawer = await page.locator('#jobsBody span').evaluateAll((els) =>
    els.some((s) => /vertical-rl/.test(s.getAttribute('style') || '') && /Sales/.test(s.textContent)));
  expect(salesDrawer).toBe(false);

  // Screenshots go to test-results unless RESTORATION_BOARD_SHOT names a file.
  // The seven columns are wider than the window, so let the board size to its content.
  await page.evaluate(() => {
    const view = document.getElementById('viewJobs');
    view.style.height = '560px';
    if (view.parentElement) view.parentElement.style.maxWidth = 'none';
    const body = document.getElementById('jobsBody');
    body.style.overflow = 'visible';
    const k = body.querySelector('.rb-kanban');
    k.style.overflow = 'visible'; k.style.width = 'max-content';
    body.querySelector('.rb-board').style.width = 'max-content';
  });
  await page.locator('#jobsBody .rb-board').screenshot({
    path: process.env.RESTORATION_BOARD_SHOT || path.resolve(__dirname, '../../test-results/ops-restoration-board/board.png'),
  });

  // Clicking the card opens the job.
  await a.locator('[data-rb-site]').click();
  expect(await page.evaluate(() => window.__rbOpened)).toBe(JOB_A);
});

test('a refused move is disabled with the server words; an allowed move posts and repaints from the returned card', async ({ page }) => {
  const moved = board().cards[1];
  Object.assign(moved, { stage: 'booked', stage_label: 'Booked', stage_source: 'set', next_step: 'Attend and do the works, then submit the report.', moves: moves('booked') });
  await openBoard(page, { post: 'return Promise.resolve(' + JSON.stringify({ success: true, card: moved }) + ');' });
  const b = cardEl(page, JOB_B);
  await b.locator('[data-rb-move-toggle]').click();
  const invoiced = b.locator('[data-rb-move="invoiced"]');
  await expect(invoiced).toBeDisabled();
  await expect(invoiced.locator('xpath=..').locator('[data-rb-needs]')).toHaveText('No approved (AUTHORISED) invoice is on this job yet. Approve and send the invoice first.');
  // Opening the menu did not open the job.
  expect(await page.evaluate(() => window.__rbOpened || null)).toBe(null);

  await b.locator('[data-rb-move="booked"]').click();
  expect(await page.evaluate(() => window.__rbPosts)).toEqual([
    { action: 'restoration_set_stage', body: { job_id: JOB_B, stage: 'booked' } },
  ]);
  await expect(col(page, 'booked').locator(`[data-rb-card="${JOB_B}"]`)).toHaveCount(1);
  await expect(col(page, 'new').locator('[data-rb-card]')).toHaveCount(0);
  await expect(col(page, 'booked').locator('[data-rb-count]')).toHaveText('1');
  await expect(col(page, 'new').locator('[data-rb-count]')).toHaveText('0');
  await expect(cardEl(page, JOB_B).locator('[data-rb-next]')).toHaveText('Attend and do the works, then submit the report.');
  // Repainted from the returned card: no second read.
  expect((await page.evaluate(() => window.__rbFetches)).length).toBe(1);
});

test('closing a job with nothing invoiced asks why and sends the no-charge reason', async ({ page }) => {
  await openBoard(page, { post: 'return Promise.resolve({ success: true });' });
  page.once('dialog', (d) => { expect(d.type()).toBe('prompt'); expect(d.message()).toContain('Nothing has been invoiced'); d.accept('Builder cancelled before attendance'); });
  const b = cardEl(page, JOB_B);
  await b.locator('[data-rb-move-toggle]').click();
  await expect(b.locator('[data-rb-move="closed"]')).toBeEnabled();
  await b.locator('[data-rb-move="closed"]').click();
  await expect.poll(() => page.evaluate(() => window.__rbPosts)).toEqual([
    { action: 'restoration_set_stage', body: { job_id: JOB_B, stage: 'closed', no_charge_reason: 'Builder cancelled before attendance' } },
  ]);
});

test('a refused move shows the back end words, never the code', async ({ page }) => {
  const words = 'No approved (AUTHORISED) invoice is on this job yet. Approve and send the invoice first.';
  await openBoard(page, {
    post: 'return Promise.reject(Object.assign(new Error(' + JSON.stringify(words) + '), { status: 409, code: "restoration_stage_no_invoice" }));',
  });
  const c = cardEl(page, JOB_C);
  await c.locator('[data-rb-move-toggle]').click();
  await c.locator('[data-rb-move="works"]').click();
  const notice = page.locator('#jobsBody [data-rb-notice]');
  await expect(notice).toHaveText('SWRESTO-261003 not moved. ' + words);
  await expect(page.locator('#jobsBody')).not.toContainText('restoration_stage_no_invoice');
  // The card stays where it was.
  await expect(col(page, 'invoiced').locator(`[data-rb-card="${JOB_C}"]`)).toHaveCount(1);
});

test('a failed read says so in words and draws no empty board', async ({ page }) => {
  await openBoard(page, { fetchMode: 'reject', fetchError: 'The server is not answering right now. Try again.' });
  const failed = page.locator('#jobsBody [data-rb-failed]');
  await expect(failed).toContainText('Restoration board not shown.');
  await expect(failed).toContainText('could not be read, so no jobs are shown.');
  await expect(failed).toContainText('The server is not answering right now.');
  await expect(page.locator('#jobsBody [data-rb-col]')).toHaveCount(0);

  await openBoard(page, { fetchMode: 'unknown' });
  await expect(page.locator('#jobsBody [data-rb-failed]')).toContainText('not switched on yet');
  await expect(page.locator('#jobsBody [data-rb-col]')).toHaveCount(0);
});
