const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

// The welcome page is what a new trade is sent at invite time (backend
// invite-trade-user links to it). It has to work signed out, on a phone,
// with no script and no network beyond the page and its video.

test('welcome page shows the video, the steps and a way into the app', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/welcome.html');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Getting started with the trade app');
  await expect(page.locator('#welcomeVideo source')).toHaveAttribute('src', /^onboarding\/trade-app-getting-started\.mp4(#t=[\d.]+)?$/);
  await expect(page.locator('#welcomeSteps > li')).toHaveCount(7);
  await expect(page.locator('#welcomeSteps')).toContainText('Pay, then Weekly Invoice');
  await expect(page.locator('#welcomeSteps')).toContainText('Saved to your account');
  await expect(page.locator('#welcomeWarn')).toContainText('takes money off your invoice');
  await expect(page.locator('#welcomeOpenApp')).toHaveAttribute('href', 'trade.html');

  // Nothing runs off the side of a phone screen.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('the video file the page points at is in the repository and is a real mp4', async () => {
  const file = path.join(__dirname, '..', '..', 'onboarding', 'trade-app-getting-started.mp4');
  const stat = fs.statSync(file);
  expect(stat.size).toBeGreaterThan(500_000);
  expect(stat.size).toBeLessThan(10_000_000);
  const head = fs.readFileSync(file).subarray(4, 8).toString('latin1');
  expect(head).toBe('ftyp');
});
