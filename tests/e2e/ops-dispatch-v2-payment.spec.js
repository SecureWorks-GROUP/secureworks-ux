// Dispatch v2 piece B (Oct 2026): the payment step on a supplier box, against
// a stubbed ops-api that keeps its own state the way the backend contract
// section 3c says (secureworks-backend branch dispatch/payment-step-a).
// Nothing leaves: every read and write is answered by the stub, and each
// write is checked for its exact body.
//
//  - Mark paid and Undo paid on a pay-first box: one press each, guarded on
//    the paid stamp the box showed, a 409 paid_changed refreshing the box.
//  - An on-account box has no payment buttons.
//  - An older ops-api (none of the new fields) shows no payment buttons at
//    all: the screen is today's.
// Supplier names, the client and the job number are made up.
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { installOpsSessionStub } = require('../helpers/ops-auth');
const { V2_ANSWER, V2_EMPTY_READS } = require('../helpers/dispatch-v2-board');
const { JOB_ID, JOB_NUMBER, SID, BOX, fakePayment } = require('../helpers/dispatch-v2-payment');

const OPS_FILE = 'file://' + path.resolve(__dirname, '..', '..', 'ops.html');

// Boots Ops on Dispatch with ops-api stubbed; the one job opens on its own.
async function boot(page, fake, { viewport = { width: 1440, height: 900 }, api = {} } = {}) {
  const calls = [];
  const handlers = Object.assign({
    job_detail: () => ({ job: { id: JOB_ID, job_number: JOB_NUMBER, type: 'repair', scope_json: null, ghl_contact_id: null }, media: [], documents: [], invoices: [] }),
    job_notes: () => ({ job_id: JOB_ID, total: 0, notes: [] }),
    list_pos: () => ({ purchase_orders: [] }),
    ...V2_EMPTY_READS,
  }, fake.api, api);
  await page.setViewportSize(viewport);
  await installOpsSessionStub(page);
  await page.route('**/*', async (route) => {
    const request = route.request();
    const raw = request.url();
    if (raw.startsWith('file://')) return route.continue();
    const url = new URL(raw);
    const action = /\/functions\/v1\/ops-api$/.test(url.pathname) ? url.searchParams.get('action') : null;
    if (!action) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    const body = request.method() === 'POST' ? JSON.parse(request.postData() || '{}') : null;
    calls.push({ action, method: request.method(), url, body });
    const view = url.searchParams.get('view') || 'active';
    const key = action === 'pipeline' && view === 'archive' ? 'archive' : action;
    const out = key === 'archive' ? { columns: {}, total: 0 } : handlers[key] ? await handlers[key](url, body) : {};
    const wrapped = out && typeof out === 'object' && typeof out.status === 'number' && 'body' in out;
    let reply = wrapped ? out.body : out;
    if (action === 'pipeline' && (!wrapped || out.status < 300)) reply = V2_ANSWER(reply, view);
    return route.fulfill({ status: wrapped ? out.status : 200, contentType: 'application/json', body: JSON.stringify(reply) });
  });
  await page.goto(OPS_FILE + '#dispatch');
  await expect(page.locator('#viewDispatch')).toHaveClass(/active/);
  const root = page.locator('#dispatchRoot');
  const mat = root.locator('[data-dpc-region="v2mat"]');
  await expect(mat.locator('.dpc-v2-box').first()).toBeVisible();
  const of = (action) => calls.filter((c) => c.action === action);
  const writes = () => calls.filter((c) => c.method === 'POST' && /^dispatch_/.test(c.action));
  return { calls, of, root, mat, writes };
}

const boxOf = (mat, name) => mat.locator('.dpc-v2-box', { has: mat.page().locator('.dpc-suphead strong', { hasText: name }) });
// The body a write sent, without the operator stamp opsPost adds itself.
const sent = (c) => { const b = Object.assign({}, c.body); delete b.operator_email; return b; };
const NO_DASH = /[–—]/;

