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

// ── Review text switch: the real page, ops-api's set_review_opt_out mocked ──
const { installOpsSessionStub, revealOpsStaticFixture } = require('../helpers/ops-auth');

const OPT_OUT_ROUTE = '**/functions/v1/ops-api?action=set_review_opt_out*';

// A signed-in operator, so opsPost reaches the mocked action. The CDN scripts are
// stubbed so the real supabase-js never replaces the session stub.
async function signIn(page) {
  await installOpsSessionStub(page);
  for (const pattern of [
    'https://cdn.jsdelivr.net/npm/chart.js@4',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
    'https://cdnjs.cloudflare.com/**',
  ]) {
    await page.route(pattern, (route) => route.fulfill({
      status: 200, contentType: 'application/javascript',
      body: 'window.jspdf = window.jspdf || {}; window.Chart = window.Chart || function () {};',
    }));
  }
}

// Draws real cards into the page and returns the toggle on the given card.
async function drawCards(page, rows) {
  await revealOpsStaticFixture(page);
  await page.evaluate((list) => {
    let host = document.getElementById('e2eCloseoutHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'e2eCloseoutHost';
      host.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;background:#fff;width:320px;';
      document.body.appendChild(host);
    }
    host.innerHTML = list.map((r) => renderKanbanCard(r.job, r.status)).join('');
  }, rows);
}

const reviewRow = (extra) => Object.assign({}, base, extra);

test('review switch: hidden with the preview off, outside Complete to Get Review, and when the field is absent', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.removeItem('sw_closeout_preview'); } catch (e) {} });
  await openOps(page);
  const [off] = await cards(page, [{ job: reviewRow({ review_opt_out: false }), status: 'invoiced' }]);
  expect(off).not.toContain('closeout-review-toggle');

  await page.goto('/ops.html?closeout=preview');
  await page.waitForFunction(() => typeof window.renderKanbanCard === 'function' && !!window.JobCloseoutOps);
  const [noField, early, makesafe, invoiced, complete, final, review] = await cards(page, [
    { job: base, status: 'invoiced' },
    { job: reviewRow({ review_opt_out: false }), status: 'scheduled' },
    { job: reviewRow({ type: 'makesafe', review_opt_out: false }), status: 'invoiced' },
    { job: reviewRow({ review_opt_out: false }), status: 'invoiced' },
    { job: reviewRow({ review_opt_out: false }), status: 'complete' },
    { job: reviewRow({ review_opt_out: false }), status: 'final_payment' },
    { job: reviewRow({ type: 'patio', review_opt_out: false }), status: 'get_review' },
  ]);
  for (const html of [noField, early, makesafe]) expect(html).not.toContain('closeout-review-toggle');
  for (const html of [invoiced, complete, final, review]) expect(html).toContain('data-review-toggle="f1"');
});

