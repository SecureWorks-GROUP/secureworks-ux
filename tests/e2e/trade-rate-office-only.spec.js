const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

// Rates are office only (captain ruling 2026-09-23, trade app audit finding 7).
// The trade sees the rate the office set, read-only, and nothing the trade does
// on Profile or in the invoice builder may call set_trade_rate.
test.use({ persona: 'fencing_manager', feedScenario: 'henry-wo-hydrate-fail' });

test('Profile and the invoice builder show the office rate read-only and never save a rate', async ({ appPage: page, feedRequests }) => {
  await signIn(page, PERSONAS.fencing_manager);

  await page.locator('[data-view="profile"]').click();
  const rateCard = page.locator('#profileRateCard');
  await expect(rateCard).toContainText('My Hourly Rate');
  await expect(page.locator('#profileRateValue')).toHaveText('$55.00/hr');
  await expect(rateCard).toContainText('Set by the office');
  await expect(rateCard.locator('input, button')).toHaveCount(0);
  expect(await page.evaluate(() => typeof window.updateTradeRate)).toBe('undefined');

  await page.locator('[data-view="hours"]').click();
  await page.getByRole('button', { name: 'Weekly Invoice' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  const card = page.locator('.jc-card').filter({ hasText: 'FENCE-HENRY-001' });
  await expect(card.locator('[data-cardhours]')).toBeVisible();
  await expect(card.locator('[data-cardrate]')).toHaveCount(0);
  await expect(card.locator('[data-cardrate-readonly]')).toHaveText('$55.00/hr');
  await expect(card).toContainText('Set by the office');

  // A direct call cannot change an assigned card's rate either.
  await page.evaluate(() => window.setJobCardRate(0, '99'));
  await card.locator('[data-cardhours]').fill('3');
  await page.locator('#invSubmitBtn').click();
  await page.locator('#confirmAck').check();
  await page.locator('#confirmOk').click();
  await expect(page.locator('#hoursContent')).toContainText('Invoice Submitted');

  const writes = feedRequests.filter((entry) => entry.action === 'generate_trade_invoice' && entry.method === 'POST');
  expect(writes.length).toBe(1);
  expect(writes[0].body.manual_assignments).toEqual([
    expect.objectContaining({ assignment_id: 'e2e-henry-assignment', hours: 3, rate: 55, rate_source: 'server_resolved' })
  ]);
  expect(feedRequests.filter((entry) => entry.action === 'set_trade_rate')).toEqual([]);
});
