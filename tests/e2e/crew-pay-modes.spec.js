// SecureWorks Crew: the three ways a job is paid other than by the hour, each
// sent all the way through on the demo server. The server decides how a job is
// billed; these check that the app bills it that way and sends what the Trade
// App sends.
const { test, expect } = require('@playwright/test');
const { crewUrl, watchErrors, PHONE } = require('../helpers/crew');

test.use(PHONE);

/** Load the demo, then record every invoice the app sends. */
async function openWithSpy(page, persona, setup) {
  await page.goto(crewUrl('#/jobs', persona));
  await page.waitForFunction(() => Boolean(window.__crewDemo));
  await page.evaluate(() => {
    const ops = window.__crewDemo.ops; const real = ops.generate_trade_invoice;
    window.__sent = [];
    ops.generate_trade_invoice = (p, b) => { window.__sent.push(JSON.parse(JSON.stringify(b))); return ops.__realInvoice ? ops.__realInvoice(p, b) : real(p, b); };
  });
  if (setup) await page.evaluate(setup);
}

async function fillTimes(page, name, start, finish, brk) {
  await page.locator('.pay-row', { hasText: name }).click();
  const sheet = page.getByRole('dialog', { name });
  await sheet.locator('input[type="time"]').first().fill(start);
  await sheet.locator('input[type="time"]').nth(1).fill(finish);
  await sheet.getByRole('button', { name: brk, exact: true }).click();
  await sheet.getByRole('button', { name: 'Save' }).click();
}

async function leaveOff(page, name) {
  await page.locator('.pay-row', { hasText: name }).click();
  const sheet = page.getByRole('dialog', { name });
  await sheet.getByRole('switch', { name: /Leave this off the invoice/ }).click();
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function send(page) {
  await page.getByRole('button', { name: 'Send invoice' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Send/ }).click();
  await expect(page.getByRole('heading', { name: 'Invoice sent' })).toBeVisible();
  return page.evaluate(() => window.__sent);
}

test('a work order is billed at the amount agreed with the office, with no box to change it', async ({ page }) => {
  const errors = watchErrors(page);
  await openWithSpy(page, 'crew', () => { window.__crewDemo.db.jobWorkOrders['j-joon'].agreed_labour_ex = 3200; });
  await page.evaluate(() => { location.hash = '#/pay/week/2026-11-09'; });

  const row = page.locator('.pay-row', { hasText: 'Joondalup' });
  await expect(row).toContainText('Work order');
  await row.click();
  const sheet = page.getByRole('dialog', { name: 'Joondalup' });
  await expect(sheet.locator('.pay-out')).toContainText('$3,200.00');
  await expect(sheet.getByText('This amount is set with the office.')).toBeVisible();
  await expect(sheet.locator('input[type="number"]')).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'Claim commission instead' })).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Close' }).first().click().catch(() => page.keyboard.press('Escape'));

  await fillTimes(page, 'Wembley', '07:00', '14:00', '30 min');
  await page.getByRole('button', { name: 'Review invoice' }).click();
  await expect(page.locator('.pay-cap', { hasText: /^Work order/ })).toContainText('$3,200.00');

  const sent = await send(page);
  expect(sent).toHaveLength(1);
  const wo = sent[0].extra_items.filter((x) => x.row_type === 'work_order');
  expect(wo).toHaveLength(1);
  expect(wo[0]).toMatchObject({ type: 'Work Order', job_id: 'j-joon', job_number: 'SWF-26767', rate: 3200, wo_allocated: 3200, wo_labour_deduction: 0 });
  // The other days are hours, one line a job a day, never folded into the work order.
  expect(sent[0].manual_assignments.map((a) => a.work_date)).toEqual(['2026-11-09', '2026-11-10', '2026-11-12']);
  expect(errors).toEqual([]);
});

