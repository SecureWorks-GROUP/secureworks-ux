// Screenshots of the booking card's owner path (owner-authored-v1): the visit
// picker, a checked visit, a checked edited text and a server refusal, on a
// desktop and a phone. Offline only: the Friday fixture's fake backend, CSP
// connect-src 'none'. Serve the repo first (npm run serve:e2e), then:
//   node scripts/sales-booking-owner-shot.js [baseUrl] [outDir]
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://127.0.0.1:4173';
const out = process.argv[3] || 'docs/evidence/booking-owner-approval-2026-09-23';
const URL = base + '/tests/fixtures/booking-confirm/friday.html';

(async () => {
  const browser = await chromium.launch();
  for (const vp of [
    { name: 'desktop', viewport: { width: 1440, height: 1000 } },
    { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
  ]) {
    const ctx = await browser.newContext({ viewport: vp.viewport, isMobile: vp.isMobile, hasTouch: vp.hasTouch, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const card = page.locator('.bk-card');
    const shot = async (name) => { await page.waitForTimeout(400); await card.screenshot({ path: `${out}/${vp.name}-${name}.png` }); };
    const friday = () => page.evaluate(() => SalesBooking.state.data.booking_flow.owner_rulebook.bookable_dates.filter((d) => new Date(d + 'T12:00:00Z').getUTCDay() === 5).pop());
    const pick = async (start, minutes) => {
      await page.getByRole('combobox', { name: 'Visit day' }).selectOption(await friday());
      await page.getByRole('combobox', { name: 'Arrive from' }).selectOption(start);
      await page.getByRole('combobox', { name: 'Arrival window' }).selectOption(minutes);
    };
    const choose = async (name) => {
      const back = page.getByRole('button', { name: 'All leads' });
      if (await back.isVisible()) await back.click();
      await page.locator('.bk-list .lead', { hasText: name }).click();
    };

    await page.goto(URL);
    await choose('Basil L');
    await shot('basil-proposal');
    await page.getByRole('button', { name: 'Pick a different time' }).click();
    await shot('basil-picker');
    await choose('Priya S');
    await pick('12:30', '60');
    await shot('picker');
    await page.getByRole('button', { name: 'Book it' }).click();
    await page.waitForSelector('[data-owner-preview="calendar"]');
    await shot('visit-checked');

    await page.goto(URL);
    await page.locator('.bk-list .lead', { hasText: 'Priya S' }).click();
    await pick('12:00', '60');
    await page.getByRole('button', { name: 'Book it' }).click();
    await page.waitForSelector('.visit .result.is-bad');
    await shot('visit-refused');

    await page.goto(URL);
    await page.locator('.bk-list .lead', { hasText: 'Basil L' }).click();
    await page.getByRole('textbox', { name: 'Text to send' }).click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Marnin');
    await page.getByRole('button', { name: 'Send this text' }).click();
    await page.waitForSelector('[data-owner-preview="message"]');
    await shot('edited-text-checked');
    await ctx.close();
  }
  await browser.close();
})();
