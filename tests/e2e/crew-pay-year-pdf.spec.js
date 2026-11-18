// SecureWorks Crew: the year pay summary PDF on My pay (#/pay/history). One
// press reads ops-api my_pay_year_summary_pdf (secureworks-backend #1617, #1630)
// with only the year, and saves the PDF from a Blob inside the app. Refusals and
// failed reads are said in words and save nothing. Roles and ZZTEST data only.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { crewUrl, watchErrors, PHONE } = require('../helpers/crew');

test.use(PHONE);

async function openMyPay(page, persona = 'crew') {
  await page.goto(crewUrl('#/jobs', persona));
  await page.waitForFunction(() => Boolean(window.__crewDemo));
  await page.evaluate(async () => {
    const { db } = window.__crewDemo;
    const store = await import('/crew/js/lib/store.js');
    db.me.name = 'Crew';
    db.invoices.forEach((inv, idx) => { if (inv.invoice_number) inv.invoice_number = `ZZTEST-INV-${String(idx + 1).padStart(2, '0')}`; });
    // Record what the app sends, so the test can see it sends only the year.
    const real = window.__crewDemo.ops.my_pay_year_summary_pdf;
    window.__yearPdfCalls = [];
    window.__crewDemo.ops.my_pay_year_summary_pdf = (p, b) => { window.__yearPdfCalls.push({ ...p }); return real(p, b); };
    store.setState({ user: { ...store.getState().user, name: 'Crew', label: 'Crew' } });
    store.clearQueries();
  });
  await page.evaluate(() => { location.hash = '#/pay'; });
  await page.getByRole('button', { name: /My pay over time/ }).click();
  await expect(page.getByRole('heading', { name: 'My pay', exact: true })).toBeVisible();
}

const picker = (page) => page.getByRole('combobox', { name: 'Financial year' });
const yearButton = (page) => page.getByRole('button', { name: 'Year summary (PDF)' });
const pickYear = (page, fy) => picker(page).selectOption(String(fy));

test('a trade saves their own year PDF; the app sends only the year and a not-yet-processed invoice is listed, not totalled', async ({ page }) => {
  const errors = watchErrors(page);
  await openMyPay(page);
  // One invoice this year that the office has not pushed to Xero yet.
  await page.evaluate(() => {
    const { db } = window.__crewDemo;
    const paid = db.invoices.find((i) => i.id === 'inv-h1');
    db.invoices.push({ ...paid, id: 'inv-unbilled', invoice_number: 'ZZTEST-INV-99', xero_bill_id: null, xero_bill_status: null, status: 'submitted', pay_run_id: null });
  });

  // The picker lists the financial years in my_pay_history's years, newest first.
  await expect(picker(page).locator('option')).toHaveText(['1 July 2026 to 30 June 2027', '1 July 2025 to 30 June 2026']);
  await expect(picker(page)).toHaveValue('2027');
  await expect(yearButton(page)).toBeVisible();
  await expect(page.getByText('An invoice the office has not processed yet is listed in the PDF but left out of its totals.')).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent('download'), yearButton(page).click()]);
  expect(download.suggestedFilename()).toBe('pay-summary-2027.pdf');
  const text = fs.readFileSync(await download.path(), 'latin1');
  expect(text.startsWith('%PDF-')).toBe(true);
  expect(text).toContain('Pay summary, 1 July 2026 to 30 June 2027');
  expect(text).toContain('ZZTEST-INV-99  ');
  expect(text).toContain('Not yet processed');
  expect(text).toContain('1 invoice not yet processed');
  // Super is never said to have reached the fund: the office marked this run paid (no stamp held, so no day).
  expect(text).not.toContain('Paid to your super fund');
  expect(text).toMatch(/ZZTEST-INV-\d+  \S+  \$[\d.]+  \$[\d.]+  \$[\d.]+  Marked paid by the office\)/);
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toHaveText('Saved. Look in your downloads.');

  await pickYear(page, 2026);
  const [older] = await Promise.all([page.waitForEvent('download'), yearButton(page).click()]);
  expect(older.suggestedFilename()).toBe('pay-summary-2026.pdf');
  const calls = await page.evaluate(() => window.__yearPdfCalls);
  expect(calls).toEqual([{ fy: 2027 }, { fy: 2026 }]);

  // With the office's stamp held (run id to stamp), a marked run gives its Perth day; an unmarked run is to be paid.
  await page.evaluate(() => {
    const { db } = window.__crewDemo;
    const h1 = db.invoices.find((i) => i.id === 'inv-h1');
    const h2 = db.invoices.find((i) => i.id === 'inv-h2');
    db.paidSuperRuns = new Map([[h1.pay_run_id, '2026-10-31T16:00:00Z']]);
    h2.invoice_number = 'ZZTEST-INV-98';
    h1.invoice_number = 'ZZTEST-INV-97';
  });
  await pickYear(page, 2027);
  const [stamped] = await Promise.all([page.waitForEvent('download'), yearButton(page).click()]);
  const stampedText = fs.readFileSync(await stamped.path(), 'latin1');
  expect(stampedText).toMatch(/ZZTEST-INV-97 [^)]*Marked paid by the office on 1 Nov 2026\)/);
  expect(stampedText).toMatch(/ZZTEST-INV-98 [^)]*To be paid to your fund\)/);
  expect(stampedText).not.toContain('Paid to your super fund');
  if (process.env.YEAR_PDF_SHOT) {
    await page.locator('section', { hasText: 'Year summary for your accountant' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: process.env.YEAR_PDF_SHOT + '/my-pay-year-pdf-saved.png' });
  }
  expect(errors).toEqual([]);
});

