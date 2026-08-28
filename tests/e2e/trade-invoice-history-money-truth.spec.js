const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

test.use({ persona: 'installer', feedScenario: 'trade-invoice-history-money-truth' });

test('uses persisted net pay across recent activity, history, profile, and detail', async ({ appPage: page }) => {
  await signIn(page, PERSONAS.installer);
  await page.locator('[data-view="hours"]').click();

  const recentComplete = page.locator('.inv-history-item').filter({ hasText: 'INV-TRUTH-COMPLETE' });
  const recentIncomplete = page.locator('.inv-history-item').filter({ hasText: 'INV-TRUTH-INCOMPLETE' });
  await expect(recentComplete).toContainText('$352.00');
  await expect(recentComplete).not.toContainText('$400.00');
  await expect(recentIncomplete).toContainText('Figures unavailable');

  await page.getByRole('button', { name: 'View All' }).click();
  const historyComplete = page.locator('.inv-history-item').filter({ hasText: 'INV-TRUTH-COMPLETE' });
  const historyIncomplete = page.locator('.inv-history-item').filter({ hasText: 'INV-TRUTH-INCOMPLETE' });
  await expect(historyComplete).toContainText('$352.00');
  await expect(historyIncomplete).toContainText('Figures unavailable');

  await historyIncomplete.click();
  await expect(page.getByText('Invoice Detail')).toBeVisible();
  await expect(page.getByText('Submitted invoice totals are unavailable')).toBeVisible();
  await expect(page.locator('[data-invoice-money-summary]')).not.toContainText('$300.00');

  await page.locator('[data-view="profile"]').click();
  const profileList = page.locator('#profileInvoiceList');
  await expect(profileList).toContainText('$352.00');
  await expect(profileList).toContainText('Figures unavailable');
  await expect(profileList).not.toContainText('$400.00');
});
