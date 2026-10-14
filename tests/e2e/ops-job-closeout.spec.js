// Paid close-out tags and the Get Review ladder in ops.html
// (docs/job-closeout-screens.md). Runs the shipped renderKanbanCard and
// getNextStatuses on the real page: the preview off must leave both exactly as
// they were; the preview on draws the tags from the row's `closeout` block only.
const { test, expect } = require('@playwright/test');

const FUTURE = () => new Date(Date.now() + 5 * 3600000 - 60000).toISOString();

async function openOps(page, query = '') {
  await page.goto('/ops.html' + query);
  await page.waitForFunction(() => typeof window.renderKanbanCard === 'function' && !!window.JobCloseoutOps);
}

function cards(page, rows) {
  return page.evaluate((list) => list.map((r) => renderKanbanCard(r.job, r.status)), rows);
}

const base = { id: 'f1', type: 'fencing', client_name: 'Test Client', value: 6667, days_in_stage: 2 };
const withBlock = (closeout) => Object.assign({}, base, { closeout });

test('preview off (the default): cards and status buttons are unchanged by a closeout block', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.removeItem('sw_closeout_preview'); } catch (e) {} });
  await openOps(page);
  const block = { paid_less_than_quoted: true, shortfall_inc: 10, review: { status: 'sent' }, archive_due_at: FUTURE(), held: null };
  const [plain, tagged] = await cards(page, [
    { job: base, status: 'get_review' },
    { job: withBlock(block), status: 'get_review' },
  ]);
  expect(tagged).toBe(plain);
  expect(tagged).not.toContain('closeout-tag');
  const ladder = await page.evaluate(() => ({
    fencingFinal: getNextStatuses('final_payment', 'fencing'),
    fencingReview: getNextStatuses('get_review', 'fencing'),
    fencingComplete: getNextStatuses('complete', 'fencing'),
    patioInvoiced: getNextStatuses('invoiced', 'patio'),
  }));
  expect(ladder).toEqual({
    fencingFinal: ['get_review'],
    fencingReview: ['complete'],
    fencingComplete: ['archived'],
    patioInvoiced: [],
  });
});

test('Get Review sits between Invoiced and Archived on the fencing and patio boards', async ({ page }) => {
  await openOps(page);
  const order = await page.evaluate(() => ({ fencing: FENCING_STAGES, patio: PATIO_STAGES, sm: SW_STATE_MACHINE.getStagesForType('fencing') }));
  for (const stages of [order.fencing, order.patio]) {
    const i = stages.indexOf('invoiced');
    expect(stages[i + 1]).toBe('get_review');
    expect(stages[stages.length - 1]).toBe('archived');
  }
  expect(order.sm).toContain('get_review');
  expect(await page.evaluate(() => SW_STATE_MACHINE.mapStatus('get_review').derived_view)).toBe(false);
});

test('preview on: small tags from the closeout block, the new ladder, nothing without a block', async ({ page }) => {
  await openOps(page, '?closeout=preview');
  const [short, review, none, makesafe] = await cards(page, [
    { job: withBlock({ paid_less_than_quoted: true, shortfall_inc: 5649, review: null }), status: 'invoiced' },
    { job: withBlock({ review: { status: 'not_sent', reason: 'no_contact' }, archive_due_at: FUTURE() }), status: 'get_review' },
    { job: base, status: 'get_review' },
    { job: Object.assign({}, base, { type: 'makesafe', closeout: { paid_less_than_quoted: true } }), status: 'invoiced' },
  ]);
  const tagTexts = (html) => page.evaluate((h) => {
    const d = document.createElement('div');
    d.innerHTML = h;
    return Array.from(d.querySelectorAll('.closeout-tag')).map((e) => e.textContent);
  }, html);
  expect(await tagTexts(short)).toEqual(['Paid less than quoted']);
  expect(await tagTexts(review)).toEqual(['Review not sent: no contact linked', 'Archives in 5h']);
  expect(await tagTexts(none)).toEqual([]);
  expect(await tagTexts(makesafe)).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('sw_closeout_preview'))).toBe('1');

  const ladder = await page.evaluate(() => ({
    fencingInvoiced: getNextStatuses('invoiced', 'fencing'),
    fencingReview: getNextStatuses('get_review', 'fencing'),
    patioInvoiced: getNextStatuses('invoiced', 'patio'),
    patioReview: getNextStatuses('get_review', 'patio'),
    fencingScheduled: getNextStatuses('scheduled', 'fencing'),
    repairComplete: getNextStatuses('complete', 'repair'),
  }));
  expect(ladder).toEqual({
    fencingInvoiced: ['get_review'],
    fencingReview: ['archived'],
    patioInvoiced: ['get_review'],
    patioReview: ['archived'],
    fencingScheduled: ['in_progress', 'cancelled'],
    repairComplete: ['invoiced'],
  });

  const detail = await page.evaluate(() => JobCloseoutOps.detailTagsHtml({
    job: { id: 'f1', type: 'patio', status: 'get_review' },
    closeout: { review: { status: 'sent' }, archive_due_at: null },
  }));
  expect(detail).toContain('Review sent');
  expect(await page.evaluate(() => JobCloseoutOps.detailTagsHtml({ job: { id: 'f1', type: 'patio', status: 'invoiced' } }))).toBe('');
});
