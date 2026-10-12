// Guard for the Ops tab set (Captain 2026-10-06, `<ops-tab-set>` in ops.html):
//  - the nav is Jobs, Calendar, Financials, Dispatch, Sales, and Ops opens on Jobs;
//  - Today, Inbox and Approvals are off the front end, and any old deep link or
//    saved tab pointing at them (or at Materials) lands on Jobs;
//  - Financials keeps Purchase Orders, Work Orders and Bill Reconciliation, with
//    Finance Health and Job P&L hidden, and Purchase Orders carries the Supplier
//    Price Updates queue that used to sit on Materials;
//  - Dispatch is a labelled concept on sample data that makes no network request,
//    with the live Purchase orders board (the old Materials view) below it.
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { installOpsSessionStub } = require('../helpers/ops-auth');

const OPS_FILE = 'file://' + path.resolve(__dirname, '..', '..', 'ops.html');

async function bootOps(page, { hash = '', savedTab = null, responses = {} } = {}) {
  const apiCalls = [];
  const requests = [];
  const bodies = Object.assign({ pipeline: { columns: {} } }, responses);
  await installOpsSessionStub(page);
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith('file://')) return route.continue();
    requests.push(url);
    const match = url.match(/\/functions\/v1\/ops-api\?action=([a-z_]+)/);
    if (match) apiCalls.push(match[1]);
    const body = match && bodies[match[1]] ? bodies[match[1]] : {};
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
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
  await expect(page.locator('#viewJobs')).toHaveClass(/active/);
  return { apiCalls, requests };
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
    expect(await page.locator('.view.active').evaluateAll((els) => els.map((el) => el.id))).toEqual(['viewJobs']);
    expect(new URL(page.url()).hash).toBe('#jobs');

    await page.evaluate((tab) => { localStorage.setItem('sw_ops_tab', tab); }, hidden);
    await page.goto(OPS_FILE);
    await expect(page.locator('#viewJobs')).toHaveClass(/active/);
    expect(await page.evaluate(() => localStorage.getItem('sw_ops_tab'))).toBe('jobs');
  });
}

test('Financials keeps POs, Work Orders and Bill Reconciliation and hides Finance Health and Job P&L', async ({ page }) => {
  const { apiCalls } = await bootOps(page, {
    responses: {
      pending_prices: {
        pending_prices: [{ id: 'price-demo-1', supplier_name: 'Demo Supplier', item_description: 'Post 65x65', unit: 'ea', unit_price: 12.5 }],
      },
    },
  });
  await page.locator('.header-nav button[data-view="financials"]').click();
  const subTabs = page.locator('#viewFinancials .sub-tab');
  await expect(subTabs).toHaveText(['Invoices', 'Quotes', 'Purchase Orders', 'Work Orders', 'Bill Reconciliation', 'Trade Bills', 'Clear Debt']);
  await page.locator('#viewFinancials .sub-tab[data-sub="pos"]').click();
  await expect(page.locator('#subPos')).toHaveClass(/active/);
  // Supplier Price Updates lost its Materials home; it now lives here with its actions.
  const priceCard = page.locator('#subPos #pendingPricesPanel #price-price-demo-1');
  await expect(priceCard).toBeVisible();
  await expect(priceCard).toContainText('Demo Supplier');
  await expect(priceCard.getByRole('button', { name: 'Dismiss' })).toBeVisible();
  await priceCard.getByRole('button', { name: 'Confirm' }).click();
  await expect.poll(() => apiCalls.includes('confirm_price')).toBe(true);
  await expect(priceCard).toBeHidden();
  // Bill Reconciliation lost its Materials home; it now lives here and loads its queue.
  await page.locator('#viewFinancials .sub-tab[data-sub="billrecon"]').click();
  await expect(page.locator('#subBillrecon #matReconPanel')).toBeVisible();
  await expect.poll(() => apiCalls.includes('materials_recon_queue')).toBe(true);
});

test('Dispatch is a labelled concept on sample data and makes no network call', async ({ page }) => {
  const { apiCalls, requests } = await bootOps(page);
  await page.locator('.header-nav button[data-view="dispatch"]').click();
  const root = page.locator('#dispatchConceptRoot');
  await expect(root.locator('.dpc-banner')).toContainText('Concept preview');
  await expect(root.locator('.dpc-banner')).toContainText('This concept section does not read live jobs and cannot order, save or send anything');
  await expect(root.locator('.dpc-banner')).toContainText('The Purchase orders board below it is live');
  await expect(page.locator('#jarvisSummary')).toHaveText('No purchase orders');
  // The live PO board below the concept loads when the tab opens; let it settle
  // so only the concept's own interactions are measured.
  await expect.poll(() => apiCalls.includes('list_pos')).toBe(true);
  await page.waitForLoadState('networkidle');
  const before = requests.length;

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

  expect(requests.slice(before)).toEqual([]);
  expect(await root.innerText()).not.toMatch(/\u2014/);
});

test('Dispatch carries the live Purchase orders board below the concept', async ({ page }) => {
  const { apiCalls } = await bootOps(page, {
    responses: {
      list_pos: {
        purchase_orders: [
          { id: 'po-e2e-1', po_number: 'PO-E2E-0001', supplier_name: 'Demo Supplier', status: 'draft', total: 120, job_number: 'SWF-E2E-1', client_name: 'Test Client', job_type: 'fencing' },
        ],
      },
    },
  });
  await page.locator('.header-nav button[data-view="dispatch"]').click();
  const section = page.locator('#viewDispatch #dispatchPurchaseOrders');
  await expect(section.locator('.section-heading')).toContainText('Purchase orders');
  await expect(section).toContainText('Live purchase orders');
  await expect(section.getByRole('button', { name: '+ New PO' })).toBeVisible();
  const card = section.locator('#materialsKanban .kanban-card', { hasText: 'Demo Supplier' });
  await expect(card).toBeVisible();
  await expect(card.locator('button[title="Delete PO"]')).toBeVisible();
  expect(apiCalls).toContain('list_pos');
  const below = await page.evaluate(() => {
    const concept = document.getElementById('dispatchConceptRoot');
    const board = document.getElementById('dispatchPurchaseOrders');
    return Boolean(concept.compareDocumentPosition(board) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(below).toBe(true);
});
