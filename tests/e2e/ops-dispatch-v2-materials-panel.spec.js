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
const { BOX, SID, dayFrom, dayWords, fakePayment, boot, boxOf, sent } = require('../helpers/dispatch-v2-payment');

const NO_DASH = /[–—]/;
// A class list holding every one of these whole class words, in any order.
const cls = (...words) => new RegExp(words.map((w) => '(?=.*(^|\\s)' + w + '(\\s|$))').join(''));

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
    const { root } = await boot(page, fakePayment({ onAccount: true }));
    const panel = root.locator('[data-dpc-region="arrival"]');
    await expect(panel.locator('.dpc-mp-lab', { hasText: 'Twinside Retaining' })).toContainText('Pickup ASAP, waiting on their date');
    await expect(panel.locator('.dpc-mp-dot.asap')).toHaveCount(1);
    await expect(panel.locator('.dpc-arr-count')).not.toContainText('not in time');
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

test.describe('Dispatch v2: the date choice after a send', () => {
  test('a sent ASAP order can switch its next email to Pick a date; the sent order still reads ASAP', async ({ page }) => {
    const { root, mat, of } = await boot(page, fakePayment({ onAccount: true }));
    const box = boxOf(mat, 'Twinside Retaining');
    await expect(box.locator('[data-dpc-v2-mode="asap"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(box.locator('.dpc-v2-sentmode')).toHaveCount(0);
    await box.locator('[data-dpc-v2-mode="date"]').click();
    await expect(box.locator('[data-dpc-v2-mode="date"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(box.locator('[data-dpc-v2-date]')).toBeEnabled();
    await expect(box.locator('.dpc-v2-sentmode')).toHaveText('The order already sent asked for ASAP. The next email will ask for the date picked here.');
    expect(of('dispatch_v2_set_date_mode').map(sent)).toEqual([{ box_id: BOX(2), date_mode: 'date' }]);
    // The panel describes the order sent: still ASAP, waiting on their date.
    await expect(root.locator('[data-dpc-region="arrival"] .dpc-mp-lab', { hasText: 'Twinside Retaining' })).toContainText('Pickup ASAP, waiting on their date');
  });

  test('a server without sent_mode reads the sent order as the box\'s mode and says nothing more', async ({ page }) => {
    const { mat } = await boot(page, fakePayment({ onAccount: true, noSentMode: true, twinside: { dateMode: 'date', sentMode: 'asap' } }));
    const box = boxOf(mat, 'Twinside Retaining');
    await expect(box.locator('[data-dpc-v2-mode="date"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(box.locator('.dpc-v2-sentmode')).toHaveCount(0);
  });

  test('a date choice changed somewhere else (409 date_mode_changed) says so plainly and shows the latest', async ({ page }) => {
    const fake = fakePayment({ fresh: true });
    const { mat } = await boot(page, fake);
    const box = boxOf(mat, 'Metroll');
    await expect(box.locator('[data-dpc-v2-mode="asap"]')).toHaveAttribute('aria-pressed', 'true');
    // Someone else picks a date first; this press then loses the race.
    fake.boxes.find((bx) => bx.name === 'Metroll').dateMode = 'date';
    fake.fail.dispatch_v2_set_date_mode = [{ status: 409, body: { error: 'e2e', code: 'date_mode_changed' } }];
    await box.locator('[data-dpc-v2-mode="date"]').click();
    await expect(box).toContainText("This order's date choice was changed somewhere else. Showing the latest.");
    await expect(box.locator('[data-dpc-v2-mode="date"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(box.locator('.dpc-retry')).toHaveCount(0);
  });
});

test.describe('Dispatch v2: the Materials panel', () => {
  const panelOf = (root) => root.locator('[data-dpc-region="arrival"]');
  const dotOf = (panel, i) => panel.locator('.dpc-mp-dot').nth(i);

  test("the panel takes the Arrival line's place: a dot per order by its date, the dateless in the bay, a row each", async ({ page }) => {
    const fake = fakePayment({ onAccount: true });
    const { root } = await boot(page, fake);
    const panel = panelOf(root);
    await expect(panel).toHaveClass(/dpc-mp/);
    await expect(panel.locator('.dpc-arr-title')).toHaveText('Materials');
    await expect(panel.locator('.dpc-arr-q')).toHaveText('Where every order is, and will it all be on site before the install?');
    await expect(root).not.toContainText('Arrival line');
    await expect(panel.locator('.dpc-arr-count')).toHaveText('2 to pay · 1 all good');
    await expect(panel.locator('.dpc-mp-tl')).toContainText('Today ');
    await expect(panel.locator('.dpc-mp-noinst')).toHaveText('No install booked');
    await expect(panel.locator('.dpc-mp-bayl')).toHaveText('No date yet');
    // Sorted by where they sit: Lysaght (Mon), Stratco (Wed), Twinside (bay).
    await expect(panel.locator('.dpc-mp-lab b')).toHaveText(['Lysaght', 'Stratco WA', 'Twinside Retaining']);
    await expect(panel.locator('.dpc-mp-bdg')).toHaveText(['Pay', 'Confirmed', 'Pay']);
    // Lysaght: needs us (orange), date confirmed (solid). Stratco: green solid.
    // Twinside: needs us, no date, ordered ASAP (dashed ring).
    await expect(dotOf(panel, 0)).toHaveClass(cls('us', 's'));
    await expect(dotOf(panel, 1)).toHaveClass(cls('ok', 's'));
    await expect(dotOf(panel, 2)).toHaveClass(cls('us', 'asap'));
    await expect(dotOf(panel, 2)).not.toHaveClass(cls('s'));
    const rows = panel.locator('.dpc-mp-r');
    await expect(rows.locator('.dpc-mp-name')).toHaveText(['Lysaght', 'Twinside Retaining', 'Stratco WA']);
    await expect(rows.nth(0).locator('.dpc-mp-onus')).toHaveText('On usPay Lysaght');
    await expect(rows.nth(0).locator('small')).toContainText('Replied ');
    await expect(rows.nth(2).locator('.dpc-mp-supw, .dpc-mp-onus, .dpc-mp-done')).toBeVisible();
    await expect(panel.locator('.dpc-mp-legend')).toContainText('Orange = needs us.');
    expect(await panel.innerText()).not.toMatch(NO_DASH);
  });

  test('Mark paid on a row records it, and the dot turns green', async ({ page }) => {
    const fake = fakePayment({ onAccount: true });
    const { root, mat, of } = await boot(page, fake);
    const panel = panelOf(root);
    const row = panel.locator('.dpc-mp-r', { hasText: 'Lysaght' });
    await expect(row.locator('[data-dpc-v2="paid"]')).toHaveText('Mark paid');
    await row.locator('[data-dpc-v2="paid"]').click();
    await expect(panel.locator('.dpc-mp-bdg').first()).toHaveText('Confirmed');
    await expect(dotOf(panel, 0)).toHaveClass(cls('ok'));
    await expect(panel.locator('.dpc-mp-lab', { hasText: 'Lysaght' }).locator('.dpc-mp-t')).toHaveText('Paid');
    await expect(panel.locator('.dpc-mp-r', { hasText: 'Lysaght' }).locator('[data-dpc-v2="paid"]')).toHaveCount(0);
    await expect(boxOf(mat, 'Lysaght')).toContainText('Marked paid: Lysaght.');
    expect(of('dispatch_v2_mark_paid').map(sent)).toEqual([{ box_id: BOX(1), expected_paid_at: null }]);
  });

  test('only an order at Awaiting payment counts "to pay" and gets Mark paid on its row', async ({ page }) => {
    // Design section 10: Lysaght set by hand to Manufacturing (not paid), Twinside to pay.
    const fake = fakePayment({ lysaght: { stage: 'manufacturing', stageSource: 'set', stageAt: '2026-10-29T07:34:00.000Z', stageBy: 'shaun@ops.test' } });
    const { root, mat } = await boot(page, fake);
    const panel = panelOf(root);
    await expect(panel.locator('.dpc-arr-count')).toHaveText('1 to pay · 1 waiting on supplier');
    await expect(panel.locator('.dpc-mp-r', { hasText: 'Lysaght' }).locator('[data-dpc-v2="paid"]')).toHaveCount(0);
    await expect(panel.locator('.dpc-mp-r', { hasText: 'Twinside Retaining' }).locator('[data-dpc-v2="paid"]')).toHaveText('Mark paid');
    // The box keeps its own Mark paid.
    await expect(boxOf(mat, 'Lysaght').locator('.dpc-v2-paybtn')).toHaveText('Mark paid');
  });

  test('unpaid orders that are delivered do not stop "All confirmed"', async ({ page }) => {
    const set = { stageSource: 'set', stageAt: '2026-10-29T07:34:00.000Z', stageBy: 'shaun@ops.test' };
    const fake = fakePayment({ lysaght: Object.assign({ stage: 'delivered' }, set), twinside: Object.assign({ stage: 'delivered' }, set) });
    const { root } = await boot(page, fake);
    const panel = panelOf(root);
    await expect(panel.locator('.dpc-arr-count')).toHaveText('All confirmed');
    await expect(panel.locator('.dpc-mp-r [data-dpc-v2="paid"]')).toHaveCount(0);
  });

  test("a row's Mark paid shows Saving while it saves, and the focus stays on the row button it was on", async ({ page }) => {
    const fake = fakePayment({ onAccount: true });
    let release;
    const gate = new Promise((r) => { release = r; });
    const markPaid = fake.api.dispatch_v2_mark_paid;
    const { root } = await boot(page, fake, { api: { dispatch_v2_mark_paid: async (url, b) => { await gate; return markPaid(url, b); } } });
    const panel = panelOf(root);
    const btn = (name) => panel.locator('.dpc-mp-r', { hasText: name }).locator('[data-dpc-v2="paid"]');
    await btn('Lysaght').click();
    await expect(btn('Lysaght')).toHaveText('Saving...');
    await expect(btn('Lysaght')).toBeDisabled();
    await btn('Twinside Retaining').focus();
    release();
    await expect(btn('Lysaght')).toHaveCount(0);
    await expect(btn('Twinside Retaining')).toBeFocused();
  });

  test('each row has an eight-step strip: done steps, the step it is on in its colour, and its words', async ({ page }) => {
    const { root } = await boot(page, fakePayment({ onAccount: true, lysaght: { stage: 'manufacturing', stageSource: 'set', stageAt: '2026-10-29T07:34:00.000Z', stageBy: 'shaun@ops.test', paid: { at: '2026-10-29T06:40:00.000Z', by: 'shaun@ops.test' } } }));
    const panel = panelOf(root);
    const strip = (name) => panel.locator('.dpc-mp-r', { hasText: name }).locator('.dpc-mp-strip i');
    const cap = (name) => panel.locator('.dpc-mp-r', { hasText: name }).locator('.dpc-mp-stripc');
    await expect(strip('Lysaght')).toHaveCount(8);
    const lys = await strip('Lysaght').evaluateAll((els) => els.map((e) => e.className));
    expect(lys).toEqual(['d', 'd', 'd', 'd', 'd', 'cs', '', '']);
    await expect(cap('Lysaght')).toHaveText('Manufacturing · step 6 of 8');
    const twin = await strip('Twinside Retaining').evaluateAll((els) => els.map((e) => e.className));
    expect(twin).toEqual(['d', 'd', 'd', 'cu', '', '', '', '']);
    await expect(cap('Twinside Retaining')).toHaveText('Payment · step 4 of 8');
    await expect(cap('Stratco WA')).toHaveText('Order confirmed · step 5 of 8');
  });

  test('a paid order says so under its strip; a pickup on the install day hatches Materials ready', async ({ page }) => {
    const fake = fakePayment({ install: dayFrom(4), lysaght: { paid: { at: '2026-10-29T06:40:00.000Z', by: 'shaun@ops.test' } } });
    const { root } = await boot(page, fake);
    const row = panelOf(root).locator('.dpc-mp-r', { hasText: 'Lysaght' });
    await expect(row.locator('.dpc-mp-stripc')).toHaveText('Order confirmed · paid');
    const cells = await row.locator('.dpc-mp-strip i').evaluateAll((els) => els.map((e) => e.className));
    expect(cells).toEqual(['d', 'd', 'd', 'd', 'ck', '', 'k', '']);
  });

  test('the On us bar lists what waits on us, and goes once nothing does', async ({ page }) => {
    const { root } = await boot(page, fakePayment({ onAccount: true }));
    const bar = panelOf(root).locator('.dpc-mp-sumbar');
    await expect(bar).toHaveText('On us Pay Lysaght. Pay Twinside Retaining. Book the install and tell the client.');
    // Paid and with the supplier: nothing is on us.
    const making = { stage: 'manufacturing', stageSource: 'set', stageAt: '2026-10-29T07:34:00.000Z', stageBy: 'shaun@ops.test', paid: { at: '2026-10-29T06:40:00.000Z', by: 'shaun@ops.test' } };
    const page2 = await page.context().newPage();
    const second = await boot(page2, fakePayment({ lysaght: making, twinside: making }));
    await expect(panelOf(second.root).locator('.dpc-mp-r')).toHaveCount(2);
    await expect(panelOf(second.root).locator('.dpc-mp-sumbar')).toHaveCount(0);
  });

  test('with every date confirmed and no install booked, a dashed green line marks the earliest install', async ({ page }) => {
    const paid = { at: '2026-10-29T06:40:00.000Z', by: 'shaun@ops.test' };
    const fake = fakePayment({ lysaght: { paid }, twinside: { date: dayFrom(6), confirmed: true, paid }, earliest: { day: dayFrom(7), after_day: dayFrom(6) } });
    const { root } = await boot(page, fake);
    const panel = panelOf(root);
    await expect(panel.locator('.dpc-mp-earlyl')).toHaveText('Earliest install ' + dayWords(dayFrom(7)));
    await expect(panel.locator('.dpc-mp-early')).toHaveCount(1);
    await expect(panel.locator('.dpc-mp-noinst')).toHaveCount(0);
    await expect(panel.locator('.dpc-mp-sumbar')).toHaveText('On us All materials by ' + dayWords(dayFrom(6)) + '. Book the install from ' + dayWords(dayFrom(7)) + ' and tell the client.');
    // The line sits after the last order.
    const left = async (loc) => parseFloat(await loc.evaluate((e) => e.style.left));
    expect(await left(panel.locator('.dpc-mp-early'))).toBeGreaterThan(await left(panel.locator('.dpc-mp-dot').last()));
  });

  test('an install booked draws its own line, not the earliest install', async ({ page }) => {
    const { root } = await boot(page, fakePayment({ install: dayFrom(8), earliest: { day: dayFrom(7), after_day: dayFrom(6) } }));
    const panel = panelOf(root);
    await expect(panel.locator('.dpc-mp-instl')).toHaveText('Install ' + dayWords(dayFrom(8)));
    await expect(panel.locator('.dpc-mp-early, .dpc-mp-noinst')).toHaveCount(0);
  });

  test("an older ops-api keeps today's Arrival line", async ({ page }) => {
    const { root } = await boot(page, fakePayment({ old: true, onAccount: true }));
    const arr = panelOf(root);
    await expect(arr.locator('.dpc-arr-title')).toHaveText('Arrival line');
    await expect(arr).not.toHaveClass(/dpc-mp/);
    await expect(arr.locator('.dpc-mp-rail')).toHaveCount(0);
    await expect(root.locator('.dpc-mp-sumbar, .dpc-mp-strip')).toHaveCount(0);
    await expect(arr.locator('.dpc-arr-mk')).toHaveCount(3);
  });
});

test.describe('Dispatch v2: job card dots', () => {
  test('the job card shows a small dot per order, its name and its badge, in place of the thin line', async ({ page }) => {
    const { root } = await boot(page, fakePayment({ onAccount: true }));
    const card = root.locator('.dpc-job', { hasText: 'Peter Example' });
    const dots = card.locator('.dpc-minidot');
    await expect(dots).toHaveText(['Lysaght Pay', 'Twinside Retaining Pay', 'Stratco WA Confirmed']);
    await expect(dots.nth(0).locator('i')).toHaveClass(cls('us', 's'));
    await expect(dots.nth(1).locator('i')).toHaveClass(cls('us', 'asap'));
    await expect(dots.nth(2).locator('i')).toHaveClass(cls('ok', 's'));
    await expect(card.locator('.dpc-arrthin')).toHaveCount(0);
    await expect(card.locator('.dpc-vh', { hasText: 'Materials:' })).toHaveText('Materials: 2 to pay · 1 all good.');
  });

  test("an older ops-api keeps the card's thin Arrival line", async ({ page }) => {
    const { root } = await boot(page, fakePayment({ old: true, onAccount: true }));
    const card = root.locator('.dpc-job', { hasText: 'Peter Example' });
    await expect(card.locator('.dpc-arrthin-dot')).toHaveCount(3);
    await expect(card.locator('.dpc-minidots')).toHaveCount(0);
  });
});

test.describe('Dispatch v2: the panel reads to_pay', () => {
  const panelOf = (root) => root.locator('[data-dpc-region="arrival"]');
  test('"to pay" and the row\'s Mark paid follow to_pay; a server without it works it out the same way', async ({ page }) => {
    const making = { stage: 'manufacturing', stageSource: 'set', stageAt: '2026-10-29T07:34:00.000Z', stageBy: 'shaun@ops.test' };
    for (const noToPay of [false, true]) {
      const p = noToPay ? await page.context().newPage() : page;
      const { root } = await boot(p, fakePayment({ noToPay, lysaght: making }));
      const panel = panelOf(root);
      await expect(panel.locator('.dpc-arr-count')).toHaveText('1 to pay · 1 waiting on supplier');
      await expect(panel.locator('.dpc-mp-r', { hasText: 'Lysaght' }).locator('[data-dpc-v2="paid"]')).toHaveCount(0);
      await expect(panel.locator('.dpc-mp-r', { hasText: 'Twinside Retaining' }).locator('[data-dpc-v2="paid"]')).toHaveText('Mark paid');
    }
  });
});
