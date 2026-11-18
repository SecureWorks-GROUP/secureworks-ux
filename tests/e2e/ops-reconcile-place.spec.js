// Cost lines to place (modules/ops-reconcile-place.js, P2-03.10/11 place, split and not for a job).
// Offline: opsFetch, opsPost and the signed-in office person are replaced in the page.
// Made-up ZZTEST jobs, suppliers and amounts only.
const { test, expect } = require('@playwright/test');
const { revealOpsStaticFixture } = require('../helpers/ops-auth');

const J1 = '11111111-0000-4000-8000-000000000001';
const J2 = '22222222-0000-4000-8000-000000000002';
const BILL = {
  id: 'ZZTEST-bill', kind: 'bill', card: 'cost', kind_words: 'Bill', party: 'ZZTEST Supplier', document_number: 'ZZ-100',
  document_date: '2026-11-03', amount_ex: 1000, waiting_days: 3, shown_hash: 'hash-bill', reason_words: 'One reason found',
  suggestion: { outcome: 'job', job_id: J1, job_number: 'SWF-990001', job_site: '12 Test St' },
  clues: [{ code: 'po', words: 'Order number', seen_where: 'reference', seen_value: 'PO-1', counts: true }, { code: 'ai', words: 'The AI read it', counts: false }],
  against: [], lines: [{ line_id: 'L1', description: 'Posts', amount_ex: 1000, tag: 'Fencing' }], held: null,
};
const CREDIT = {
  id: 'ZZTEST-credit', kind: 'credit', card: 'cost', kind_words: 'Credit', party: 'ZZTEST Supplier', document_number: 'CN-7',
  document_date: '2026-11-05', amount_ex: -120.5, waiting_days: 1, shown_hash: 'hash-credit', reason_words: 'No suggestion',
  suggestion: null, clues: [], against: [], lines: [{ line_id: 'C1', description: 'Returned posts', amount_ex: -120.5 }], held: null,
  bill: { document_number: 'ZZ-100', item_id: 'ZZTEST-bill', state: 'waiting' },
};
const WAITING_CREDIT = {
  ...CREDIT, id: 'ZZTEST-credit-2', document_number: 'CN-8', amount_ex: -40, shown_hash: 'hash-credit-2',
  lines: [{ line_id: 'C2', description: 'Short delivery', amount_ex: -40 }], bill: { document_number: 'ZZ-300', state: 'not_loaded' },
};
const MESSAGE = { id: 'ZZTEST-msg', kind: 'message', card: 'message', kind_words: 'Message' };

async function open(page, { url = '/ops.html?reconcile_place=1', lists = { bills: [BILL, CREDIT, WAITING_CREDIT, MESSAGE] }, decide = null } = {}) {
  await page.goto(url);
  await revealOpsStaticFixture(page);
  await page.evaluate(({ lists, decide, J2 }) => {
    const main = document.getElementById('mainApp');
    if (main) main.style.display = '';
    window.__reads = []; window.__posts = [];
    window.SECUREWORKS_CLOUD = Object.assign({}, window.SECUREWORKS_CLOUD, {
      auth: { isLoggedIn: () => true, getRole: () => 'ops_manager', getUser: () => ({ id: 'ZZTEST-office' }) },
      on() {},
    });
    window.opsFetch = (action, params) => {
      window.__reads.push({ action, params });
      if (action === 'reconcile_list') return Promise.resolve(JSON.parse(JSON.stringify({ enabled: true, items: lists[params.tab] || [] })));
      if (action === 'search_jobs') return Promise.resolve({ results: [{ id: J2, job_number: 'SWP-990002', client_name: 'Client B', site_suburb: 'ZZTEST East' }] });
      return Promise.resolve({ items: [] });
    };
    window.opsPost = (action, body) => {
      window.__posts.push({ action, body });
      if (action !== 'reconcile_decide') return Promise.resolve({});
      if (decide && decide.dropped) return Promise.reject(new TypeError('Load failed'));
      if (decide) return Promise.reject(Object.assign(new Error(decide.body.error), decide));
      return Promise.resolve({ decision_id: 'ZZTEST-decision', item_status: 'decided' });
    };
    showView('recon');
  }, { lists, decide, J2 });
  await expect(page.locator('#viewRecon')).toBeVisible();
}
const decidePosts = (page) => page.evaluate(() => window.__posts.filter((p) => p.action === 'reconcile_decide'));
const card = (page, id) => page.locator(`#reconcilePlaceRoot [data-rp-id="${id}"]`);