test('review switch: turning it off calls set_review_opt_out, then shows who and when', async ({ page }) => {
  await signIn(page);
  const calls = [];
  await page.route(OPT_OUT_ROUTE, async (route) => {
    const body = route.request().postDataJSON();
    calls.push(body);
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        success: true, review_opt_out: body.opt_out,
        review_opt_out_at: body.opt_out ? '2026-10-20T02:05:00Z' : null,
        review_opt_out_by: body.opt_out ? 'ops-e2e@example.test' : null,
      }),
    });
  });
  await openOps(page, '?closeout=preview');
  await drawCards(page, [{ job: reviewRow({ review_opt_out: false }), status: 'invoiced' }]);

  const toggle = page.locator('#e2eCloseoutHost [data-review-toggle="f1"]');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(toggle).toHaveText('Review text on');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(toggle).toHaveText('Review text off');
  await expect(toggle).toHaveAttribute('title', /Turned off by ops-e2e@example\.test on 20 Oct 2026, 10:05am/);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ job_id: 'f1', opt_out: true });
  // The click stayed on the switch: the job page did not open.
  await expect(page.locator('#e2eCloseoutHost .kanban-card')).toHaveCount(1);

  // A board redraw from the old feed row keeps the answer until a read agrees.
  await drawCards(page, [{ job: reviewRow({ review_opt_out: false }), status: 'invoiced' }]);
  await expect(toggle).toHaveAttribute('aria-checked', 'false');

  // A later read that agrees drops the answer, so the next read from another
  // operator's change shows through.
  await drawCards(page, [{ job: reviewRow({ review_opt_out: true }), status: 'invoiced' }]);
  await drawCards(page, [{ job: reviewRow({ review_opt_out: false }), status: 'invoiced' }]);
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await drawCards(page, [{ job: reviewRow({ review_opt_out: true }), status: 'invoiced' }]);

  // The job page names who and when in words.
  const detail = await page.evaluate(() => JobCloseoutOps.detailTagsHtml({
    job: { id: 'f1', type: 'fencing', status: 'invoiced', review_opt_out: true,
      review_opt_out_at: '2026-10-20T02:05:00Z', review_opt_out_by: 'ops-e2e@example.test' },
  }));
  expect(detail).toContain('Turned off by ops-e2e@example.test on 20 Oct 2026, 10:05am');
  // Review keys beside the job, not on it, are not read.
  expect(await page.evaluate(() => JobCloseoutOps.detailTagsHtml({
    job: { id: 'd2', type: 'fencing', status: 'invoiced' }, review_opt_out: true,
  }))).not.toContain('closeout-review-toggle');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  expect(calls[1]).toMatchObject({ job_id: 'f1', opt_out: false });
});

test('review switch: a claim locks it, and a 409 review_already_sent locks it the same way', async ({ page }) => {
  await signIn(page);
  let hits = 0;
  await page.route(OPT_OUT_ROUTE, async (route) => {
    hits += 1;
    await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'review_already_sent' }) });
  });
  await openOps(page, '?closeout=preview');
  await drawCards(page, [
    { job: reviewRow({ id: 's1', review_opt_out: false, review_claim_status: 'sent' }), status: 'get_review' },
    { job: reviewRow({ id: 'r1', review_opt_out: false }), status: 'get_review' },
  ]);

  const sent = page.locator('#e2eCloseoutHost [data-review-toggle="s1"]');
  await expect(sent).toBeDisabled();
  await expect(sent).toHaveText('Review text sent');

  const racing = page.locator('#e2eCloseoutHost [data-review-toggle="r1"]');
  await racing.click();
  await expect(racing).toBeDisabled();
  await expect(racing).toHaveText('Review text sent');
  await expect(page.locator('#toastContainer')).toContainText('The review text has already gone out, so it can no longer be stopped.');
  expect(hits).toBe(1);
});

test('review switch: a 409 for any other conflict leaves it as it was', async ({ page }) => {
  await signIn(page);
  await page.route(OPT_OUT_ROUTE, (route) => route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"some_other_conflict"}' }));
  await openOps(page, '?closeout=preview');
  await drawCards(page, [{ job: reviewRow({ review_opt_out: false }), status: 'invoiced' }]);
  const toggle = page.locator('#e2eCloseoutHost [data-review-toggle="f1"]');
  await toggle.click();
  await expect(page.locator('#toastContainer')).toContainText('could not be changed. Nothing was changed.');
  await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveText('Review text on');
});

test('review switch: any other failure leaves it as it was and says so', async ({ page }) => {
  await signIn(page);
  await page.route(OPT_OUT_ROUTE, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }));
  await openOps(page, '?closeout=preview');
  await drawCards(page, [{ job: reviewRow({ review_opt_out: false }), status: 'complete' }]);
  const toggle = page.locator('#e2eCloseoutHost [data-review-toggle="f1"]');
  await toggle.click();
  await expect(page.locator('#toastContainer')).toContainText('could not be changed. Nothing was changed.');
  await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
});
