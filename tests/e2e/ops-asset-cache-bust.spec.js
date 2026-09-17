const { test, expect } = require('@playwright/test');

function bookingQuery(url) {
  try {
    const parsed = new URL(url);
    if (!/\/modules\/ops-sales-booking\.(js|css)$/.test(parsed.pathname)) return null;
    return { kind: parsed.pathname.endsWith('.css') ? 'css' : 'js', v: parsed.searchParams.get('v') };
  } catch {
    return null;
  }
}

test('ops booking module is fetched with a fresh cache-bust on a normal reload', async ({ page }) => {
  const first = { js: null, css: null };
  page.on('request', (request) => {
    const hit = bookingQuery(request.url());
    if (!hit || first[hit.kind]) return;
    first[hit.kind] = hit.v;
  });

  await page.goto('/ops.html');
  await expect(page.locator('#swAuthGate')).toBeVisible();
  expect(first.js, 'booking js must load').toBeTruthy();
  expect(first.css, 'booking css must load').toBeTruthy();
  expect(first.js).not.toBe('1');
  expect(first.css).not.toBe('1');

  const second = { js: null, css: null };
  page.on('request', (request) => {
    const hit = bookingQuery(request.url());
    if (!hit || second[hit.kind]) return;
    second[hit.kind] = hit.v;
  });

  await page.reload();
  expect(second.js, 'booking js must load again').toBeTruthy();
  expect(second.css, 'booking css must load again').toBeTruthy();
  expect(second.js).not.toBe(first.js);
  expect(second.css).not.toBe(first.css);
});