test.describe('Dispatch v2 payment step: Mark paid and Undo paid', () => {
  test('a pay-first box offers Mark paid; one press records it, shows who and when, and offers Undo paid', async ({ page }) => {
    const fake = fakePayment();
    const { mat, of } = await boot(page, fake);
    const box = boxOf(mat, 'Lysaght');
    const pay = box.locator('.dpc-v2-pay');
    await expect(pay.locator('.dpc-v2-paybtn')).toHaveText('Mark paid');
    await expect(pay).toContainText('Moves it to Order confirmed and records who paid and when.');
    await expect(boxOf(mat, 'Twinside Retaining').locator('.dpc-v2-paybtn')).toHaveText('Mark paid');

    await pay.locator('.dpc-v2-paybtn').click();
    await expect(box).toContainText('Marked paid: Lysaght. This is a record only: nobody was paid and nothing was sent.');
    await expect(box.locator('.dpc-v2-paid')).toContainText('Paid, marked by shaun@ops.test');
    await expect(box.locator('[data-dpc-v2="unpaid"]')).toHaveText('Undo paid');
    await expect(box.locator('.dpc-v2-paybtn')).toHaveCount(0);
    // Sent once, for that box, guarded on "never marked paid".
    expect(of('dispatch_v2_mark_paid').map(sent)).toEqual([{ box_id: BOX(1), expected_paid_at: null }]);
    expect(of('dispatch_v2_mark_paid')[0].body.operator_email).toBeTruthy();
    // The other box is untouched, and the job was never moved.
    await expect(boxOf(mat, 'Twinside Retaining').locator('.dpc-v2-paybtn')).toHaveText('Mark paid');
    expect(of('update_repair_stage').concat(of('update_job_status'))).toEqual([]);
    expect(await box.innerText()).not.toMatch(NO_DASH);
  });

  test('Undo paid takes the mark off, guarded on the stamp it showed', async ({ page }) => {
    const fake = fakePayment({ lysaght: { paid: { at: '2026-10-29T06:40:00.000Z', by: 'nithin@ops.test' } } });
    const { mat, of } = await boot(page, fake);
    const box = boxOf(mat, 'Lysaght');
    await expect(box.locator('.dpc-v2-paid')).toContainText('Paid, marked by nithin@ops.test');
    await box.locator('[data-dpc-v2="unpaid"]').click();
    await expect(box).toContainText('Paid mark taken off: Lysaght.');
    await expect(box.locator('.dpc-v2-paybtn')).toHaveText('Mark paid');
    expect(of('dispatch_v2_undo_paid').map(sent)).toEqual([{ box_id: BOX(1), expected_paid_at: '2026-10-29T06:40:00.000Z' }]);
  });

  test('a mark changed somewhere else (409 paid_changed) says so plainly and shows the latest', async ({ page }) => {
    const fake = fakePayment();
    const { mat, of } = await boot(page, fake);
    const box = boxOf(mat, 'Lysaght');
    await expect(box.locator('.dpc-v2-paybtn')).toBeVisible();
    // Someone else marks it paid while this screen still shows Mark paid.
    fake.boxes[0].paid = { at: '2026-10-29T06:30:00.000Z', by: 'nithin@ops.test' };
    await box.locator('.dpc-v2-paybtn').click();
    await expect(mat).toContainText('The paid mark on Lysaght was changed somewhere else. Showing the latest.');
    await expect(box.locator('.dpc-v2-paid')).toContainText('Paid, marked by nithin@ops.test');
    await expect(box.locator('.dpc-v2-paybtn')).toHaveCount(0);
    expect(of('dispatch_v2_mark_paid')).toHaveLength(1);
  });

  test('a failed press keeps the box as it was and offers Retry, which sends the same press', async ({ page }) => {
    const fake = fakePayment();
    fake.fail.dispatch_v2_mark_paid = [{ status: 500, body: { error: 'e2e', code: 'dispatch_write_failed' } }];
    const { mat, of } = await boot(page, fake);
    const box = boxOf(mat, 'Lysaght');
    await box.locator('.dpc-v2-paybtn').click();
    await expect(box.locator('.dpc-mat-fail')).toContainText('Not marked paid.');
    await expect(box.locator('.dpc-v2-paybtn')).toHaveText('Mark paid');
    await box.locator('.dpc-mat-fail .dpc-retry').click();
    await expect(box.locator('.dpc-v2-paid')).toContainText('Paid, marked by shaun@ops.test');
    expect(of('dispatch_v2_mark_paid').map(sent)).toEqual([{ box_id: BOX(1), expected_paid_at: null }, { box_id: BOX(1), expected_paid_at: null }]);
  });

  test('an on-account box has no Mark paid', async ({ page }) => {
    const fake = fakePayment({ onAccount: true });
    const { mat } = await boot(page, fake);
    const box = boxOf(mat, 'Stratco WA');
    await expect(box).toBeVisible();
    await expect(box.locator('[data-dpc-v2="paid"], [data-dpc-v2="unpaid"]')).toHaveCount(0);
  });

  test('an older ops-api with none of the new fields shows no payment buttons', async ({ page }) => {
    const fake = fakePayment({ old: true, onAccount: true });
    const { mat, writes } = await boot(page, fake);
    await expect(mat.locator('.dpc-v2-box')).toHaveCount(3);
    await expect(mat.locator('.dpc-v2-pay')).toHaveCount(0);
    await expect(mat.locator('.dpc-v2-paid')).toHaveCount(0);
    await expect(mat).not.toContainText('Mark paid');
    await expect(mat).not.toContainText('Undo paid');
    expect(writes().filter((c) => c.action !== 'operator_heartbeat')).toEqual([]);
    expect(SID(1)).toBeTruthy();
  });
});

