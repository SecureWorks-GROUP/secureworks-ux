// Running weekly invoice draft (Hugo, 2026-10-24).
//
// Save keeps what was typed and does not send the invoice. Closing the
// builder and dropping the phone's session still brings the same draft back,
// because it was stored by save_running_invoice_draft. An approved work order
// is added once. A work order already claimed on another week is not added.
const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

test.use({
  persona: 'installer',
  feedScenario: 'trade-invoice-running-draft',
  appWeekDay: 6,
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  timezoneId: 'Australia/Perth'
});

async function openBuilder(page) {
  await page.locator('[data-view="hours"]').click();
  await page.getByRole('button', { name: /Weekly Invoice/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('#invSaveBtn')).toBeVisible();
  await expect(page.locator('#invSubmitBtn')).toBeVisible();
  await expect(page.locator('.jc-card', { hasText: 'SWMS-261400' })).toHaveCount(1);
  await expect(page.locator('.jc-card', { hasText: 'SWF-CLAIMED' })).toHaveCount(0);
}

test('Save keeps the draft without sending, and it is still there after a fresh open', async ({ appPage: page, feedRequests }) => {
  await signIn(page, PERSONAS.installer);
  await openBuilder(page);

  await expect(page.locator('[data-invoice-agent-banner]')).toContainText('Only you can send it');
  await expect(page.locator('[data-invoice-save-note]')).toContainText('does not send it');
  await expect(page.locator('#invSaveBtn')).toHaveText('Save');
  await expect(page.locator('#invSubmitBtn')).toContainText('Submit Invoice');

  const card = page.locator('.jc-card').filter({ hasText: 'SWF-26767' });
  await card.locator('[data-carddesc]').fill('Hugo saved this line');
  await card.locator('[data-carddesc]').blur();
  await page.locator('#invSaveBtn').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: '/opt/cursor/artifacts/invoice-save-vs-submit.png',
    fullPage: true
  });

  await page.locator('#invSaveBtn').click();
  await expect(page.locator('#toast')).toContainText('not been sent');
  await expect(page.getByText('Invoice Submitted')).toHaveCount(0);

  const saves = feedRequests.filter((entry) => entry.action === 'save_running_invoice_draft');
  expect(saves.length).toBeGreaterThan(0);
  const last = saves[saves.length - 1].body;
  expect(last.draft_builder.jobCards.some((row) => row.description === 'Hugo saved this line')).toBe(true);
  expect(last.draft_builder.jobCards.filter((row) => row.job_number === 'SWMS-261400')).toHaveLength(1);
  expect(last.submit).toBeUndefined();
  expect(last.xero).toBeUndefined();
  expect(last.status).toBeUndefined();
  expect(feedRequests.some((entry) => entry.action === 'generate_trade_invoice')).toBe(false);

  await page.evaluate(() => sessionStorage.clear());
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await openBuilder(page);

  await expect(page.locator('.jc-card').filter({ hasText: 'SWF-26767' }).locator('[data-carddesc]')).toHaveValue('Hugo saved this line');
  await expect(page.locator('.jc-card', { hasText: 'SWMS-261400' })).toHaveCount(1);
  await expect(page.locator('.jc-card', { hasText: 'SWF-CLAIMED' })).toHaveCount(0);
  await expect(page.locator('#invSaveBtn')).toBeVisible();
  await expect(page.locator('#invSubmitBtn')).toBeVisible();
  await page.locator('#invSaveBtn').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: '/opt/cursor/artifacts/invoice-saved-draft-reloaded.png',
    fullPage: true
  });
  expect(feedRequests.some((entry) => entry.action === 'generate_trade_invoice')).toBe(false);
});
