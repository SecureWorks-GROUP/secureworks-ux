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

test.describe('per-metre submit response is missing persisted super rate', () => {
  test.use({ feedScenario: 'trade-invoice-per-metre-response-missing-rate' });

  test('does not confirm the preview rate left in the pre-submit hours feed', async ({ appPage: page }) => {
    await signIn(page, PERSONAS.fencing_manager);
    await page.locator('[data-view="hours"]').click();

    await page.getByRole('switch', { name: 'Add GST to this invoice' }).click();
    await page.getByRole('button', { name: 'Submit Invoice' }).click();
    await page.locator('#confirmOk').click();
    await expect(page.locator('#toast')).toContainText('Invoice submitted');

    const money = page.locator('[data-invoice-money-summary]');
    await expect(money).toContainText('Submitted invoice totals are unavailable');
    await expect(money).not.toContainText('Less super');
    await expect(money).not.toContainText('Invoice total');
  });
});

test.describe('submitted GST-off invoice has no separate persisted total', () => {
  test.use({ feedScenario: 'trade-invoice-per-metre-gst-off-no-total' });

  test('uses persisted net pay as the invoice total', async ({ appPage: page }) => {
    await signIn(page, PERSONAS.fencing_manager);
    await page.locator('[data-view="hours"]').click();

    const money = page.locator('[data-invoice-money-summary]');
    await expect(money).toContainText('Net pay$308.00');
    await expect(money).toContainText('GSTOff');
    await expect(money).toContainText('Invoice total$308.00');
  });
});

test.describe('submitted per-metre line truth', () => {
  test.use({ feedScenario: 'trade-invoice-per-metre-response-lines' });

  test('renders the submitted metres and line total returned by the response', async ({ appPage: page }) => {
    await signIn(page, PERSONAS.fencing_manager);
    await page.locator('[data-view="hours"]').click();

    await page.locator('#pmMetres_e2e-per-metre-job').fill('11');
    await page.getByRole('switch', { name: 'Add GST to this invoice' }).click();
    await page.getByRole('button', { name: 'Submit Invoice' }).click();
    await page.locator('#confirmOk').click();

    await expect(page.locator('#pmMetres_e2e-per-metre-job')).toHaveValue('11');
    await expect(page.locator('#pmTotal_e2e-per-metre-job')).toHaveText('$385.00');
    await expect(page.locator('[data-invoice-money-summary]')).toContainText('Earned$385.00');
  });
});

test.describe('unsuccessful per-metre response', () => {
  test.use({ feedScenario: 'trade-invoice-per-metre-response-error' });

  test('keeps the invoice editable and does not mark it submitted', async ({ appPage: page }) => {
    await signIn(page, PERSONAS.fencing_manager);
    await page.locator('[data-view="hours"]').click();

    await page.getByRole('button', { name: 'Submit Invoice' }).click();
    await page.locator('#confirmOk').click();

    await expect(page.locator('#toast')).toContainText('Backend refused this per-metre invoice');
    await expect(page.getByRole('button', { name: 'Submit Invoice' })).toBeVisible();
    await expect(page.locator('#pmMetres_e2e-per-metre-job')).toBeEnabled();
    await expect(page.locator('[data-invoice-money-summary]')).toContainText('Estimate');
  });
});

test.describe('unknown per-metre response', () => {
  test.use({ feedScenario: 'trade-invoice-per-metre-response-empty' });

  test('keeps the invoice editable and does not mark it submitted', async ({ appPage: page }) => {
    await signIn(page, PERSONAS.fencing_manager);
    await page.locator('[data-view="hours"]').click();

    await page.getByRole('button', { name: 'Submit Invoice' }).click();
    await page.locator('#confirmOk').click();

    await expect(page.locator('#toast')).toContainText('Invoice submission failed');
    await expect(page.getByRole('button', { name: 'Submit Invoice' })).toBeVisible();
    await expect(page.locator('#pmMetres_e2e-per-metre-job')).toBeEnabled();
    await expect(page.locator('[data-invoice-money-summary]')).toContainText('Estimate');
  });
});

[
  ['trade-invoice-per-metre-missing-rate', 'super rate'],
  ['trade-invoice-per-metre-missing-gst', 'GST amount'],
  ['trade-invoice-per-metre-gst-on-legacy-total', 'authoritative GST-on total']
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
