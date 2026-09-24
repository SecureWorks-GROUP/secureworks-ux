// Screenshots of the booking screen's live free times (live-availability-v1):
// the person's Friday, a lead's own Friday with a tapped free time filling the
// picker, and a calendar GHL could not read, on a desktop and a phone.
// Offline only: the Friday fixture's fake backend, CSP connect-src 'none'.
// Serve the repo first (npm run serve:e2e), then:
//   node scripts/sales-booking-free-times-shot.js [baseUrl] [outDir]
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://127.0.0.1:4173';
const out = process.argv[3] || 'docs/evidence/booking-free-times-2026-09-24';
const URL = base + '/tests/fixtures/booking-confirm/friday.html';

(async () => {
  const browser = await chromium.launch();
  for (const vp of [
    { name: 'desktop', viewport: { width: 1440, height: 1000 } },
    { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
  ]) {
    const ctx = await browser.newContext({ viewport: vp.viewport, isMobile: vp.isMobile, hasTouch: vp.hasTouch, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const shot = async (name, sel) => { await page.waitForTimeout(300); await page.locator(sel).screenshot({ path: `${out}/${vp.name}-${name}.png` }); };
    const friday = () => page.locator('.daypick button', { hasText: 'Fri' }).click();

    await page.goto(URL);
    await page.locator('.bk-list .lead').first().waitFor();
    await friday();
    await shot('person-friday', '.bk-day');

    await page.locator('.bk-list .lead', { hasText: 'Kerry P' }).click();
    await friday();
    await shot('kerry-friday', '.bk-day');
    await page.locator('.freetimes [data-free-slot]').first().click();
    await shot('kerry-picked', '.bk-card');

    await page.evaluate(() => {
      const flow = SalesBooking.state.data.booking_flow;
      flow.calendar_read = { provider: 'ghl', source: 'server_live_read', state: 'could_not_read', reason: 'ghl_events_unreadable: timeout', person: 'Marnin' };
      SalesBooking.render();
    });
    await shot('unreadable', '.bk');
    await ctx.close();
  }
  await browser.close();
})();
