// Deposit flag on fencing and patio jobs in ops.html (modules/ops-job-deposit-flag.js).
// Runs the shipped renderKanbanCard and the job page section on the real page, with
// ops-api's clear_job_deposit_flag mocked.
const { test, expect } = require('@playwright/test');
const { installOpsSessionStub, revealOpsStaticFixture } = require('../helpers/ops-auth');

const CLEAR_ROUTE = '**/functions/v1/ops-api?action=clear_job_deposit_flag*';
const base = { id: 'f1', type: 'fencing', client_name: 'Test Client', value: 6667, days_in_stage: 2 };
const flag = { reason: 'deposit_voided', invoice_number: 'INV-1234', invoice_status: 'VOIDED', flagged_at: '2026-10-27T02:00:00Z' };

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

async function openOps(page) {
  await page.goto('/ops.html');
  await page.waitForFunction(() => typeof window.renderKanbanCard === 'function' && !!window.DepositFlagOps);
}

// Draws real cards from window.__e2eRows and the job page section from
// window.__e2eDetail, as the board and the open job page do.
async function paint(page, rows, detail) {
  await revealOpsStaticFixture(page);
  await page.evaluate(([list, d]) => {
    let host = document.getElementById('e2eDepositHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'e2eDepositHost';
      host.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;background:#fff;width:360px;';
      host.innerHTML = '<div id="e2eCards"></div><div id="e2eDetail"></div>';
      document.body.appendChild(host);
    }
    if (list) window.__e2eRows = list;
    if (d) window.__e2eDetail = d;
    document.getElementById('e2eCards').innerHTML = (window.__e2eRows || []).map((r) => renderKanbanCard(r.job, r.status)).join('');
    document.getElementById('e2eDetail').innerHTML = window.__e2eDetail ? DepositFlagOps.detailHtml(window.__e2eDetail) : '';
  }, [rows || null, detail || null]);
}

test('a card with an open flag says so; a card without one is unchanged', async ({ page }) => {
  await signIn(page);
  await openOps(page);
  const plain = await page.evaluate((j) => renderKanbanCard(j, 'order_materials'), base);
  const flagged = await page.evaluate((j) => renderKanbanCard(j, 'order_materials'), Object.assign({}, base, { deposit_flag: flag }));
  expect(plain).not.toContain('deposit-flag');
  expect(flagged).toContain('Deposit voided after move - check');
  // Only the flag was added to the card.
  expect(flagged.replace(/<div class="kanban-deposit-flag-wrap"[\s\S]*?<\/span><\/div>/, '')).toBe(plain);
});

test('job page: "couldn\'t check" when the read failed, nothing when there is no flag', async ({ page }) => {
  await signIn(page);
  await openOps(page);
  const unreadable = await page.evaluate(() => DepositFlagOps.detailHtml({ job: { id: 'f1', type: 'fencing' }, deposit_flag: null, deposit_flag_unreadable: true }));
  expect(unreadable).toContain("Deposit flag: couldn't check");
  const none = await page.evaluate(() => DepositFlagOps.detailHtml({ job: { id: 'f1', type: 'fencing' }, deposit_flag: null }));
  expect(none).toBe('');
});

test('Mark dealt with: confirms, calls clear_job_deposit_flag, and the flag leaves the card and the job page', async ({ page }) => {
  await signIn(page);
  const calls = [];
  await page.route(CLEAR_ROUTE, async (route) => {
    calls.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, job_id: 'f1', action: 'cleared' }) });
  });
  await openOps(page);
  await paint(page,
    [{ job: Object.assign({}, base, { deposit_flag: Object.assign({}, flag) }), status: 'order_materials' }],
    { job: { id: 'f1', type: 'fencing', status: 'order_materials' }, deposit_flag: Object.assign({}, flag) });

  await expect(page.locator('#e2eCards .deposit-flag')).toHaveText('Deposit voided after move - check');
  const btn = page.locator('#e2eDetail [data-deposit-flag-clear="f1"]');
  await expect(page.locator('#e2eDetail')).toContainText('Invoice INV-1234 is VOIDED');
  // Cancel at the confirm: nothing is sent and the flag stays.
  page.once('dialog', (d) => d.dismiss());
  await btn.click();
  await expect(page.locator('#e2eDetail .jd-deposit-flag')).toHaveCount(1);
  expect(calls).toHaveLength(0);
  page.once('dialog', (d) => { expect(d.message()).toContain('Mark the deposit flag as dealt with?'); expect(d.message()).not.toMatch(/[–—]/); d.accept(); });
  await btn.click();
  await expect(page.locator('#e2eDetail .jd-deposit-flag')).toHaveCount(0);
  await expect(page.locator('#e2eCards .deposit-flag')).toHaveCount(0);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ job_id: 'f1' });
  await expect(page.locator('#toastContainer')).toContainText('Deposit flag marked as dealt with.');
  expect(await page.locator('#toastContainer').innerText()).not.toMatch(/[–—]/);

  // A redraw from the same cached rows stays cleared.
  await paint(page);
  await expect(page.locator('#e2eCards .deposit-flag')).toHaveCount(0);
  await expect(page.locator('#e2eDetail .jd-deposit-flag')).toHaveCount(0);
});

test('a refused clear keeps the flag and says why in words', async ({ page }) => {
  await signIn(page);
  await page.route(CLEAR_ROUTE, (route) => route.fulfill({
    status: 503, contentType: 'application/json',
    body: JSON.stringify({ ok: false, code: 'state_unwritable', error: 'flag clear failed: boom' }),
  }));
  await openOps(page);
  await paint(page,
    [{ job: Object.assign({}, base, { deposit_flag: Object.assign({}, flag) }), status: 'order_materials' }],
    { job: { id: 'f1', type: 'fencing', status: 'order_materials' }, deposit_flag: Object.assign({}, flag) });
  page.once('dialog', (d) => d.accept());
  await page.locator('#e2eDetail [data-deposit-flag-clear="f1"]').click();
  await expect(page.locator('#toastContainer')).toContainText('The deposit flag could not be cleared. Nothing was changed.');
  await expect(page.locator('#e2eDetail [data-deposit-flag-clear="f1"]')).toBeEnabled();
  await expect(page.locator('#e2eCards .deposit-flag')).toHaveCount(1);
});

for (const [name, answer] of [
  ['the connection drops before the answer', (route) => route.abort('failed')],
  ['the answer is not one we know', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, action: 'something_else' }) })],
]) {
  test(`unknown outcome when ${name}: never says nothing was changed`, async ({ page }) => {
    await signIn(page);
    await page.route(CLEAR_ROUTE, answer);
    await openOps(page);
    await paint(page,
      [{ job: Object.assign({}, base, { deposit_flag: Object.assign({}, flag) }), status: 'order_materials' }],
      { job: { id: 'f1', type: 'fencing', status: 'order_materials' }, deposit_flag: Object.assign({}, flag) });
    page.once('dialog', (d) => d.accept());
    await page.locator('#e2eDetail [data-deposit-flag-clear="f1"]').click();
    const toast = page.locator('#toastContainer');
    await expect(toast).toContainText('Could not tell whether the deposit flag was cleared. Refresh the job to check.');
    await expect(toast).not.toContainText('Nothing was changed');
    expect(await toast.innerText()).not.toMatch(/[–—]/);
    await expect(page.locator('#e2eDetail [data-deposit-flag-clear="f1"]')).toBeEnabled();
  });
}
