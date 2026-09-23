// Booking screen redesign: real-browser checks with trusted input only.
//
// Runs the real modules/ops-sales-booking.js against the offline Friday fixture
// (tests/fixtures/booking-confirm/friday.html): synthetic people, CSP
// connect-src 'none', every write a local fake recorded on window.fakeWrites.
// Clicks and typing go through Playwright's trusted input pipeline, never
// element.dispatchEvent, on a desktop and a phone viewport.
const { test, expect } = require('@playwright/test');

const URL = '/tests/fixtures/booking-confirm/friday.html';

const viewports = [
  { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
  { name: 'phone', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }
];

for (const vp of viewports) {
  test.describe(`booking screen on ${vp.name}`, () => {
    test.use(vp.use);

    async function open(page) {
      await page.goto(URL);
      await expect(page.locator('.bk-list .lead').first()).toBeVisible();
    }

    async function choose(page, name) {
      await page.locator('.bk-list .lead', { hasText: name }).click();
      await expect(page.locator('.cardhead h2')).toHaveText(name);
    }

    test('the list opens loudest first and a tap opens one card with the last three messages', async ({ page }) => {
      await open(page);
      await expect(page.locator('.counts')).toContainText('to contact');
      await expect(page.locator('.bk-list .lead .lead-name').first()).toHaveText('Basil L');
      await expect(page.locator('.bk-list .lead').first()).toContainText('“Still waiting to hear back. Are you coming Friday or not?”');
      await choose(page, 'Basil L');
      const bubbles = page.locator('.bk-card .bubble');
      await expect(bubbles).toHaveCount(3);
      await expect(bubbles.last()).toContainText('Still waiting to hear back. Are you coming Friday or not?');
      await expect(page.getByRole('button', { name: 'Show all 4 messages' })).toBeVisible();
      await expect(page.locator('.route')).toContainText('SecureWorks Group Ops 776');
      await expect(page.locator('.route')).toContainText('phone ending 418');
      await expect(page.locator('.visit .when')).toContainText('arrive 12:00 to 1:30pm');
      await expect(page.locator('.targets')).toHaveText("Book it writes: GHL Stratco Fencing calendar and Marnin's Outlook");
      await expect(page.getByRole('button', { name: 'Send this text' })).toBeEnabled();
      await expect(page.getByRole('button', { name: 'Book it' })).toBeEnabled();
      const day = page.locator('.bk-day');
      await expect(day.locator('h2')).toContainText('Friday');
      await expect(day.locator('.src-outlook').first()).toBeVisible();
      await expect(day.locator('.ev', { hasText: 'Scope: Jordan W' }).locator('.src')).toHaveText('GHL');
      await expect(day.locator('.ev', { hasText: 'Scope: Melanie N' }).locator('.src')).toHaveText('Outlook');
      if (vp.name === 'phone') {
        await expect(page.locator('.bk-list')).toBeHidden();
        await page.getByRole('button', { name: 'All leads' }).click();
        await expect(page.locator('.bk-list')).toBeVisible();
      }
    });

    test('a clash names the other booking and blocks the press', async ({ page }) => {
      await open(page);
      await choose(page, 'Kerry P');
      await expect(page.locator('.visit .clash')).toHaveText('Clashes with Scope: Melanie N, Piara Waters at 10:45am (Outlook).');
      await expect(page.getByRole('button', { name: 'Book it' })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Send this text' })).toBeDisabled();
    });

    test('editing the text changes what is approved, and a missing send action says so', async ({ page }) => {
      await open(page);
      await choose(page, 'Basil L');
      const box = page.getByRole('textbox', { name: 'Text to send' });
      await box.click();
      await page.keyboard.press('End');
      await page.keyboard.type(' Marnin');
      await expect(box).toBeFocused();
      await expect(page.locator('.edited')).toContainText('Your approval will cover these exact words');
      const edited = await box.inputValue();
      await page.getByRole('button', { name: 'Send this text' }).click();
      await expect(page.locator('.compose .result')).toHaveText('Sending from this screen is not connected yet. Your approval is recorded; nothing was sent.');
      const writes = await page.evaluate(() => window.fakeWrites);
      const approval = writes.find((w) => w.action === 'sales_booking_approval_write');
      expect(approval.body.decision).toBe('approved');
      expect(approval.body.snapshot.step).toBe('message');
      expect(approval.body.snapshot.content.text).toBe(edited);
      expect(approval.body.snapshot.content.variant).toBe('edited');
      expect(approval.body.snapshot.content_hash).toMatch(/^[0-9a-f]{64}$/);
      const send = writes.find((w) => w.action === 'sales_booking_send');
      expect(send.body).toEqual({ approval_id: expect.stringMatching(/^fixture-approval-/) });
      await expect(page.locator('.bk-card')).not.toContainText('Text sent');
    });

    test('a connected send shows the result in words', async ({ page }) => {
      await open(page);
      await page.evaluate(() => { window.fixtureActionMode = 'sent'; });
      await choose(page, 'Basil L');
      await page.getByRole('button', { name: 'Send this text' }).click();
      await expect(page.locator('.compose .result')).toContainText(/Text sent at \d{1,2}:\d{2}[ap]m from SecureWorks Group Ops 776 to the phone ending 418\./);
      await expect(page.getByRole('button', { name: 'Send this text' })).toBeDisabled();
      await page.getByRole('button', { name: 'Book it' }).click();
      await expect(page.locator('.visit .result')).toContainText("in GHL Stratco Fencing calendar and Marnin's Outlook");
    });

    test('search keeps focus while typing and Refresh reads again', async ({ page }) => {
      await open(page);
      const search = page.getByRole('searchbox', { name: 'Search' });
      await search.click();
      await page.keyboard.type('aubin', { delay: 30 });
      await expect(search).toBeFocused();
      await expect(search).toHaveValue('aubin');
      await expect(page.locator('.bk-list .lead')).toHaveCount(1);
      await expect(page.locator('.bk-list .lead .lead-name')).toHaveText('Basil L');
      const before = await page.evaluate(() => window.fakeReads.filter((r) => r.action === 'sales_booking_read').length);
      await page.getByRole('button', { name: 'Refresh' }).click();
      await expect.poll(() => page.evaluate(() => window.fakeReads.filter((r) => r.action === 'sales_booking_read').length)).toBe(before + 1);
      await expect(page.getByRole('button', { name: 'Refresh' })).toBeEnabled();
      await expect(search).toHaveValue('aubin');
    });
  });
}
