// Dispatch v2 piece D (Oct 2026): ASAP or Pick a date on each supplier box
// and the merged Materials panel on the job, against a stubbed ops-api that
// keeps its own state the way the backend contract section 3c says
// (secureworks-backend branches dispatch/payment-step-a and dispatch/asap-c).
// Nothing leaves: every read and write is answered by the stub.
//
// Every test has an older ops-api twin (none of the new fields): the screen
// must then be today's.
// Supplier names, the client and the job number are made up.
const { test, expect } = require('@playwright/test');
const { BOX, SID, dayFrom, fakePayment, boot, boxOf, sent } = require('../helpers/dispatch-v2-payment');

const NO_DASH = /[–—]/;

test.describe('Dispatch v2: ASAP or Pick a date', () => {
  test('a new box starts on ASAP: the calendar is greyed out and Make email asks for Date: ASAP', async ({ page }) => {
    const fake = fakePayment({ fresh: true });
    const { mat, of } = await boot(page, fake);
    const box = boxOf(mat, 'Metroll');
    const seg = box.locator('.dpc-v2-seg');
    await expect(seg.locator('button')).toHaveText(['ASAP', 'Pick a date']);
    await expect(seg.locator('[data-dpc-v2-mode="asap"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(box.locator('[data-dpc-v2-date]')).toBeDisabled();
    await expect(box.locator('.dpc-v2-order')).toContainText('Its Date line will say ASAP.');
    await box.locator('[data-dpc-v2="make"]').click();
    await expect(box.locator('.dpc-v2-mail')).toBeVisible();
    await expect(box.locator('.dpc-v2-body')).toHaveValue(/Date: ASAP/);
    await expect(box.locator('.dpc-v2-warn')).toHaveCount(0);
    expect(of('dispatch_v2_make_email').map(sent)).toEqual([{ job_id: 'job-pay1', supplier_id: SID(4), delivery_date: null, rebuild: false, fulfilment: 'delivery', date_mode: 'asap' }]);
    expect(of('dispatch_v2_set_date_mode')).toEqual([]);
    expect(await box.innerText()).not.toMatch(NO_DASH);
  });

  test('Pick a date is saved on the box, opens the calendar, and Make email sends the date', async ({ page }) => {
    const fake = fakePayment({ fresh: true });
    const { mat, of } = await boot(page, fake);
    const box = boxOf(mat, 'Metroll');
    await box.locator('[data-dpc-v2-mode="date"]').click();
    await expect(box.locator('[data-dpc-v2-mode="date"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(box.locator('[data-dpc-v2-date]')).toBeEnabled();
    expect(of('dispatch_v2_set_date_mode').map(sent)).toEqual([{ box_id: BOX(4), date_mode: 'date' }]);
    await box.locator('[data-dpc-v2-date]').fill(dayFrom(5));
    await box.locator('[data-dpc-v2="make"]').click();
    await expect(box.locator('.dpc-v2-mail')).toBeVisible();
    expect(of('dispatch_v2_make_email').map(sent)).toEqual([{ job_id: 'job-pay1', supplier_id: SID(4), delivery_date: dayFrom(5), rebuild: false, fulfilment: 'delivery', date_mode: 'date' }]);
  });

  test('a refused date choice goes back and offers Retry', async ({ page }) => {
    const fake = fakePayment({ fresh: true });
    fake.fail.dispatch_v2_set_date_mode = [{ status: 500, body: { error: 'e2e', code: 'dispatch_write_failed' } }];
    const { mat, of } = await boot(page, fake);
    const box = boxOf(mat, 'Metroll');
    await box.locator('[data-dpc-v2-mode="date"]').click();
    await expect(box.locator('.dpc-mat-fail')).toContainText('The date choice was not saved.');
    await expect(box.locator('[data-dpc-v2-mode="asap"]')).toHaveAttribute('aria-pressed', 'true');
    await box.locator('.dpc-mat-fail .dpc-retry').click();
    await expect(box.locator('[data-dpc-v2-mode="date"]')).toHaveAttribute('aria-pressed', 'true');
    expect(of('dispatch_v2_set_date_mode').map(sent)).toEqual([{ box_id: BOX(4), date_mode: 'date' }, { box_id: BOX(4), date_mode: 'date' }]);
  });

  test('a sent ASAP order with no date is an amber dashed ring, not late', async ({ page }) => {
    const { root } = await boot(page, fakePayment());
    const arr = root.locator('[data-dpc-region="arrival"]');
    await expect(arr.locator('.dpc-arr-list li', { hasText: 'Twinside Retaining' })).toContainText('Pickup ASAP, waiting on their date');
    await expect(arr.locator('.dpc-arr-out')).toHaveClass(/asap/);
    await expect(arr.locator('.dpc-arr-count')).toHaveText('2 orders: 1 confirmed, 1 ASAP waiting');
    await expect(arr.locator('.dpc-arr-legend')).toContainText('Dashed = ordered ASAP, waiting on their date.');
  });

  test('an older ops-api: no choice on the box, the calendar as today, and no date_mode sent', async ({ page }) => {
    const fake = fakePayment({ old: true, fresh: true });
    const { mat, of } = await boot(page, fake);
    const box = boxOf(mat, 'Metroll');
    await expect(box.locator('[data-dpc-v2="make"]')).toBeVisible();
    await expect(box.locator('.dpc-v2-seg')).toHaveCount(0);
    await expect(box.locator('[data-dpc-v2-date]')).toBeEnabled();
    await expect(box).not.toContainText('ASAP');
    await box.locator('[data-dpc-v2="make"]').click();
    await expect(box.locator('.dpc-v2-mail')).toBeVisible();
    expect(of('dispatch_v2_make_email').map(sent)).toEqual([{ job_id: 'job-pay1', supplier_id: SID(4), delivery_date: null, rebuild: false, fulfilment: 'delivery' }]);
  });
});