test.describe('Dispatch v2 payment step: the Not paid yet pill', () => {
  test('an unpaid pay-first order says Not paid yet on its box, its Deliveries row and the Arrival line; Paid once marked', async ({ page }) => {
    const fake = fakePayment({ onAccount: true });
    const { root, mat } = await boot(page, fake);
    const box = boxOf(mat, 'Lysaght');
    const deliv = root.locator('[data-dpc-deliv-box="' + SID(1) + '"]');
    const arr = root.locator('[data-dpc-region="arrival"] .dpc-arr-list li', { hasText: 'Lysaght' });
    await expect(box.locator('.dpc-v2-stage .dpc-paypill')).toHaveText('Not paid yet');
    await expect(deliv.locator('.dpc-paypill')).toHaveText('Not paid yet');
    await expect(arr.locator('.dpc-paypill')).toHaveText('Not paid yet');
    // On the line itself, under the order's marker (the list is for narrow screens).
    const mark = root.locator('[data-dpc-region="arrival"] .dpc-arr-mk', { hasText: 'Lysaght' });
    await expect(mark.locator('.dpc-paypill')).toBeVisible();
    await expect(mark.locator('.dpc-paypill')).toHaveText('Not paid yet');
    // Twinside has no date yet: the pill sits beside "No date yet".
    await expect(root.locator('[data-dpc-deliv-box="' + SID(2) + '"] .dpc-paypill')).toHaveText('Not paid yet');
    // On account: no pill anywhere.
    await expect(boxOf(mat, 'Stratco WA').locator('.dpc-paypill')).toHaveCount(0);
    await expect(root.locator('[data-dpc-deliv-box="' + SID(3) + '"] .dpc-paypill')).toHaveCount(0);
    await expect(root.locator('[data-dpc-region="arrival"] .dpc-arr-list li', { hasText: 'Stratco WA' }).locator('.dpc-paypill')).toHaveCount(0);

    await box.locator('.dpc-v2-paybtn').click();
    await expect(box.locator('.dpc-v2-stage .dpc-paypill')).toHaveText('Paid');
    await expect(deliv.locator('.dpc-paypill')).toHaveText('Paid');
    await expect(arr.locator('.dpc-paypill')).toHaveText('Paid');
    await expect(mark.locator('.dpc-paypill')).toHaveText('Paid');
    await expect(root.locator('[data-dpc-deliv-box="' + SID(2) + '"] .dpc-paypill')).toHaveText('Not paid yet');
  });

  test('an older ops-api shows no payment pill anywhere', async ({ page }) => {
    const fake = fakePayment({ old: true });
    const { root } = await boot(page, fake);
    await expect(root.locator('[data-dpc-deliv-box="' + SID(1) + '"]')).toBeVisible();
    await expect(root.locator('.dpc-paypill')).toHaveCount(0);
    await expect(root).not.toContainText('Not paid yet');
  });
});

