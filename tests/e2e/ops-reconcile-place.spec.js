// Cost lines to place (modules/ops-reconcile-place.js, P2-03.10/11 place, split and not for a job).
// Offline: opsFetch, opsPost and the signed-in office person are replaced in the page.
// Made-up ZZTEST jobs, suppliers and amounts only. Items follow backend #1675's reconcile_list answer.
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
  bill: { document_id: 'doc-100', document_number: 'ZZ-100', item_id: 'ZZTEST-bill', state: 'waiting', job_id: null, job_number: null, job_site: null, division: null },
};
CREDIT.bills = [CREDIT.bill];
const WAITING_CREDIT = {
  ...CREDIT, id: 'ZZTEST-credit-2', document_number: 'CN-8', amount_ex: -40, shown_hash: 'hash-credit-2',
  lines: [{ line_id: 'C2', description: 'Short delivery', amount_ex: -40 }], bill: { document_id: 'doc-300', document_number: 'ZZ-300', item_id: null, state: 'not_loaded', job_id: null, job_number: null, job_site: null, division: null },
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
      if (action === 'reconcile_list') {
        if (lists.off) return Promise.resolve({ ok: true, enabled: false });
        return Promise.resolve(JSON.parse(JSON.stringify({ ok: true, enabled: true, tab: params.tab, items: lists[params.tab] || [], counts: { bills: (lists.bills || []).length, card_bank: 0, receipts: 0 }, next: null })));
      }
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
  await expect(group.locator('[data-rp-carries]')).toHaveText('Deciding this bill carries these credits');
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
  await expect(bill.locator('[data-rp-foot]')).toHaveText('Lines total $1,000.00 ex GST. Allocated $1,000.00 ex GST. Every line is placed.');
  await bill.getByRole('button', { name: 'Save the split' }).click();
  await expect(bill.locator('[data-rp-confirm]')).toContainText('Split $1,000.00 ex GST: Posts, $600.00 ex GST on SWF-990001; Posts, $300.00 ex GST on SWP-990002; Posts, $100.00 ex GST not for a job (overhead).');
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

test('switched off on the server reads as switched off, not as an error', async ({ page }) => {
  await open(page, { lists: { off: true } });
  await expect(page.locator('#reconcilePlaceRoot [data-rp-off]')).toHaveText('The cost line list is not switched on yet. Nothing here is placed until it is.');
  await expect(page.locator('#reconcilePlaceRoot .rp-msg')).toHaveCount(0);
});

test('a credit shared by two bills shows in full under the first and marked under the second', async ({ page }) => {
  const bill2 = { ...BILL, id: 'ZZTEST-bill-2', document_number: 'ZZ-200', shown_hash: 'hash-bill-2', amount_ex: 500, lines: [{ line_id: 'L2', description: 'Rails', amount_ex: 500 }] };
  const shared = {
    ...CREDIT, id: 'ZZTEST-shared', document_number: 'CN-9', amount_ex: -50, shown_hash: 'hash-shared',
    lines: [{ line_id: 'C9', description: 'Rebate', amount_ex: -50 }], bill: { several: true },
    bills: [{ ...CREDIT.bill }, { ...CREDIT.bill, document_id: 'doc-200', document_number: 'ZZ-200', item_id: 'ZZTEST-bill-2' }],
  };
  await open(page, { lists: { bills: [BILL, bill2, shared] } });
  const first = page.locator('#reconcilePlaceRoot [data-rp-group="ZZTEST-bill"]');
  const second = page.locator('#reconcilePlaceRoot [data-rp-group="ZZTEST-bill-2"]');
  await expect(first.locator('[data-rp-id="ZZTEST-shared"] [data-rp-credit]')).toContainText('Shared by 2 bills: ZZ-100 (still waiting for a decision), ZZ-200 (still waiting for a decision).');
  await expect(first.locator('[data-rp-id="ZZTEST-shared"] [data-rp-shared-mark]')).toContainText('This credit follows more than one bill.');
  await expect(second.locator('[data-rp-shared="ZZTEST-shared"]')).toContainText('Credit, shared ZZTEST Supplier CN-9, Credit $50.00 ex GST. Shown in full under bill ZZ-100.');
  await expect(page.locator('#reconcilePlaceRoot [data-rp-id="ZZTEST-shared"]')).toHaveCount(1);
  await expect(page.locator('#reconcilePlaceRoot .rp-count')).toHaveText('3 waiting');
});

test('a bill shows the credits that follow it, read only, each a credit ex GST (backend #1678)', async ({ page }) => {
  const bill = { ...BILL, credits: [{ document_id: 'doc-cn1', document_number: 'CN-1', is_credit: true, amount_ex: 120.5, lines: [{ line_id: 'c1', description: 'Returned posts', amount_ex: 120.5, state: 'placed' }] }] };
  await open(page, { lists: { bills: [bill] } });
  const block = page.locator('#reconcilePlaceRoot [data-rp-bill-credits]');
  await expect(block.locator('[data-rp-carries]')).toHaveText('Deciding this bill carries these credits');
  await expect(block).toContainText('CN-1, Credit $120.50 ex GST');
  await expect(block).toContainText('Returned posts, Credit $120.50 ex GST');
  await expect(block.locator('button')).toHaveCount(0);
  await expect(page.locator('#reconcilePlaceRoot .rp-count')).toHaveText('1 waiting');
});

test('a credit with its own card and in its bill credits list shows once under the bill', async ({ page }) => {
  const own = { ...CREDIT, id: 'ZZTEST-cn7', document_number: 'CN-7', shown_hash: 'hash-cn7', amount_ex: -80, lines: [{ line_id: 'C7', description: 'Returned rails', amount_ex: -80 }] };
  const bill = { ...BILL, credits: [
    { document_id: 'doc-cn7', document_number: 'CN-7', is_credit: true, amount_ex: 80, lines: [{ line_id: 'C7', description: 'Returned rails', amount_ex: 80, state: 'needs_person' }] },
    { document_id: 'doc-cn8', document_number: 'CN-8', is_credit: true, amount_ex: 15, lines: [{ line_id: 'C8', description: 'Freight', amount_ex: 15, state: 'placed' }] },
  ] };
  await open(page, { lists: { bills: [bill, own] } });
  const group = page.locator('#reconcilePlaceRoot [data-rp-group="ZZTEST-bill"]');
  await expect(group.getByText('CN-7', { exact: false })).toHaveCount(1);
  await expect(group.locator('[data-rp-bill-credits]')).toContainText('CN-8, Credit $15.00 ex GST');
  await expect(group.locator('[data-rp-bill-credits]')).not.toContainText('CN-7');
  await expect(group.locator('[data-rp-id="ZZTEST-cn7"]')).toHaveCount(1);
});

test('a bill with a discount line: each line checked on its own, signed totals, parts read by their sign', async ({ page }) => {
  const mixed = { ...BILL, amount_ex: 90, lines: [{ line_id: 'L1', description: 'Posts', amount_ex: 100 }, { line_id: 'L2', description: 'Discount', amount_ex: -10 }] };
  await open(page, { lists: { bills: [mixed] } });
  const bill = card(page, 'ZZTEST-bill');
  await bill.getByRole('button', { name: 'Split' }).click();
  const posts = bill.locator('[data-rp-line="0"]'), discount = bill.locator('[data-rp-line="1"]');
  await expect(discount.locator('.rp-line-head')).toHaveText('Discount, Credit $10.00 ex GST');
  await posts.getByLabel('Where part 1 goes').selectOption('job:' + J1);
  await posts.getByLabel('Amount of part 1').fill('110');
  await discount.getByLabel('Where part 1 goes').selectOption('job:' + J1);
  await discount.getByLabel('Amount of part 1').fill('20');
  await expect(posts.locator('[data-rp-left]')).toHaveText('Over by $10.00 ex GST');
  await expect(discount.locator('[data-rp-left]')).toHaveText('Over by $10.00 ex GST');
  await expect(bill.locator('[data-rp-foot]')).toHaveText('Lines total $90.00 ex GST. Allocated $90.00 ex GST. 2 lines are not fully placed yet.');
  await expect(bill.getByRole('button', { name: 'Save the split' })).toBeDisabled();
  await posts.getByLabel('Amount of part 1').fill('100');
  await discount.getByLabel('Amount of part 1').fill('10');
  await expect(bill.locator('[data-rp-foot]')).toHaveText('Lines total $90.00 ex GST. Allocated $90.00 ex GST. Every line is placed.');
  await bill.getByRole('button', { name: 'Save the split' }).click();
  await expect(bill.locator('[data-rp-confirm]')).toContainText('Split $90.00 ex GST: Posts, $100.00 ex GST on SWF-990001; Discount, take $10.00 ex GST off SWF-990001.');
  await bill.getByRole('button', { name: 'Yes, record it' }).click();
  await expect(page.locator('#reconcilePlaceRoot .rp-recent')).toContainText('Split by you, just now.');
  expect((await decidePosts(page))[0].body.parts).toEqual([
    { line_id: 'L1', target: 'job', amount_ex: 100, job_id: J1 },
    { line_id: 'L2', target: 'job', amount_ex: -10, job_id: J1 },
  ]);
});