test('off by default: no element and no reconcile_list read', async ({ page }) => {
  await open(page, { url: '/ops.html' });
  await expect(page.locator('#reconcilePlaceRoot')).toHaveCount(0);
  expect((await page.evaluate(() => window.__reads)).filter((r) => r.action === 'reconcile_list')).toEqual([]);
});

test('lists cost items from the three cost tabs, never a message, and places the suggested job after a confirm', async ({ page }) => {
  await open(page);
  await expect(page.locator('#reconcilePlaceRoot h2')).toContainText('Cost lines to place');
  await expect(page.locator('#reconcilePlaceRoot .rp-count')).toHaveText('3 waiting');
  expect((await page.evaluate(() => window.__reads)).filter((r) => r.action === 'reconcile_list').map((r) => r.params.tab)).toEqual(['bills', 'card_bank', 'receipts']);
  await expect(card(page, 'ZZTEST-msg')).toHaveCount(0);
  const bill = card(page, 'ZZTEST-bill');
  await expect(bill.locator('[data-rp-sug]')).toHaveText('Suggested: SWF-990001, 12 Test St');
  await bill.getByText('Why, and the lines').click();
  await expect(bill).toContainText('The AI read it (a suggestion only)');
  await bill.getByRole('button', { name: 'Put on SWF-990001' }).click();
  await expect(bill.locator('[data-rp-confirm]')).toContainText('Put $1,000.00 ex GST on SWF-990001, 12 Test St.');
  expect(await decidePosts(page)).toEqual([]);
  await bill.getByRole('button', { name: 'Yes, record it' }).click();
  const recent = page.locator('#reconcilePlaceRoot .rp-recent');
  await expect(recent).toContainText('Put on SWF-990001 by you, just now.');
  await expect(recent).toContainText('To reverse one, ask the office lead.');
  await expect(recent.locator('[data-rp-decision="ZZTEST-decision"]')).toHaveCount(1);
  await expect(page.locator('#reconcilePlaceRoot').getByRole('button', { name: /Undo/ })).toHaveCount(0);
  expect((await page.evaluate(() => window.__reads)).filter((r) => r.action === 'reconcile_list').length).toBe(6);
  expect(await decidePosts(page)).toEqual([{ action: 'reconcile_decide', body: { item_id: 'ZZTEST-bill', shown_hash: 'hash-bill', action: 'place', parts: [{ job_id: J1 }], note: null, accepted_suggestion: true } }]);
});

test('a credit sits under its bill, says it follows the bill, and can be decided alone', async ({ page }) => {
  await open(page);
  const group = page.locator('#reconcilePlaceRoot [data-rp-group="ZZTEST-bill"]');
  await expect(group.locator('[data-rp-carries]')).toHaveText('Deciding this bill carries its credit below with it.');
  const credit = group.locator('.rp-credits [data-rp-id="ZZTEST-credit"]');
  await expect(credit.locator('.rp-amt')).toHaveText('Credit $120.50 ex GST');
  await expect(credit.locator('[data-rp-credit]')).toContainText('Against bill ZZ-100: the bill is still waiting for a decision.');
  await expect(credit.locator('[data-rp-bill-waiting]')).toHaveText('Decide the bill and this credit follows it. Placing it alone fixes it here.');
  await group.locator('[data-rp-id="ZZTEST-bill"]').getByRole('button', { name: 'Not for a job' }).first().click();
  await expect(group.locator('[data-rp-id="ZZTEST-bill"] [data-rp-confirm]')).toContainText('Mark $1,000.00 ex GST as not for a job (overhead). Its credit follows it.');
  await group.locator('[data-rp-id="ZZTEST-bill"]').getByRole('button', { name: 'Back' }).click();
  await credit.getByRole('button', { name: 'Not for a job' }).click();
  await expect(credit.locator('[data-rp-confirm]')).toContainText('Mark the $120.50 ex GST credit as not for a job (overhead).');
  await credit.getByRole('button', { name: 'Yes, record it' }).click();
  await expect(page.locator('#reconcilePlaceRoot .rp-recent')).toContainText('Credit marked not for a job by you, just now.');
  expect((await decidePosts(page))[0].body).toEqual({ item_id: 'ZZTEST-credit', shown_hash: 'hash-credit', action: 'overhead', parts: [], note: null, accepted_suggestion: false });
});

test('a credit whose bill has not loaded waits, with no buttons', async ({ page }) => {
  await open(page);
  const credit = card(page, 'ZZTEST-credit-2');
  await expect(credit.locator('[data-rp-credit]')).toContainText('Against bill ZZ-300: waiting for its bill to load.');
  await expect(credit).toContainText('This credit waits for its bill to load into the cost lines.');
  await expect(credit.locator('button')).toHaveCount(0);
});

