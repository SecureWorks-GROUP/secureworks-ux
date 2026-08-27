const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

test.use({ persona: 'fencing_manager', feedScenario: 'trade-invoice-per-metre-gst' });

test('carries the visible GST choice through submit_trade_invoice without browser super figures', async ({ appPage: page, feedRequests }) => {
  await signIn(page, PERSONAS.fencing_manager);
  await page.locator('[data-view="hours"]').click();

  const money = page.locator('[data-invoice-money-summary]');
  await expect(money).toContainText('Earned$350.00');
  await expect(money).toContainText('Less super (12%)−$42.00');
  await expect(money).toContainText('Net pay$308.00');

  const gstSwitch = page.getByRole('switch', { name: 'Add GST to this invoice' });
  await gstSwitch.click();
  await expect(gstSwitch).toHaveAttribute('aria-checked', 'true');
  await expect(money).toContainText('Earned$350.00');
  await expect(money).toContainText('Less super (12%)−$42.00');
  await expect(money).toContainText('Net pay$308.00');
  await page.getByRole('button', { name: 'Submit Invoice' }).click();
  await page.locator('#confirmOk').click();
  await expect(page.locator('#toast')).toContainText('Invoice submitted');

  await expect(money).toContainText('Earned$350.00');
  await expect(money).toContainText('Less super (12%)−$42.00');
  await expect(money).toContainText('Net pay$308.00');
  await expect(money).toContainText('GST$30.80');
  await expect(money).toContainText('Invoice total$338.80');
  await expect(money).not.toContainText('Estimate');
  await expect(page.getByRole('switch', { name: 'Add GST to this invoice' })).toHaveCount(0);
  await expect(page.locator('#pmMetres_e2e-per-metre-job')).toBeDisabled();

  const submit = feedRequests.find((entry) => entry.method === 'POST' && entry.action === 'submit_trade_invoice');
  expect(submit).toBeTruthy();
  expect(submit.body.gst_on).toBe(true);
  expect(submit.body).not.toHaveProperty('super_rate');
  expect(submit.body).not.toHaveProperty('super_amount');
  expect(submit.body).not.toHaveProperty('gross_earned');
  expect(submit.body).not.toHaveProperty('net_pay');
});

[
  ['trade-invoice-per-metre-missing-rate', 'super rate'],
  ['trade-invoice-per-metre-missing-gst', 'GST amount']
].forEach(([feedScenario, missingField]) => {
  test.describe(`submitted money missing ${missingField}`, () => {
    test.use({ feedScenario });

    test('does not present partial backend money as confirmed', async ({ appPage: page }) => {
      await signIn(page, PERSONAS.fencing_manager);
      await page.locator('[data-view="hours"]').click();

      const money = page.locator('[data-invoice-money-summary]');
      await expect(money).toContainText('Submitted invoice totals are unavailable');
      await expect(money).not.toContainText('Less super');
      await expect(money).not.toContainText('Invoice total');
      await expect(page.getByRole('switch', { name: 'Add GST to this invoice' })).toHaveCount(0);
    });
  });
});
