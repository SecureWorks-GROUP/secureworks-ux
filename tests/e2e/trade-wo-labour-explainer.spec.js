const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

test.use({ persona: 'installer', feedScenario: 'wo-labour-explainer' });

test('explains WO labour reconciliation and direct crew billing on the invoice path', async ({ appPage: page, feedRequests }, testInfo) => {
  await signIn(page, PERSONAS.installer);
  await page.locator('[data-view="hours"]').click();
  await page.getByRole('button', { name: /Weekly Invoice/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();

  const card = page.locator('.jc-card').filter({ hasText: 'SWF-26767' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Work Order' }).click();
  await card.locator('[data-cardwoalloc]').fill('559.50');
  await card.locator('[data-cardwoalloc]').press('Tab');
  await card.getByRole('button', { name: '+ Add labour line' }).click();
  await card.locator('[data-cardwollname]').fill('Tendo');
  await card.locator('[data-cardwollname]').press('Tab');
  await card.locator('[data-cardwollhours]').fill('11.5');
  await card.locator('[data-cardwollhours]').press('Tab');
  await card.locator('[data-cardwollrate]').fill('25');
  await card.locator('[data-cardwollrate]').press('Tab');

  const explanation = card.locator('[data-cardwobreak]');
  await expect(card.locator('[data-cardamt]')).toHaveText('$272.00');
  await expect(explanation).toContainText('WO $559.5 − labour [Tendo 11.5h×$25=$287.5]=net $272');
  await expect(explanation).toContainText('Labour is deducted from your invoice and shown to the office; crew bill SecureWorks Group directly.');
  await expect(explanation).not.toContainText('paid their labour line by the office');

  const builderScreenshot = testInfo.outputPath('wo-labour-explainer-builder.png');
  await page.locator('#hoursContent').screenshot({ path: builderScreenshot });
  await testInfo.attach('WO labour explainer in invoice builder', { path: builderScreenshot, contentType: 'image/png' });

  await page.locator('#invSubmitBtn').click();
  await page.locator('#confirmOk').click();
  await expect(page.getByText('Invoice Submitted')).toBeVisible();
  await expect(page.locator('#hoursContent')).toContainText('$287.50 for Tendo was deducted from your invoice and shown to the office. They must bill SecureWorks Group directly.');
  await expect(page.locator('#hoursContent')).not.toContainText('Tendo will be paid');
  await expect(page.locator('#hoursContent')).not.toContainText('paid $287.50 by the office');

  const successScreenshot = testInfo.outputPath('wo-labour-explainer-success.png');
  await page.locator('#hoursContent').screenshot({ path: successScreenshot });
  await testInfo.attach('WO labour explainer after invoice submission', { path: successScreenshot, contentType: 'image/png' });

  const submit = feedRequests.find((entry) => entry.method === 'POST' && entry.action === 'generate_trade_invoice');
  expect(submit).toBeTruthy();
  expect(feedRequests.filter((entry) => entry.method !== 'GET').map((entry) => entry.action)).toEqual([
    'generate_trade_invoice'
  ]);
  expect(submit.body.extra_items).toEqual([
    expect.objectContaining({
      row_type: 'work_order',
      job_number: 'SWF-26767',
      rate: 272,
      wo_allocated: 559.5,
      wo_labour_deduction: 287.5,
      wo_labour_lines: [
        { trade_name: 'Tendo', hours: 11.5, rate: 25, amount: 287.5 }
      ]
    })
  ]);
});