test.describe('Dispatch v2 payment step: Pay on pickup or delivery', () => {
  test('Pay on pickup confirms the order without paying, shows a tag with who set it, and Take off clears it', async ({ page }) => {
    const fake = fakePayment();
    const { root, mat, of } = await boot(page, fake);
    const box = boxOf(mat, 'Lysaght');
    // The box goes out for pickup, so the button says pickup.
    await expect(box.locator('[data-dpc-v2="payon"]')).toHaveText('Pay on pickup');
    await box.locator('[data-dpc-v2="payon"]').click();
    await expect(box).toContainText('Pay on pickup set: Lysaght. The order counts as confirmed. Nothing was paid or sent.');
    const tag = box.locator('.dpc-v2-payon-set');
    await expect(tag.locator('.dpc-flag-payon')).toHaveText('Pay on pickup');
    await expect(tag).toContainText('Set by shaun@ops.test');
    // The tag shows once on the box (its own row, no pill beside the stage);
    // Deliveries and the Arrival line show it as their pill.
    await expect(box.locator('.dpc-flag-payon')).toHaveCount(1);
    await expect(root.locator('[data-dpc-deliv-box="' + SID(1) + '"] .dpc-paypill')).toHaveText('Pay on pickup');
    await expect(root.locator('[data-dpc-region="arrival"] .dpc-arr-list li', { hasText: 'Lysaght' }).locator('.dpc-paypill')).toHaveText('Pay on pickup');
    // Mark paid can still be pressed on the day they pay.
    await expect(box.locator('.dpc-v2-paybtn')).toHaveText('Mark paid');
    await expect(box.locator('.dpc-v2-pay [data-dpc-v2="payon"][data-dpc-v2-payon="pickup"]')).toHaveCount(0);
    const setAt = fake.boxes[0].payOn.at;

    await tag.locator('[data-dpc-v2="payon"]').click();
    await expect(box).toContainText('Pay on tag taken off: Lysaght.');
    await expect(box.locator('.dpc-v2-payon-set')).toHaveCount(0);
    await expect(box.locator('.dpc-v2-stage .dpc-paypill')).toHaveText('Not paid yet');
    expect(of('dispatch_v2_set_pay_on').map(sent)).toEqual([
      { box_id: BOX(1), pay_on: 'pickup', expected_set_at: null },
      { box_id: BOX(1), pay_on: null, expected_set_at: setAt },
    ]);
    expect(of('update_repair_stage').concat(of('update_job_status'))).toEqual([]);
  });

  test('a delivery box says Pay on delivery', async ({ page }) => {
    const fake = fakePayment({ onAccount: true, twinside: { fulfilment: 'delivery' } });
    const { mat, of } = await boot(page, fake);
    const box = boxOf(mat, 'Twinside Retaining');
    await expect(box.locator('[data-dpc-v2="payon"]')).toHaveText('Pay on delivery');
    await box.locator('[data-dpc-v2="payon"]').click();
    await expect(box.locator('.dpc-v2-payon-set .dpc-flag-payon')).toHaveText('Pay on delivery');
    expect(of('dispatch_v2_set_pay_on').map(sent)).toEqual([{ box_id: BOX(2), pay_on: 'delivery', expected_set_at: null }]);
  });

  test('a tag changed somewhere else (409 pay_on_changed) says so and shows the latest', async ({ page }) => {
    const fake = fakePayment();
    const { mat } = await boot(page, fake);
    const box = boxOf(mat, 'Lysaght');
    await expect(box.locator('[data-dpc-v2="payon"]')).toBeVisible();
    fake.boxes[0].payOn = { v: 'pickup', at: '2026-10-29T06:20:00.000Z', by: 'nithin@ops.test' };
    await box.locator('[data-dpc-v2="payon"]').click();
    await expect(mat).toContainText('The pay on tag on Lysaght was changed somewhere else. Showing the latest.');
    await expect(box.locator('.dpc-v2-payon-set')).toContainText('Set by nithin@ops.test');
  });

  test('an older ops-api offers no Pay on button', async ({ page }) => {
    const { mat } = await boot(page, fakePayment({ old: true }));
    await expect(mat.locator('.dpc-v2-box')).toHaveCount(2);
    await expect(mat.locator('[data-dpc-v2="payon"]')).toHaveCount(0);
    await expect(mat).not.toContainText('Pay on');
  });
});

test.describe('Dispatch v2 payment step: Mark paid moves the stage', () => {
  test('a box moved by Mark paid says so on its stage line', async ({ page }) => {
    const { mat } = await boot(page, fakePayment());
    const box = boxOf(mat, 'Lysaght');
    await box.locator('.dpc-v2-paybtn').click();
    await expect(box.locator('[data-dpc-v2-stage]')).toHaveValue('order_confirmed');
    await expect(box.locator('.dpc-v2-stage .dpc-v2-stage-who')).toContainText('Moved here when marked paid, ');
  });
});

test.describe('Dispatch v2 payment step: Pay on moves the stage, on any box', () => {
  test('a box moved by Pay on says so on its stage line', async ({ page }) => {
    const { mat } = await boot(page, fakePayment());
    const two = boxOf(mat, 'Twinside Retaining');
    await two.locator('[data-dpc-v2="payon"]').click();
    await expect(two.locator('.dpc-v2-stage .dpc-v2-stage-who')).toContainText('Moved here by Pay on pickup, ');
    // Twinside has no date yet: confirmed, waiting on the supplier for one.
    await expect(two.locator('.dpc-v2-stage-next')).toHaveText('Next: Waiting on Twinside Retaining for a date');
  });

  test('an on-account box can be set to pay on delivery too, with no Mark paid', async ({ page }) => {
    const { mat, of } = await boot(page, fakePayment({ onAccount: true }));
    const box = boxOf(mat, 'Stratco WA');
    await expect(box.locator('[data-dpc-v2="paid"]')).toHaveCount(0);
    await expect(box.locator('[data-dpc-v2="payon"]')).toHaveText('Pay on delivery');
    await expect(box.locator('.dpc-v2-pay small')).toHaveText('Confirms the order now and records who set it. A record only: it pays nobody and sends nothing.');
    await box.locator('[data-dpc-v2="payon"]').click();
    await expect(box.locator('.dpc-v2-payon-set .dpc-flag-payon')).toHaveText('Pay on delivery');
    await expect(box.locator('.dpc-flag-payon')).toHaveCount(1);
    expect(of('dispatch_v2_set_pay_on').map(sent)).toEqual([{ box_id: BOX(3), pay_on: 'delivery', expected_set_at: null }]);
  });
});
