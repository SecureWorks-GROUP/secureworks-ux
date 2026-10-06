// Guard for the Ops tab set (Captain 2026-10-06, `<ops-tab-set>` in ops.html):
//  - the nav is Jobs, Calendar, Financials, Dispatch, Sales, and Ops opens on Jobs;
//  - Today, Inbox and Approvals are off the front end, and any old deep link or
//    saved tab pointing at them (or at Materials) lands on Jobs;
//  - Financials keeps Purchase Orders and Work Orders, with Finance Health and
//    Job P&L hidden;
//  - Dispatch is a labelled concept on sample data that makes no network call.
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { installOpsSessionStub } = require('../helpers/ops-auth');

const OPS_FILE = 'file://' + path.resolve(__dirname, '..', '..', 'ops.html');

async function bootOps(page, { hash = '', savedTab = null } = {}) {
  const apiCalls = [];
  await installOpsSessionStub(page);
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith('file://')) return route.continue();
    const match = url.match(/\/functions\/v1\/ops-api\?action=([a-z_]+)/);
    if (match) apiCalls.push(match[1]);
    if (match && match[1] === 'pipeline') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ columns: {} }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  if (savedTab) {
    // Seed once per tab session, so a later reload in the same test keeps
    // whatever the page itself saved.
    await page.addInitScript((tab) => {
      if (sessionStorage.getItem('e2e_seeded')) return;
      sessionStorage.setItem('e2e_seeded', '1');
      localStorage.setItem('sw_ops_tab', tab);
    }, savedTab);
  }
  await page.goto(OPS_FILE + (hash ? '#' + hash : ''));
  await expect(page.locator('.header-nav button[data-view="jobs"]')).toHaveClass(/active/);
  return { apiCalls };
}

test('the nav is Jobs, Calendar, Financials, Dispatch, Sales and Ops opens on Jobs', async ({ page }) => {
  await bootOps(page);
  await expect(page.locator('.header-nav button')).toHaveText(['Jobs', 'Calendar', 'Financials', 'Dispatch', 'Sales']);
  const mobileOrder = await page.locator('.mobile-nav button').evaluateAll((els) => els.map((el) => el.dataset.view));
  expect(mobileOrder).toEqual(['jobs', 'calendar', 'financials', 'dispatch', 'sales']);
  await expect(page.locator('#viewJobs')).toHaveClass(/active/);
  for (const hidden of ['today', 'inbox', 'approvals', 'materials']) {
    await expect(page.locator(`[data-view="${hidden}"]`)).toHaveCount(0);
  }
  expect(await page.evaluate(() => localStorage.getItem('sw_ops_tab'))).toBe('jobs');
});

for (const hidden of ['today', 'inbox', 'approvals', 'materials']) {
  test(`an old #${hidden} link and a saved ${hidden} tab both land on Jobs`, async ({ page }) => {
    await bootOps(page, { hash: hidden, savedTab: 'calendar' });
    await expect(page.locator('#viewJobs')).toHaveClass(/active/);
    await expect(page.locator(`#view${hidden[0].toUpperCase()}${hidden.slice(1)}`)).not.toHaveClass(/active/);
    expect(new URL(page.url()).hash).toBe('#jobs');

    await page.evaluate((tab) => { localStorage.setItem('sw_ops_tab', tab); }, hidden);
    await page.goto(OPS_FILE);
    await expect(page.locator('#viewJobs')).toHaveClass(/active/);
    expect(await page.evaluate(() => localStorage.getItem('sw_ops_tab'))).toBe('jobs');
  });
}

test('Financials keeps POs and Work Orders and hides Finance Health and Job P&L', async ({ page }) => {
  await bootOps(page);
  await page.locator('.header-nav button[data-view="financials"]').click();
  const subTabs = page.locator('#viewFinancials .sub-tab');
  await expect(subTabs).toHaveText(['Invoices', 'Quotes', 'Purchase Orders', 'Work Orders', 'Trade Bills', 'Clear Debt']);
  await page.evaluate(() => showSubTab('jobpnl'));
  await expect(page.locator('#subInvoices')).toHaveClass(/active/);
  await expect(page.locator('#subJobpnl')).not.toHaveClass(/active/);
  await page.locator('#viewFinancials .sub-tab[data-sub="pos"]').click();
  await expect(page.locator('#subPos')).toHaveClass(/active/);
});

test('Dispatch is a labelled concept on sample data and makes no network call', async ({ page }) => {
  const { apiCalls } = await bootOps(page);
  await page.locator('.header-nav button[data-view="dispatch"]').click();
  const root = page.locator('#dispatchConceptRoot');
  await expect(root.locator('.dpc-banner')).toContainText('Concept preview');
  await expect(root.locator('.dpc-banner')).toContainText('cannot order, save or send anything');
  await page.waitForLoadState('networkidle');
  const before = apiCalls.length;

  await root.locator('[data-dpc-type="patio"]').click();
  await expect(root.locator('.dpc-job')).toHaveCount(2);
  await root.locator('.dpc-job', { hasText: 'DEMO-P204' }).click();
  await expect(root.locator('.dpc-workhead h2')).toContainText('DEMO-P204');
  await root.locator('[data-dpc-tab="pos"]').click();
  await expect(root.locator('.dpc-po')).toContainText('PO-DEMO-0311');
  await root.locator('[data-dpc-act="po"]').click();
  await expect(root.locator('.dpc-note')).toContainText('Nothing was saved');
  await root.locator('[data-dpc-act="email"]').click();
  await expect(root.locator('.dpc-note')).toContainText('Nothing was sent');
  await root.locator('[data-dpc-layer="installs"]').uncheck();
  await expect(root.locator('.dpc-event.dpc-layer-installs')).toHaveCount(0);

  expect(apiCalls.slice(before)).toEqual([]);
  const source = require('node:fs').readFileSync(path.resolve(__dirname, '..', '..', 'modules', 'ops-dispatch-concept.js'), 'utf8');
  expect(source).not.toMatch(/\b(fetch|opsFetch|opsPost|XMLHttpRequest|sendBeacon|supabase)\s*\(/);
  expect(await root.innerText()).not.toMatch(/\u2014/);
});