test('a year with no invoices, a refusal and a failed read are said in words and save nothing', async ({ page }) => {
  const errors = watchErrors(page);
  await openMyPay(page);
  let downloads = 0;
  page.on('download', () => { downloads += 1; });

  await page.evaluate(() => { window.__crewDemo.db.yearPdfRefuse = { status: 404, code: 'no_invoices_that_year' }; });
  await pickYear(page, 2026);
  await yearButton(page).click();
  await expect(page.locator('.pay-ybad')).toHaveText('No invoices in that year.');

  await page.evaluate(() => { window.__crewDemo.db.yearPdfRefuse = { status: 403, code: 'own_pay_only' }; });
  await yearButton(page).click();
  await expect(page.locator('.pay-ybad')).toHaveText('Only the trade can get their own pay summary.');

  await page.evaluate(() => { window.__crewDemo.db.yearPdfRefuse = { status: 503, code: 'pay_year_summary_unreadable' }; });
  await pickYear(page, 2027);
  await yearButton(page).click();
  await expect(page.locator('.pay-ybad')).toHaveText('Could not make your pay summary. Try again.');
  if (process.env.YEAR_PDF_SHOT) {
    await page.locator('section', { hasText: 'Year summary for your accountant' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: process.env.YEAR_PDF_SHOT + '/my-pay-year-pdf-failed.png' });
  }
  expect(downloads).toBe(0);
  expect(errors).toEqual([]);
});

test('the office sees no year PDF button', async ({ page }) => {
  await page.goto(crewUrl('#/jobs', 'office'));
  await page.waitForFunction(() => Boolean(window.__crewDemo));
  await expect(page.getByRole('heading', { name: 'Jobs', exact: true })).toBeVisible();
  await page.evaluate(() => { location.hash = '#/pay/history'; });
  await expect(page.getByRole('heading', { name: 'My pay', exact: true })).toBeVisible();
  await expect(page.getByText('Your rate')).toBeVisible();
  await expect(page.getByText('Year summary for your accountant')).toHaveCount(0);
});

test('apiBlob over the network: a PDF answer is a Blob, a JSON refusal keeps its code, a wrong type is refused', async ({ page }) => {
  await page.goto(crewUrl('#/jobs'));
  await page.waitForFunction(() => Boolean(window.__crewDemo));
  let seen = null;
  await page.route('**/functions/v1/ops-api?**', async (route) => {
    const url = new URL(route.request().url());
    seen = { auth: route.request().headers().authorization, params: Object.fromEntries(url.searchParams) };
    const fy = url.searchParams.get('fy');
    if (fy === '2026') return route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4\n%%EOF\n' });
    if (fy === '2025') return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'no_invoices_that_year' }) });
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' });
  });
  const out = await page.evaluate(async () => {
    const store = await import('/crew/js/lib/store.js');
    const api = await import('/crew/js/lib/api.js');
    window.CREW_CONFIG.supabaseUrl = 'https://zztest.example.test';
    store.setState({ demo: false });
    api.configureApi({ getToken: async () => 'zztest-token', authLost: () => {} });
    const res = { caches: [] };
    const realFetch = window.fetch;
    window.fetch = (url, init) => { res.caches.push(init && init.cache); return realFetch(url, init); };
    const blob = await api.apiBlob('my_pay_year_summary_pdf', { fy: 2026 });
    res.ok = { type: blob.type, size: blob.size, isBlob: blob instanceof Blob };
    try { await api.apiBlob('my_pay_year_summary_pdf', { fy: 2025 }); res.refused = 'no throw'; } catch (e) { res.refused = { status: e.status, code: e.code, refused: e.refused }; }
    try { await api.apiBlob('my_pay_year_summary_pdf', { fy: 2024 }); res.wrong = 'no throw'; } catch (e) { res.wrong = { code: e.code }; }
    window.fetch = realFetch;
    return res;
  });
  expect(out.ok.isBlob).toBe(true);
  expect(out.ok.size).toBeGreaterThan(0);
  expect(out.refused).toEqual({ status: 404, code: 'no_invoices_that_year', refused: true });
  expect(out.wrong).toEqual({ code: 'unexpected_file' });
  // The browser keeps no copy of a pay PDF.
  expect(out.caches).toEqual(['no-store', 'no-store', 'no-store']);
  expect(seen.auth).toBe('Bearer zztest-token');
  expect(seen.params).toEqual({ action: 'my_pay_year_summary_pdf', fy: '2024' });
});

test('fyChoices: years from the labels, newest first, odd labels left out, current year when none read', async ({ page }) => {
  await page.goto(crewUrl('#/jobs'));
  await page.waitForFunction(() => Boolean(window.__crewDemo));
  const out = await page.evaluate(async () => {
    const { fyChoices } = await import('/crew/js/ui/yearpdf.js');
    return [
      fyChoices([{ fy_label: 'FY 2025/26' }, { fy_label: 'FY 2026/27' }], '2026-11-13'),
      fyChoices([{ fy_label: 'FY 2026/28' }, { fy_label: 'Year 2026' }, { fy_label: 'FY 2026/27' }, { fy_label: 'FY 2026/27' }], '2026-11-13'),
      fyChoices([], '2026-11-13'),
      fyChoices(null, '2027-06-30')
    ];
  });
  expect(out).toEqual([[2027, 2026], [2027], [2027], [2027]]);
});
