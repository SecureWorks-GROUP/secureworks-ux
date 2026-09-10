// Trade invoice submit guards (2026-09-10, Alyx audit).
//
// Two ways a trade's price moved between what they saw and what went out:
//  1. A stale week_start posted new work under an already-invoiced week. The
//     server answered with the OLD invoice as success and the app painted
//     "Invoice Submitted" for money that was never saved.
//  2. The Submit tap re-reads every card from the screen before building the
//     payload, and the confirm popup used a different total formula than the
//     Earned box, so the posted total could differ from the shown total.
//
// Every test here must leave the form editable and must never reach the
// success screen. Scenarios with no approved write prove no POST was attempted:
// the shared feed stub fails the test on an unapproved ops-api write.
const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

test.use({
  persona: 'installer',
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true
});

async function openBuilder(page) {
  await signIn(page, PERSONAS.installer);
  await page.locator('[data-view="hours"]').click();
  await page.getByRole('button', { name: /Weekly Invoice/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('[data-invoice-money-summary]')).toContainText('Earned$400.00');
}

async function expectStillEditable(page) {
  await expect(page.getByText('Invoice Submitted')).toHaveCount(0);
  await expect(page.getByText('Invoice Saved', { exact: true })).toHaveCount(0);
  await expect(page.locator('#invSubmitBtn')).toBeVisible();
}

test.describe('server already holds an invoice for the week (409 shape)', () => {
  test.use({ feedScenario: 'trade-invoice-week-collision-409' });

  test('is a hard block naming the existing invoice, never a success screen', async ({ appPage: page, feedRequests }) => {
    await openBuilder(page);
    await page.locator('#invSubmitBtn').click();
    await page.locator('#confirmOk').click();

    await expect(page.locator('#toast')).toContainText('already have an invoice for the week');
    await expect(page.locator('#toast')).toContainText('SW-INV-OLD-025');
    await expect(page.locator('#toast')).toContainText('NOT saved');
    await expectStillEditable(page);
    // The old invoice's money must not be painted as this submission's result.
    await expect(page.getByText('Net pay$1099.56')).toHaveCount(0);
    expect(feedRequests.some((entry) => entry.action === 'attach_invoice_pdf')).toBe(false);
  });
});

test.describe('server already holds an invoice for the week (pre-fix success shape)', () => {
  test.use({ feedScenario: 'trade-invoice-week-collision-legacy' });

  test('already_submitted with success: true is still refused by the app', async ({ appPage: page, feedRequests }) => {
    await openBuilder(page);
    await page.locator('#invSubmitBtn').click();
    await page.locator('#confirmOk').click();

    await expect(page.locator('#toast')).toContainText('already have an invoice for the week');
    await expectStillEditable(page);
    // The old invoice's money must not be painted as this submission's result.
    await expect(page.getByText('Net pay$1099.56')).toHaveCount(0);
    expect(feedRequests.some((entry) => entry.action === 'attach_invoice_pdf')).toBe(false);
  });
});

test.describe('total moves between the Earned box and the Submit tap', () => {
  test.use({ feedScenario: 'trade-invoice-total-drift' });

  test('nothing is sent; the form redraws with the new total and says so', async ({ appPage: page, feedRequests }) => {
    await openBuilder(page);
    const card = page.locator('.jc-card').filter({ hasText: 'SWF-26767' });
    await expect(card.locator('[data-cardhours]')).toHaveValue('8');

    // The screen says 9 hours but the app state still says 8: an iPhone tap
    // that never fired the input event. The old code posted whatever the
    // sync produced while the trade was looking at $400.00.
    await card.locator('[data-cardhours]').evaluate((el) => { el.value = '9'; });
    await expect(page.locator('[data-invoice-money-summary]')).toContainText('Earned$400.00');

    await page.locator('#invSubmitBtn').click();

    await expect(page.locator('#toast')).toContainText('Your total changed from $400.00 to $450.00');
    await expect(page.locator('#toast')).toContainText('Nothing was sent');
    await expect(page.locator('#confirmOverlay')).not.toHaveClass(/active/);
    await expect(page.locator('[data-invoice-money-summary]')).toContainText('Earned$450.00');
    await expectStillEditable(page);
    expect(feedRequests.some((entry) => entry.method === 'POST' && entry.action === 'generate_trade_invoice')).toBe(false);
  });
});

test.describe('job cards belong to a different week than the invoice', () => {
  test.use({ feedScenario: 'trade-invoice-stale-week' });

  test('submit is blocked before any confirm or POST', async ({ appPage: page, feedRequests }) => {
    await openBuilder(page);
    await page.locator('#invSubmitBtn').click();

    await expect(page.locator('#toast')).toContainText('SWF-26767 is dated');
    await expect(page.locator('#toast')).toContainText('but this invoice is for the week');
    await expect(page.locator('#confirmOverlay')).not.toHaveClass(/active/);
    await expectStillEditable(page);
    expect(feedRequests.some((entry) => entry.method === 'POST' && entry.action === 'generate_trade_invoice')).toBe(false);
  });
});

test.describe('confirm popup states the exact total and week being posted', () => {
  test.use({ feedScenario: 'trade-invoice-super-gst' });

  test('the number in the popup is the number that posts', async ({ appPage: page, feedRequests }) => {
    await openBuilder(page);
    await page.locator('#invSubmitBtn').click();

    const msg = page.locator('#confirmMsg');
    await expect(msg).toContainText('Submit 1 job for ');
    await expect(msg).toContainText('($400.00 before super)');
    await page.locator('#confirmOk').click();
    await expect(page.getByText('Invoice Submitted')).toBeVisible();

    const submit = feedRequests.find((entry) => entry.method === 'POST' && entry.action === 'generate_trade_invoice');
    expect(submit).toBeTruthy();
    expect(submit.body.manual_assignments).toEqual([
      expect.objectContaining({ assignment_id: 'e2e-wo-holder-assignment', hours: 8 })
    ]);
    expect(submit.body.week_start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