test('commission is offered only where the server allows it, with inclusive super', async ({ page }) => {
  const errors = watchErrors(page);
  // A crew member is never offered commission.
  await openWithSpy(page, 'crew');
  await page.evaluate(() => { location.hash = '#/pay/week/2026-11-09'; });
  await page.locator('.pay-row', { hasText: 'South Perth' }).click();
  await expect(page.getByRole('dialog', { name: 'South Perth' }).getByRole('button', { name: 'Claim commission instead' })).toHaveCount(0);

  // The fencing manager is, on his fencing jobs.
  await openWithSpy(page, 'lead');
  await page.evaluate(() => { location.hash = '#/pay/week/2026-11-09'; });
  await page.locator('.pay-row', { hasText: 'South Perth' }).click();
  await page.getByRole('dialog', { name: 'South Perth' }).getByRole('button', { name: 'Claim commission instead' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const row = page.locator('.pay-row', { hasText: 'South Perth' });
  await expect(row).toContainText('Commission');
  await row.click();
  const sheet = page.getByRole('dialog', { name: 'South Perth' });
  await sheet.getByLabel('Commission amount (before GST)').fill('500');
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  for (const name of ['Wembley', 'Morley', 'Joondalup']) await leaveOff(page, name);

  await page.getByRole('button', { name: 'Review invoice' }).click();
  await expect(page.locator('.pay-cap', { hasText: /^Commission/ })).toContainText('$500.00');
  // Commission carries the same inclusive super as the other work lines.
  await expect(page.locator('.pay-sumrow', { hasText: 'Total (includes super)' })).toContainText('$500.00');
  await expect(page.locator('.pay-sumrow', { hasText: 'Super on your pay' })).toContainText('$53.57');
  await expect(page.locator('.pay-sumrow.total')).toContainText('$446.43');

  const sent = await send(page);
  expect(sent).toHaveLength(1);
  expect(sent[0].manual_assignments).toEqual([]);
  expect(sent[0].extra_items).toHaveLength(1);
  expect(sent[0].extra_items[0]).toMatchObject({ type: 'Commission', row_type: 'commission', job_number: 'SWF-26168', rate: 500, commission_amount: 500 });
  expect(errors).toEqual([]);
});

test('a group work order: hours, the customer signs, shares locked, then the share is invoiced on its own', async ({ page }) => {
  const errors = watchErrors(page);
  await openWithSpy(page, 'crew');
  await page.evaluate(() => { location.hash = '#/pay/group/j-dunc'; });
  await expect(page.getByText('Add your hours')).toBeVisible();

  await page.getByRole('button', { name: 'Add a day you worked' }).click();
  const day = page.getByRole('dialog', { name: 'Add a day you worked' });
  await day.getByRole('button', { name: /Thu/ }).click();
  await day.locator('input[type="time"]').first().fill('07:00');
  await day.locator('input[type="time"]').nth(1).fill('15:30');
  await day.getByRole('button', { name: '30 min', exact: true }).click();
  await day.getByRole('button', { name: /Save Thu/ }).click();
  await expect(page.locator('main')).toContainText('8.0 h');

  await page.getByRole('button', { name: 'Get the customer to sign' }).click();
  const sign = page.getByRole('dialog', { name: 'Customer sign-off' });
  await sign.getByRole('button', { name: 'Yes, all done' }).click();
  for (const stars of await sign.locator('.pay-stars').all()) await stars.getByRole('button', { name: '5 out of 5' }).click();
  const pad = sign.locator('canvas');
  await pad.scrollIntoViewIfNeeded();
  const box = await pad.boundingBox();
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 15, { steps: 6 });
  await page.mouse.move(box.x + box.width - 20, box.y + box.height - 15, { steps: 6 });
  await page.mouse.up();
  await sign.getByRole('button', { name: 'Save sign-off' }).click();
  await expect(sign).toHaveCount(0);

  await page.getByRole('button', { name: 'Lock in the shares' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Lock in the shares' }).click();
  await expect(page.getByRole('button', { name: 'Invoice my share' })).toBeVisible();
  // Each person sees their own share, worked out by the server from the hours.
  await page.getByRole('button', { name: 'Invoice my share' }).click();
  // The share is not paid yet, so the confirm never says it was paid to you.
  await expect(page.getByRole('dialog')).toContainText('is your share');
  await expect(page.getByRole('dialog')).not.toContainText('paid to you');
  await page.getByRole('dialog').getByRole('button', { name: 'Invoice my share' }).click();
  await expect(page.getByRole('heading', { name: 'Share invoiced' })).toBeVisible();

  const sent = await page.evaluate(() => window.__sent);
  expect(sent).toHaveLength(1);
  // A share goes on its own: no week, no hours lines, one group share item.
  expect(sent[0].week_start).toBeUndefined();
  expect(sent[0].manual_assignments || []).toEqual([]);
  expect(sent[0].extra_items).toEqual([{ type: 'group share', group_id: 'g-dunc' }]);
  expect(errors).toEqual([]);
});
