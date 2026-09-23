// Regenerates the Clear Debt evidence screenshots from the offline synthetic
// fixture (no network, no customer data):
//   npm run serve:e2e   (in another shell)
//   node scripts/clear-debt-screen-shots.js [outDir]
// Writes to docs/evidence/clear-debt-redesign-2026-09-24/ by default.
const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:4173';
const URL = BASE + '/tests/fixtures/clear-debt/index.html';
const OUT = process.argv[2] || 'docs/evidence/clear-debt-redesign-2026-09-24';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const shot = (p, name, opts) => p.screenshot(Object.assign({ path: path.join(OUT, name) }, opts || {}));
  const browser = await chromium.launch();

  const d = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await d.goto(URL);
  await d.locator('.lead').first().waitFor();
  await shot(d, 'desktop-list.png');
  await d.locator('.lead', { hasText: 'Debtor 001' }).first().click();
  await shot(d, 'desktop-debtor-nothing-picked.png');
  await d.locator('label.inv', { hasText: 'INV-S1003' }).click();
  await d.locator('.db-card .block').nth(1).scrollIntoViewIfNeeded();
  await d.evaluate(() => window.scrollBy(0, -80));
  await shot(d, 'desktop-timeline.png');
  await d.locator('.compose').scrollIntoViewIfNeeded();
  await d.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await shot(d, 'desktop-draft.png');
  await d.evaluate(() => window.scrollTo(0, 0));
  await shot(d, 'desktop-card-full.png', { fullPage: true });
  await d.locator('.lead', { hasText: 'Debtor 004' }).first().click();
  await d.evaluate(() => window.scrollTo(0, 0));
  await shot(d, 'desktop-faulted-source.png');
  await d.getByRole('button', { name: 'Details' }).click();
  await shot(d, 'desktop-details.png');
  await d.goto(URL + '?mode=unknown');
  await d.locator('[data-cd-state="not-connected"]').waitFor();
  await shot(d, 'desktop-not-connected.png');

  const p = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await p.goto(URL);
  await p.locator('.lead').first().waitFor();
  await shot(p, 'phone-list.png');
  await p.locator('.lead', { hasText: 'Debtor 001' }).first().click();
  await p.evaluate(() => window.scrollTo(0, 0));
  await shot(p, 'phone-card.png');
  await p.locator('label.inv', { hasText: 'INV-S1003' }).click();
  await p.locator('.compose').scrollIntoViewIfNeeded();
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await shot(p, 'phone-draft.png');
  await shot(p, 'phone-card-full.png', { fullPage: true });

  await browser.close();
  console.log('wrote screenshots to ' + OUT);
})();