test('a 403 shows the server words; a dropped connection says so and offers a re-read', async ({ page }) => {
  const words = 'Only admin, owner or ops manager can decide a Reconcile item.';
  await open(page, { decide: { status: 403, body: { error: 'operator_access_required', message: words } } });
  const bill = card(page, 'ZZTEST-bill');
  await bill.getByRole('button', { name: 'Put on SWF-990001' }).click();
  await bill.getByRole('button', { name: 'Yes, record it' }).click();
  await expect(bill.locator('.rp-msg')).toHaveText(words);
  await open(page, { decide: { dropped: true } });
  const again = card(page, 'ZZTEST-bill');
  await again.getByRole('button', { name: 'Put on SWF-990001' }).click();
  await again.getByRole('button', { name: 'Yes, record it' }).click();
  await expect(again.locator('.rp-msg')).toContainText('The connection dropped before an answer came back. This may or may not have been recorded.');
  await again.getByRole('button', { name: 'Read the list again' }).click();
  expect((await page.evaluate(() => window.__reads)).filter((r) => r.action === 'reconcile_list').length).toBe(6);
});

test('a split saves only when the line adds up, then posts exactly its parts', async ({ page }) => {
  await open(page);
  const bill = card(page, 'ZZTEST-bill');
  await bill.getByRole('button', { name: 'Split' }).click();
  await bill.getByPlaceholder('Job number, name or suburb').fill('SWP');
  await bill.getByRole('button', { name: 'Search' }).click();
  await bill.getByRole('button', { name: /SWP-990002/ }).click();
  await bill.getByRole('button', { name: 'Add a part' }).click();
  await bill.getByRole('button', { name: 'Add a part' }).click();
  await bill.getByLabel('Where part 1 goes').selectOption('job:' + J1);
  await bill.getByLabel('Amount of part 1').fill('600');
  await bill.getByLabel('Where part 2 goes').selectOption('job:' + J2);
  await bill.getByLabel('Amount of part 2').fill('300');
  await bill.getByLabel('Where part 3 goes').selectOption('overhead');
  await expect(bill.locator('[data-rp-left]')).toHaveText('Left $100.00 ex GST');
  await expect(bill.getByRole('button', { name: 'Save the split' })).toBeDisabled();
  await bill.getByLabel('Amount of part 3').fill('100');
  await expect(bill.locator('[data-rp-left]')).toHaveText('Left $0.00 ex GST');
  await expect(bill.locator('[data-rp-foot]')).toHaveText('Lines total $1,000.00 ex GST. Allocated $1,000.00 ex GST. Left $0.00 ex GST.');
  await bill.getByRole('button', { name: 'Save the split' }).click();
  await expect(bill.locator('[data-rp-confirm]')).toContainText('Split $1,000.00 ex GST: $600.00 on SWF-990001, $300.00 on SWP-990002, $100.00 not for a job.');
  await bill.getByRole('button', { name: 'Yes, record it' }).click();
  await expect(page.locator('#reconcilePlaceRoot .rp-recent')).toContainText('Split by you, just now.');
  expect((await decidePosts(page))[0].body.parts).toEqual([
    { line_id: 'L1', target: 'job', amount_ex: 600, job_id: J1 },
    { line_id: 'L1', target: 'job', amount_ex: 300, job_id: J2 },
    { line_id: 'L1', target: 'overhead', amount_ex: 100 },
  ]);
});

test('a 409 shows the server words, never the code, and reads the list again', async ({ page }) => {
  const words = 'This changed while you were looking. The list has been read again, please choose again.';
  await open(page, { decide: { status: 409, body: { error: 'reconcile_evidence_changed', message: words } } });
  const bill = card(page, 'ZZTEST-bill');
  await bill.getByRole('button', { name: 'Put on SWF-990001' }).click();
  await bill.getByRole('button', { name: 'Yes, record it' }).click();
  await expect(card(page, 'ZZTEST-bill').locator('.rp-msg')).toHaveText(words);
  await expect(page.locator('#reconcilePlaceRoot')).not.toContainText('reconcile_evidence_changed');
  expect((await page.evaluate(() => window.__reads)).filter((r) => r.action === 'reconcile_list').length).toBe(6);
});

test('the page never scrolls sideways with the split panel open', async ({ page }) => {
  await open(page);
  await card(page, 'ZZTEST-bill').getByRole('button', { name: 'Split' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
